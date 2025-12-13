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

  // Verify Supabase configuration
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('❌ Missing Supabase configuration');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server configuration error', message: 'Database not configured' }),
    };
  }

  // GET: Get queue status for a room
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};
      const { roomId, userId, guestSessionId } = params;

      console.log('📥 GET queue request:', { roomId, userId, guestSessionId });

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
        .order('queue_position', { ascending: true });
      
      console.log('📋 Queue query result:', { queue, queueError });

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
          userPosition = userEntry.queue_position;
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
            position: q.queue_position,
            name: q.guest_name || 'Guest', // Use guest_name which stores actual username for all users
            isUser: q.user_id ? true : false,
            joinedAt: q.joined_at,
          })),
          activeChallenger: activeChallenger ? {
            id: activeChallenger.id,
            name: activeChallenger.guest_name || 'Challenger',
            isUser: !!activeChallenger.user_id,
            userId: activeChallenger.user_id,
            guestSessionId: activeChallenger.guest_session_id,
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

        console.log('🎯 JOIN queue request:', { roomId, userId, userName, guestName, guestSessionId });
        console.log('🎯 Full request body:', JSON.stringify(body));

        // Must have either userId or guestSessionId
        if (!userId && !guestSessionId) {
          console.log('❌ No user ID or guest session ID provided');
          console.log('❌ Body received:', JSON.stringify(body));
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
              error: 'User ID or guest session ID is required',
              received: { userId, guestSessionId, hasBody: !!body }
            }),
          };
        }

        // Check if room exists and is a creator room
        let room, roomError;
        try {
          const result = await supabase
            .from('active_rooms')
            .select('room_type, is_creator_room, max_queue_size, host_id')
            .eq('room_id', roomId)
            .eq('status', 'live')
            .single();
          room = result.data;
          roomError = result.error;
        } catch (e) {
          console.error('❌ Room lookup exception:', e);
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Database error during room lookup', message: e.message }),
          };
        }

        console.log('🏠 Room lookup result:', { room, roomError });
        
        if (roomError || !room) {
          console.log('❌ Room not found:', roomError);
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Room not found or not live', details: roomError?.message }),
          };
        }

        if (room.room_type !== 'creator' && !room.is_creator_room) {
          console.log('❌ Room is not a creator room:', room.room_type, room.is_creator_room);
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'This room does not have a queue' }),
          };
        }
        
        console.log('✅ Room is valid creator room');

        // Check if host is trying to join their own queue
        if (userId && room.host_id === userId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Host cannot join their own queue' }),
          };
        }

        // Check if already in queue
        let existing = null;
        try {
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

          const { data, error: existingError } = await existingQuery.single();
          
          // Error code PGRST116 means no rows found, which is expected
          if (existingError && existingError.code !== 'PGRST116') {
            console.log('⚠️ Existing check query note:', existingError.code, existingError.message);
          }
          
          existing = data;
        } catch (e) {
          console.error('❌ Check existing exception:', e);
          // Continue - treat as not in queue
        }

        if (existing) {
          console.log('✅ Already in queue:', existing);
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              message: 'Already in queue',
              position: existing.queue_position,
              status: existing.status,
              alreadyInQueue: true,
            }),
          };
        }
        
        console.log('✅ Not already in queue, proceeding to join');

        // Check queue size limit
        if (room.max_queue_size) {
          try {
            const { count, error: countError } = await supabase
              .from('room_queue')
              .select('*', { count: 'exact', head: true })
              .eq('room_id', roomId)
              .eq('status', 'waiting');

            console.log('📊 Queue count:', count, countError);

            if (!countError && count >= room.max_queue_size) {
              return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Queue is full' }),
              };
            }
          } catch (e) {
            console.error('❌ Queue count exception:', e);
            // Continue - don't block join if count check fails
          }
        }

        // Get next position
        let nextPosition = 1;
        try {
          const { data: lastInQueue, error: posError } = await supabase
            .from('room_queue')
            .select('queue_position')
            .eq('room_id', roomId)
            .eq('status', 'waiting')
            .order('queue_position', { ascending: false })
            .limit(1)
            .single();

          console.log('📍 Last in queue:', lastInQueue, posError);
          nextPosition = (lastInQueue?.queue_position || 0) + 1;
        } catch (e) {
          console.error('❌ Position lookup exception:', e);
          // Default to position 1
        }
        
        console.log('📍 Next position will be:', nextPosition);

        // Add to queue
        const queueEntry = {
          room_id: roomId,
          user_id: userId || null,
          guest_name: guestName || (userId ? userName : 'Guest'),
          guest_session_id: userId ? null : guestSessionId,
          queue_position: nextPosition,
          status: 'waiting',
        };

        console.log('📝 Inserting queue entry:', queueEntry);
        
        let newEntry, insertError;
        try {
          const result = await supabase
            .from('room_queue')
            .insert(queueEntry)
            .select()
            .single();
          newEntry = result.data;
          insertError = result.error;
        } catch (e) {
          console.error('❌ Insert exception:', e);
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
              error: 'Database insert failed', 
              message: e.message,
              queueEntry 
            }),
          };
        }

        console.log('📝 Insert result:', { newEntry, insertError });

        if (insertError) {
          console.log('❌ Insert error:', insertError);
          console.log('❌ Insert error code:', insertError.code);
          console.log('❌ Insert error message:', insertError.message);
          console.log('❌ Insert error details:', insertError.details);
          
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
          
          // Handle table not found
          if (insertError.code === '42P01') {
            return {
              statusCode: 500,
              headers,
              body: JSON.stringify({ 
                error: 'Queue table not found. Please run database migrations.',
                code: insertError.code
              }),
            };
          }
          
          // Handle other errors with more detail
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
              error: 'Failed to join queue',
              message: insertError.message,
              code: insertError.code,
              hint: insertError.hint || null
            }),
          };
        }

        console.log(`✅ User joined queue: ${roomId} at position ${nextPosition}`);

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

        // Get current active challenger before ending them
        const { data: previousChallenger } = await supabase
          .from('room_queue')
          .select('id, user_id, guest_session_id, guest_name')
          .eq('room_id', roomId)
          .eq('status', 'active')
          .single();

        // End current challenger if any
        if (previousChallenger) {
          await supabase
            .from('room_queue')
            .update({ 
              status: 'completed', 
              ended_at: new Date().toISOString() 
            })
            .eq('id', previousChallenger.id);
          
          console.log('👋 Previous challenger ended:', previousChallenger.guest_name || previousChallenger.user_id);
        }

        // Get next in queue
        const { data: nextChallenger, error: nextError } = await supabase
          .from('room_queue')
          .select('*')
          .eq('room_id', roomId)
          .eq('status', 'waiting')
          .order('queue_position', { ascending: true })
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
              guestSessionId: nextChallenger.guest_session_id,
              name: nextChallenger.guest_name || 'Challenger',
              isUser: !!nextChallenger.user_id,
              timeLimit: room.challenger_time_limit,
            },
            previousChallenger: previousChallenger ? {
              id: previousChallenger.id,
              userId: previousChallenger.user_id,
              guestSessionId: previousChallenger.guest_session_id,
              name: previousChallenger.guest_name || 'Challenger',
            } : null,
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
    console.error('❌ Error details:', JSON.stringify(error, null, 2));
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to manage queue',
        message: error.message,
        code: error.code,
        details: error.details || error.hint || null
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
      .order('queue_position', { ascending: true });

    if (!waitingQueue || waitingQueue.length === 0) return;

    // Update positions sequentially
    for (let i = 0; i < waitingQueue.length; i++) {
      await supabase
        .from('room_queue')
        .update({ queue_position: i + 1 })
        .eq('id', waitingQueue[i].id);
    }
  } catch (error) {
    console.error('Error reordering queue:', error);
  }
}
