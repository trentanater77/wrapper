'use strict';

/**
 * Room Queue Management
 * 
 * Handles the queue system for creator rooms where:
 * - 1 host is permanent (participant 1)
 * - Spectators can queue up to become participant 2
 * - Host can "next" to cycle through queue
 */

const { createClient } = require('@supabase/supabase-js');

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

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // GET: Get queue for a room
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};
      const { roomId, userId } = params;

      if (!roomId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'roomId is required' }),
        };
      }

      // Get queue for this room
      const { data: queue, error } = await supabase
        .from('room_queue')
        .select('*')
        .eq('room_id', roomId)
        .eq('status', 'waiting')
        .order('position', { ascending: true });

      if (error) {
        // Table might not exist yet
        if (error.code === '42P01') {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ queue: [], count: 0, userPosition: null }),
          };
        }
        throw error;
      }

      // Find user's position if they provided userId
      let userPosition = null;
      if (userId) {
        const userEntry = queue.find(q => q.user_id === userId);
        if (userEntry) {
          userPosition = queue.indexOf(userEntry) + 1;
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          queue: queue || [],
          count: queue?.length || 0,
          userPosition,
        }),
      };

    } catch (error) {
      console.error('❌ Error getting queue:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to get queue' }),
      };
    }
  }

  // DELETE: Leave queue
  if (event.httpMethod === 'DELETE') {
    try {
      const body = JSON.parse(event.body || '{}');
      const { roomId, userId } = body;

      if (!roomId || !userId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'roomId and userId are required' }),
        };
      }

      // Remove from queue
      const { error } = await supabase
        .from('room_queue')
        .delete()
        .eq('room_id', roomId)
        .eq('user_id', userId);

      if (error && error.code !== '42P01') throw error;

      console.log(`👋 User ${userId} left queue for room ${roomId}`);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true }),
      };

    } catch (error) {
      console.error('❌ Error leaving queue:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to leave queue' }),
      };
    }
  }

  // POST: Various queue actions
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
      // Join the queue
      case 'join': {
        const { roomId, userId, userName, userAvatar } = body;

        if (!roomId || !userId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'roomId and userId are required' }),
          };
        }

        // Check if already in queue
        const { data: existing } = await supabase
          .from('room_queue')
          .select('id, position, status')
          .eq('room_id', roomId)
          .eq('user_id', userId)
          .single();

        if (existing && existing.status === 'waiting') {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              alreadyInQueue: true,
              position: existing.position,
            }),
          };
        }

        // Get current max position
        const { data: maxPos } = await supabase
          .from('room_queue')
          .select('position')
          .eq('room_id', roomId)
          .eq('status', 'waiting')
          .order('position', { ascending: false })
          .limit(1)
          .single();

        const newPosition = (maxPos?.position || 0) + 1;

        // Insert or update queue entry
        const { data: entry, error } = await supabase
          .from('room_queue')
          .upsert({
            room_id: roomId,
            user_id: userId,
            user_name: userName || 'Anonymous',
            user_avatar: userAvatar,
            position: newPosition,
            status: 'waiting',
            joined_at: new Date().toISOString(),
          }, { onConflict: 'room_id,user_id' })
          .select()
          .single();

        if (error) throw error;

        // Update queue count on room
        await supabase.rpc('update_room_queue_count', { p_room_id: roomId }).catch(() => {
          // RPC might not exist yet, update directly
          return supabase
            .from('active_rooms')
            .update({ queue_count: newPosition })
            .eq('room_id', roomId);
        });

        console.log(`📋 User ${userId} joined queue for room ${roomId} at position ${newPosition}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            position: newPosition,
            entry,
          }),
        };
      }

      // Host calls next person
      case 'next': {
        const { roomId, hostId } = body;

        if (!roomId || !hostId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'roomId and hostId are required' }),
          };
        }

        // Verify this is the host
        const { data: room } = await supabase
          .from('active_rooms')
          .select('host_id, current_challenger_id')
          .eq('room_id', roomId)
          .single();

        if (!room || room.host_id !== hostId) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ error: 'Only the host can call next' }),
          };
        }

        // Mark current challenger as done (if any)
        if (room.current_challenger_id) {
          await supabase
            .from('room_queue')
            .update({ status: 'joined' })
            .eq('room_id', roomId)
            .eq('user_id', room.current_challenger_id);
        }

        // Get next person in queue
        const { data: nextPerson } = await supabase
          .from('room_queue')
          .select('*')
          .eq('room_id', roomId)
          .eq('status', 'waiting')
          .order('position', { ascending: true })
          .limit(1)
          .single();

        if (!nextPerson) {
          // Update room to show no challenger
          await supabase
            .from('active_rooms')
            .update({ current_challenger_id: null })
            .eq('room_id', roomId);

          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              queueEmpty: true,
              message: 'No one in queue',
            }),
          };
        }

        // Mark this person as called
        await supabase
          .from('room_queue')
          .update({ 
            status: 'called',
            called_at: new Date().toISOString()
          })
          .eq('id', nextPerson.id);

        // Update room with current challenger
        await supabase
          .from('active_rooms')
          .update({ current_challenger_id: nextPerson.user_id })
          .eq('room_id', roomId);

        // Get updated queue count
        const { data: queueData } = await supabase
          .from('room_queue')
          .select('id')
          .eq('room_id', roomId)
          .eq('status', 'waiting');

        const newQueueCount = queueData?.length || 0;

        await supabase
          .from('active_rooms')
          .update({ queue_count: newQueueCount })
          .eq('room_id', roomId);

        console.log(`📢 Next called for room ${roomId}: ${nextPerson.user_name}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            nextPerson: {
              userId: nextPerson.user_id,
              userName: nextPerson.user_name,
              userAvatar: nextPerson.user_avatar,
            },
            remainingInQueue: newQueueCount,
          }),
        };
      }

      // Host skips someone in queue
      case 'skip': {
        const { roomId, hostId, skipUserId } = body;

        if (!roomId || !hostId || !skipUserId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'roomId, hostId, and skipUserId are required' }),
          };
        }

        // Verify this is the host
        const { data: room } = await supabase
          .from('active_rooms')
          .select('host_id')
          .eq('room_id', roomId)
          .single();

        if (!room || room.host_id !== hostId) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ error: 'Only the host can skip' }),
          };
        }

        // Mark as skipped
        await supabase
          .from('room_queue')
          .update({ status: 'skipped' })
          .eq('room_id', roomId)
          .eq('user_id', skipUserId);

        console.log(`⏭️ User ${skipUserId} skipped in room ${roomId}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true }),
        };
      }

      // Enable queue mode for a room
      case 'enable-queue-mode': {
        const { roomId, hostId } = body;

        if (!roomId || !hostId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'roomId and hostId are required' }),
          };
        }

        // Verify host and enable queue mode
        const { data, error } = await supabase
          .from('active_rooms')
          .update({ queue_mode: true })
          .eq('room_id', roomId)
          .eq('host_id', hostId)
          .select()
          .single();

        if (error) throw error;

        console.log(`🎤 Queue mode enabled for room ${roomId}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, room: data }),
        };
      }

      // Clear queue when room ends
      case 'clear': {
        const { roomId } = body;

        if (!roomId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'roomId is required' }),
          };
        }

        // Delete all queue entries for this room
        const { error } = await supabase
          .from('room_queue')
          .delete()
          .eq('room_id', roomId);

        if (error && error.code !== '42P01') throw error;

        console.log(`🧹 Queue cleared for room ${roomId}`);

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
    console.error('❌ Error managing queue:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to manage queue',
        message: error.message 
      }),
    };
  }
};
