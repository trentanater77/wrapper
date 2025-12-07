'use strict';

/**
 * Manage Room
 * 
 * Create, update, and manage active rooms (both Red and Green rooms)
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
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Content-Type': 'application/json',
};

// Generate a short invite code
function generateInviteCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // GET: List active rooms
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};
      const roomType = params.type; // 'red', 'green', or undefined for all
      const roomId = params.roomId; // Get specific room

      if (roomId) {
        // Get specific room
        const { data, error } = await supabase
          .from('active_rooms')
          .select('*')
          .eq('room_id', roomId)
          .single();

        if (error) {
          // Table might not exist yet
          if (error.code === '42P01' || error.message?.includes('does not exist')) {
            return {
              statusCode: 200,
              headers,
              body: JSON.stringify({ rooms: [] }),
            };
          }
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Room not found' }),
          };
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(data),
        };
      }

      // List rooms - filter out expired ones
      const now = new Date().toISOString();
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      
      console.log('🧹 Running expired room cleanup...');
      console.log('📅 Now:', now);
      console.log('📅 One hour ago:', oneHourAgo);
      console.log('📅 Three hours ago:', threeHoursAgo);
      
      // Cleanup 1: Mark rooms past their ends_at as ended
      const cleanup1 = await supabase
        .from('active_rooms')
        .update({ status: 'ended', ended_at: now })
        .eq('status', 'live')
        .not('ends_at', 'is', null)
        .lt('ends_at', now);
      console.log('🧹 Cleanup 1 (past ends_at):', cleanup1.error ? cleanup1.error.message : 'OK');
      
      // Cleanup 2: Mark old rooms without ends_at as ended (> 1 hour old)
      const cleanup2 = await supabase
        .from('active_rooms')
        .update({ status: 'ended', ended_at: now })
        .eq('status', 'live')
        .is('ends_at', null)
        .lt('started_at', oneHourAgo);
      console.log('🧹 Cleanup 2 (null ends_at, > 1hr):', cleanup2.error ? cleanup2.error.message : 'OK');
      
      // Cleanup 3: Mark any room started > 3 hours ago as ended (safety net)
      const cleanup3 = await supabase
        .from('active_rooms')
        .update({ status: 'ended', ended_at: now })
        .eq('status', 'live')
        .lt('started_at', threeHoursAgo);
      console.log('🧹 Cleanup 3 (> 3hrs old):', cleanup3.error ? cleanup3.error.message : 'OK');
      
      // Cleanup 4: Also mark 'voting' rooms older than 1 hour as ended
      const cleanup4 = await supabase
        .from('active_rooms')
        .update({ status: 'ended', ended_at: now })
        .eq('status', 'voting')
        .lt('started_at', oneHourAgo);
      console.log('🧹 Cleanup 4 (voting > 1hr):', cleanup4.error ? cleanup4.error.message : 'OK');
      
      console.log('🧹 Expired room cleanup completed');
      
      // Now fetch only active rooms that:
      // 1. Are public
      // 2. Have status 'live'
      // 3. Have ends_at in the future OR started within the last hour (for rooms without ends_at)
      let query = supabase
        .from('active_rooms')
        .select('*')
        .eq('is_public', true)
        .eq('status', 'live')
        .gt('ends_at', now) // Only rooms that haven't expired
        .order('started_at', { ascending: false })
        .limit(50);

      if (roomType) {
        query = query.eq('room_type', roomType);
      }

      const { data, error } = await query;
      
      console.log('📋 Found', data?.length || 0, 'active rooms');

      // Handle case where table doesn't exist yet
      if (error) {
        if (error.code === '42P01' || error.message?.includes('does not exist')) {
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
      console.error('❌ Error listing rooms:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to list rooms' }),
      };
    }
  }

  // POST: Create or update room
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
      case 'create': {
        const { 
          roomId, hostId, hostName, hostAvatar,
          roomType, topic, description, isPublic,
          durationMinutes 
        } = body;

        if (!roomId || !hostId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
              error: 'Missing required fields',
              required: ['roomId', 'hostId']
            }),
          };
        }

        // Check if room already exists
        let existingRoom = null;
        try {
          const { data, error: existingError } = await supabase
            .from('active_rooms')
            .select('*')
            .eq('room_id', roomId)
            .single();
          
          if (!existingError) {
            existingRoom = data;
          }
        } catch (e) {
          // Table might not exist yet
        }
        
        // If room exists and is still live, just increment participant count
        if (existingRoom && existingRoom.status === 'live') {
          // Update participant count
          const { data: updated, error: updateError } = await supabase
            .from('active_rooms')
            .update({ 
              participant_count: (existingRoom.participant_count || 0) + 1
            })
            .eq('room_id', roomId)
            .select()
            .single();
          
          if (updateError) {
            console.warn('⚠️ Could not update participant count:', updateError);
          }
          
          console.log(`🏠 Participant joined existing room: ${roomId}`);
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              room: updated || existingRoom,
              inviteCode: existingRoom.invite_code,
              inviteLink: `https://sphere.chatspheres.com/index.html?room=${roomId}&invite=${existingRoom.invite_code}`,
              existingRoom: true
            }),
          };
        }

        // Room doesn't exist or is ended - create new one
        if (!topic) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
              error: 'Topic is required to create a new room',
              required: ['roomId', 'hostId', 'topic']
            }),
          };
        }

        const duration = durationMinutes || 60;
        const endsAt = new Date(Date.now() + duration * 60 * 1000);
        const inviteCode = generateInviteCode();

        const { data, error } = await supabase
          .from('active_rooms')
          .upsert({
            room_id: roomId,
            host_id: hostId,
            host_name: hostName || 'Host',
            host_avatar: hostAvatar,
            room_type: roomType || 'red',
            topic: topic,
            description: description,
            is_public: isPublic !== false,
            participant_count: 1,
            spectator_count: 0,
            pot_amount: 0,
            status: 'live',
            started_at: new Date().toISOString(),
            ends_at: endsAt.toISOString(),
            invite_code: inviteCode,
          }, { onConflict: 'room_id' })
          .select()
          .single();

        // Handle table not existing yet (migration not run)
        if (error) {
          if (error.code === '42P01' || error.message?.includes('does not exist')) {
            console.log(`⚠️ active_rooms table not found - room will work via Firebase only`);
            // Still return success - room can work without DB entry
            return {
              statusCode: 200,
              headers,
              body: JSON.stringify({
                success: true,
                room: { room_id: roomId, room_type: roomType || 'red', topic },
                inviteCode,
                inviteLink: `https://sphere.chatspheres.com/index.html?room=${roomId}&invite=${inviteCode}`,
                warning: 'Room created but not saved to database (migration pending)'
              }),
            };
          }
          throw error;
        }

        console.log(`🏠 Room created: ${roomId} (${roomType || 'red'})`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            room: data,
            inviteCode,
            inviteLink: `https://sphere.chatspheres.com/index.html?room=${roomId}&invite=${inviteCode}`,
          }),
        };
      }

      case 'update-counts': {
        const { roomId, participantCount, spectatorCount } = body;

        if (!roomId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Room ID is required' }),
          };
        }

        const updates = {};
        if (typeof participantCount === 'number') updates.participant_count = participantCount;
        if (typeof spectatorCount === 'number') updates.spectator_count = spectatorCount;

        const { error } = await supabase
          .from('active_rooms')
          .update(updates)
          .eq('room_id', roomId);

        if (error) throw error;

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true }),
        };
      }

      case 'start-voting': {
        const { roomId, hostId } = body;

        if (!roomId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Room ID is required' }),
          };
        }

        // Verify host
        const { data: room } = await supabase
          .from('active_rooms')
          .select('host_id')
          .eq('room_id', roomId)
          .single();

        if (room && hostId && room.host_id !== hostId) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ error: 'Only the host can start voting' }),
          };
        }

        const { error } = await supabase
          .from('active_rooms')
          .update({ status: 'voting' })
          .eq('room_id', roomId);

        if (error) throw error;

        console.log(`🗳️ Voting started for room: ${roomId}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, status: 'voting' }),
        };
      }

      case 'end': {
        const { roomId, hostId } = body;

        if (!roomId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Room ID is required' }),
          };
        }

        const { error } = await supabase
          .from('active_rooms')
          .update({ 
            status: 'ended',
            ended_at: new Date().toISOString()
          })
          .eq('room_id', roomId);

        if (error) throw error;

        console.log(`🏁 Room ended: ${roomId}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true }),
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
    console.error('❌ Error managing room:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to manage room',
        message: error.message 
      }),
    };
  }
};
