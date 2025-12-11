'use strict';

/**
 * Manage Queue
 * 
 * Handle queue operations for Creator Rooms:
 * - Join queue (user or guest)
 * - Leave queue
 * - Get queue status
 * - Next challenger (host only)
 * - Challenger done
 */

const { createClient } = require('@supabase/supabase-js');

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

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // GET: Get queue status for a room
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};
      const { roomId, userId, guestSessionId } = params;

      if (!roomId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Room ID is required' }),
        };
      }

      // Get full queue for the room
      const { data: queue, error: queueError } = await supabase
        .from('room_queue')
        .select('*')
        .eq('room_id', roomId)
        .eq('status', 'waiting')
        .order('position', { ascending: true });

      if (queueError) {
        // Table might not exist yet
        if (queueError.code === '42P01') {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ queue: [], position: null, totalInQueue: 0 }),
          };
        }
        throw queueError;
      }

      // Get current active challenger
      const { data: activeChallenger } = await supabase
        .from('room_queue')
        .select('*')
        .eq('room_id', roomId)
        .eq('status', 'active')
        .single();

      // Find user's position if they're in queue
      let userPosition = null;
      let userStatus = null;
      
      if (userId || guestSessionId) {
        const userEntry = queue.find(q => 
          (userId && q.user_id === userId) || 
          (guestSessionId && q.guest_session_id === guestSessionId)
        );
        
        if (userEntry) {
          userPosition = userEntry.position;
          userStatus = userEntry.status;
        } else if (activeChallenger) {
          // Check if user is the active challenger
          if ((userId && activeChallenger.user_id === userId) ||
              (guestSessionId && activeChallenger.guest_session_id === guestSessionId)) {
            userStatus = 'active';
            userPosition = 0; // Currently active
          }
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          queue: queue.map(q => ({
            id: q.id,
            position: q.position,
            name: q.user_id ? null : q.guest_name, // Don't expose user IDs
            isUser: q.user_id ? true : false,
            joinedAt: q.joined_at,
          })),
          activeChallenger: activeChallenger ? {
            id: activeChallenger.id,
            name: activeChallenger.guest_name || 'Challenger',
            isUser: !!activeChallenger.user_id,
            userId: activeChallenger.user_id,
            startedAt: activeChallenger.called_at,
          } : null,
          position: userPosition,
          userStatus,
          totalInQueue: queue.length,
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

  // POST: Queue operations
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { action, roomId } = body;

    if (!roomId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Room ID is required' }),
      };
    }

    switch (action) {
      case 'join': {
        const { userId, userName, guestName, guestSessionId } = body;

        // Must have either userId or guestSessionId
        if (!userId && !guestSessionId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'User ID or guest session ID is required' }),
          };
        }

        // Check if room exists and is a creator room
        const { data: room, error: roomError } = await supabase
          .from('active_rooms')
          .select('room_type, is_creator_room, max_queue_size, host_id')
          .eq('room_id', roomId)
          .eq('status', 'live')
          .single();

        if (roomError || !room) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Room not found or not live' }),
          };
        }

        if (room.room_type !== 'creator' && !room.is_creator_room) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'This room does not have a queue' }),
          };
        }

        // Check if host is trying to join their own queue
        if (userId && room.host_id === userId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Host cannot join their own queue' }),
          };
        }

        // Check if already in queue
        let existingQuery = supabase
          .from('room_queue')
          .select('*')
          .eq('room_id', roomId)
          .in('status', ['waiting', 'active']);

        if (userId) {
          existingQuery = existingQuery.eq('user_id', userId);
        } else {
          existingQuery = existingQuery.eq('guest_session_id', guestSessionId);
        }

        const { data: existing } = await existingQuery.single();

        if (existing) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              message: 'Already in queue',
              position: existing.position,
              status: existing.status,
              alreadyInQueue: true,
            }),
          };
        }

        // Check queue size limit
        if (room.max_queue_size) {
          const { count } = await supabase
            .from('room_queue')
            .select('*', { count: 'exact', head: true })
            .eq('room_id', roomId)
            .eq('status', 'waiting');

          if (count >= room.max_queue_size) {
            return {
              statusCode: 400,
              headers,
              body: JSON.stringify({ error: 'Queue is full' }),
            };
          }
        }

        // Get next position
        const { data: lastInQueue } = await supabase
          .from('room_queue')
          .select('position')
          .eq('room_id', roomId)
          .eq('status', 'waiting')
          .order('position', { ascending: false })
          .limit(1)
          .single();

        const nextPosition = (lastInQueue?.position || 0) + 1;

        // Add to queue
        const queueEntry = {
          room_id: roomId,
          user_id: userId || null,
          guest_name: guestName || (userId ? userName : 'Guest'),
          guest_session_id: userId ? null : guestSessionId,
          position: nextPosition,
          status: 'waiting',
        };

        const { data: newEntry, error: insertError } = await supabase
          .from('room_queue')
          .insert(queueEntry)
          .select()
          .single();

        if (insertError) {
          // Handle unique constraint violation
          if (insertError.code === '23505') {
            return {
              statusCode: 200,
              headers,
              body: JSON.stringify({
                success: true,
                message: 'Already in queue',
                alreadyInQueue: true,
              }),
            };
          }
          throw insertError;
        }

        console.log(`🎯 User joined queue: ${roomId} at position ${nextPosition}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            position: nextPosition,
            queueId: newEntry.id,
          }),
        };
      }

      case 'leave': {
        const { userId, guestSessionId, queueId } = body;

        let query = supabase
          .from('room_queue')
          .update({ status: 'left', ended_at: new Date().toISOString() })
          .eq('room_id', roomId);

        if (queueId) {
          query = query.eq('id', queueId);
        } else if (userId) {
          query = query.eq('user_id', userId);
        } else if (guestSessionId) {
          query = query.eq('guest_session_id', guestSessionId);
        } else {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'User identification required' }),
          };
        }

        const { error } = await query;

        if (error) throw error;

        // Reorder remaining queue positions
        await reorderQueue(roomId);

        console.log(`👋 User left queue: ${roomId}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true }),
        };
      }

      case 'next': {
        // Host calls next challenger
        const { hostId } = body;

        // Verify host
        const { data: room, error: roomError } = await supabase
          .from('active_rooms')
          .select('host_id, challenger_time_limit')
          .eq('room_id', roomId)
          .single();

        if (roomError || !room) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Room not found' }),
          };
        }

        if (room.host_id !== hostId) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ error: 'Only the host can call next challenger' }),
          };
        }

        // End current challenger if any
        await supabase
          .from('room_queue')
          .update({ 
            status: 'completed', 
            ended_at: new Date().toISOString() 
          })
          .eq('room_id', roomId)
          .eq('status', 'active');

        // Get next in queue
        const { data: nextChallenger, error: nextError } = await supabase
          .from('room_queue')
          .select('*')
          .eq('room_id', roomId)
          .eq('status', 'waiting')
          .order('position', { ascending: true })
          .limit(1)
          .single();

        if (nextError || !nextChallenger) {
          // No one in queue
          await supabase
            .from('active_rooms')
            .update({
              current_challenger_id: null,
              current_challenger_name: null,
              current_challenger_started_at: null,
            })
            .eq('room_id', roomId);

          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              message: 'Queue is empty',
              nextChallenger: null,
            }),
          };
        }

        // Mark as active
        const now = new Date().toISOString();
        await supabase
          .from('room_queue')
          .update({ 
            status: 'active', 
            called_at: now 
          })
          .eq('id', nextChallenger.id);

        // Update room with current challenger
        await supabase
          .from('active_rooms')
          .update({
            current_challenger_id: nextChallenger.user_id,
            current_challenger_name: nextChallenger.guest_name || 'Challenger',
            current_challenger_started_at: now,
          })
          .eq('room_id', roomId);

        // Reorder remaining queue
        await reorderQueue(roomId);

        console.log(`🎯 Next challenger called: ${roomId} -> ${nextChallenger.guest_name || nextChallenger.user_id}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            nextChallenger: {
              id: nextChallenger.id,
              userId: nextChallenger.user_id,
              name: nextChallenger.guest_name || 'Challenger',
              isUser: !!nextChallenger.user_id,
              timeLimit: room.challenger_time_limit,
            },
          }),
        };
      }

      case 'done': {
        // Challenger clicks "I'm Done"
        const { userId, guestSessionId } = body;

        // Find and end the active entry
        let query = supabase
          .from('room_queue')
          .update({ 
            status: 'completed', 
            ended_at: new Date().toISOString() 
          })
          .eq('room_id', roomId)
          .eq('status', 'active');

        if (userId) {
          query = query.eq('user_id', userId);
        } else if (guestSessionId) {
          query = query.eq('guest_session_id', guestSessionId);
        }

        const { error } = await query;

        if (error) throw error;

        // Clear current challenger from room
        await supabase
          .from('active_rooms')
          .update({
            current_challenger_id: null,
            current_challenger_name: null,
            current_challenger_started_at: null,
          })
          .eq('room_id', roomId);

        console.log(`✅ Challenger finished: ${roomId}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true }),
        };
      }

      case 'clear': {
        // Host clears the entire queue
        const { hostId } = body;

        // Verify host
        const { data: room } = await supabase
          .from('active_rooms')
          .select('host_id')
          .eq('room_id', roomId)
          .single();

        if (!room || room.host_id !== hostId) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ error: 'Only the host can clear the queue' }),
          };
        }

        // Mark all waiting entries as left
        await supabase
          .from('room_queue')
          .update({ 
            status: 'left', 
            ended_at: new Date().toISOString() 
          })
          .eq('room_id', roomId)
          .in('status', ['waiting', 'active']);

        // Clear current challenger
        await supabase
          .from('active_rooms')
          .update({
            current_challenger_id: null,
            current_challenger_name: null,
            current_challenger_started_at: null,
          })
          .eq('room_id', roomId);

        console.log(`🧹 Queue cleared: ${roomId}`);

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

// Helper: Reorder queue positions after someone leaves
async function reorderQueue(roomId) {
  try {
    const { data: waitingQueue } = await supabase
      .from('room_queue')
      .select('id')
      .eq('room_id', roomId)
      .eq('status', 'waiting')
      .order('position', { ascending: true });

    if (!waitingQueue || waitingQueue.length === 0) return;

    // Update positions sequentially
    for (let i = 0; i < waitingQueue.length; i++) {
      await supabase
        .from('room_queue')
        .update({ position: i + 1 })
        .eq('id', waitingQueue[i].id);
    }
  } catch (error) {
    console.error('Error reordering queue:', error);
  }
}
