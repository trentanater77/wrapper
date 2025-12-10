'use strict';

/**
 * Scheduled Rooms Management
 * 
 * Handles scheduling rooms for future times:
 * - Create scheduled room
 * - List upcoming scheduled rooms
 * - Express interest ("Remind Me")
 * - Go live (convert scheduled → active room)
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

// Generate room ID
function generateRoomId() {
  return 'sched-' + crypto.randomBytes(6).toString('hex');
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // GET: List scheduled rooms
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};
      const { hostId, upcoming, limit } = params;

      let query = supabase
        .from('scheduled_rooms')
        .select('*')
        .order('scheduled_for', { ascending: true });

      // Filter by host if specified
      if (hostId) {
        query = query.eq('host_id', hostId);
      }

      // Only upcoming (not yet live or ended)
      if (upcoming === 'true') {
        query = query
          .eq('status', 'scheduled')
          .gte('scheduled_for', new Date().toISOString());
      }

      // Only public rooms (unless filtering by host)
      if (!hostId) {
        query = query.eq('is_public', true);
      }

      // Limit results
      if (limit) {
        query = query.limit(parseInt(limit) || 20);
      } else {
        query = query.limit(50);
      }

      const { data, error } = await query;

      if (error) {
        // Table might not exist yet
        if (error.code === '42P01') {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ rooms: [] }),
          };
        }
        throw error;
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ rooms: data || [] }),
      };

    } catch (error) {
      console.error('❌ Error listing scheduled rooms:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to list scheduled rooms' }),
      };
    }
  }

  // DELETE: Cancel scheduled room
  if (event.httpMethod === 'DELETE') {
    try {
      const body = JSON.parse(event.body || '{}');
      const { scheduleId, hostId } = body;

      if (!scheduleId || !hostId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'scheduleId and hostId are required' }),
        };
      }

      // Update status to cancelled (soft delete)
      const { error } = await supabase
        .from('scheduled_rooms')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', scheduleId)
        .eq('host_id', hostId);

      if (error) throw error;

      console.log(`❌ Scheduled room ${scheduleId} cancelled`);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true }),
      };

    } catch (error) {
      console.error('❌ Error cancelling scheduled room:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to cancel scheduled room' }),
      };
    }
  }

  // POST: Various actions
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { action } = body;

    switch (action) {
      // Create a scheduled room
      case 'create': {
        const { 
          hostId, hostName, hostAvatar,
          topic, description, roomType,
          scheduledFor, durationMinutes, isPublic
        } = body;

        if (!hostId || !topic || !scheduledFor) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
              error: 'Missing required fields',
              required: ['hostId', 'topic', 'scheduledFor']
            }),
          };
        }

        // Validate scheduled time is in the future
        const scheduleDate = new Date(scheduledFor);
        if (scheduleDate <= new Date()) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Scheduled time must be in the future' }),
          };
        }

        const { data, error } = await supabase
          .from('scheduled_rooms')
          .insert({
            host_id: hostId,
            host_name: hostName || 'Host',
            host_avatar: hostAvatar,
            topic,
            description,
            room_type: roomType || 'red',
            scheduled_for: scheduleDate.toISOString(),
            duration_minutes: durationMinutes || 60,
            is_public: isPublic !== false,
            status: 'scheduled',
          })
          .select()
          .single();

        if (error) throw error;

        console.log(`📅 Scheduled room created: "${topic}" at ${scheduleDate.toISOString()}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            scheduledRoom: data,
          }),
        };
      }

      // Express interest ("Remind Me")
      case 'interested': {
        const { scheduleId, userId, notifyEmail, notifyPush } = body;

        if (!scheduleId || !userId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'scheduleId and userId are required' }),
          };
        }

        const { data, error } = await supabase
          .from('scheduled_room_interest')
          .upsert({
            scheduled_room_id: scheduleId,
            user_id: userId,
            notify_email: notifyEmail !== false,
            notify_push: notifyPush !== false,
          }, { onConflict: 'scheduled_room_id,user_id' })
          .select()
          .single();

        if (error) throw error;

        console.log(`🔔 User ${userId} interested in scheduled room ${scheduleId}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, interest: data }),
        };
      }

      // Remove interest
      case 'not-interested': {
        const { scheduleId, userId } = body;

        if (!scheduleId || !userId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'scheduleId and userId are required' }),
          };
        }

        const { error } = await supabase
          .from('scheduled_room_interest')
          .delete()
          .eq('scheduled_room_id', scheduleId)
          .eq('user_id', userId);

        if (error) throw error;

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true }),
        };
      }

      // Go live (convert scheduled → active room)
      case 'go-live': {
        const { scheduleId, hostId } = body;

        if (!scheduleId || !hostId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'scheduleId and hostId are required' }),
          };
        }

        // Get scheduled room
        const { data: scheduled, error: fetchError } = await supabase
          .from('scheduled_rooms')
          .select('*')
          .eq('id', scheduleId)
          .eq('host_id', hostId)
          .single();

        if (fetchError || !scheduled) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Scheduled room not found or not yours' }),
          };
        }

        // Generate room ID
        const roomId = generateRoomId();
        const inviteCode = crypto.randomBytes(4).toString('hex').toUpperCase();
        const endsAt = new Date(Date.now() + (scheduled.duration_minutes || 60) * 60 * 1000);

        // Create active room
        const { data: activeRoom, error: createError } = await supabase
          .from('active_rooms')
          .insert({
            room_id: roomId,
            host_id: scheduled.host_id,
            host_name: scheduled.host_name,
            host_avatar: scheduled.host_avatar,
            room_type: scheduled.room_type,
            topic: scheduled.topic,
            description: scheduled.description,
            is_public: scheduled.is_public,
            status: 'live',
            queue_mode: true, // Enable queue mode by default for scheduled rooms
            started_at: new Date().toISOString(),
            ends_at: endsAt.toISOString(),
            invite_code: inviteCode,
            participant_count: 1,
            spectator_count: 0,
          })
          .select()
          .single();

        if (createError) throw createError;

        // Update scheduled room to link to live room
        await supabase
          .from('scheduled_rooms')
          .update({
            status: 'live',
            live_room_id: roomId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', scheduleId);

        // TODO: Send notifications to interested users
        // This would be a separate function or service

        console.log(`🔴 Scheduled room ${scheduleId} is now LIVE as ${roomId}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            room: activeRoom,
            roomId,
            inviteCode,
            roomUrl: `https://sphere.chatspheres.com/?room=${roomId}`,
          }),
        };
      }

      // Update scheduled room
      case 'update': {
        const { scheduleId, hostId, updates } = body;

        if (!scheduleId || !hostId || !updates) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'scheduleId, hostId, and updates are required' }),
          };
        }

        // Only allow updating certain fields
        const allowedFields = ['topic', 'description', 'scheduled_for', 'duration_minutes', 'is_public'];
        const safeUpdates = {};
        for (const key of allowedFields) {
          if (updates[key] !== undefined) {
            safeUpdates[key] = updates[key];
          }
        }
        safeUpdates.updated_at = new Date().toISOString();

        const { data, error } = await supabase
          .from('scheduled_rooms')
          .update(safeUpdates)
          .eq('id', scheduleId)
          .eq('host_id', hostId)
          .select()
          .single();

        if (error) throw error;

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, scheduledRoom: data }),
        };
      }

      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid action' }),
        };
    }

  } catch (error) {
    console.error('❌ Error managing scheduled rooms:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to manage scheduled rooms',
        message: error.message 
      }),
    };
  }
};
