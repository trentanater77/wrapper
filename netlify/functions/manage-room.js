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
              body: JSON.stringify({ room: null, status: 'not_found' }),
            };
          }
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ room: null, error: 'Room not found' }),
          };
        }

        // Check if room is actually still active
        const now = Date.now();
        const isEnded = data.status === 'ended';
        const isExpired = data.ends_at && new Date(data.ends_at).getTime() < now;
        const isEmpty = data.participant_count === 0 && data.room_type === 'red';
        const startedAt = new Date(data.started_at).getTime();
        const isStale = isEmpty && (now - startedAt) > 5 * 60 * 1000; // Empty for > 5 min
        
        if (isEnded || isExpired || isStale) {
          // Mark as ended if not already
          if (!isEnded) {
            await supabase
              .from('active_rooms')
              .update({ status: 'ended', ended_at: new Date().toISOString() })
              .eq('room_id', roomId);
          }
          
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
              room: { ...data, status: 'ended' },
              status: 'ended',
              reason: isEnded ? 'manually_ended' : isExpired ? 'expired' : 'abandoned'
            }),
          };
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ room: data, status: 'live' }),
        };
      }

      // List rooms - filter out expired ones
      const now = new Date().toISOString();
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      
      console.log('🧹 Running expired room cleanup...');
      
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
      
      // Cleanup 5: CRITICAL - Mark rooms with 0 participants that are > 15 minutes old
      // These are abandoned rooms where everyone left
      const cleanup5 = await supabase
        .from('active_rooms')
        .update({ status: 'ended', ended_at: now })
        .eq('status', 'live')
        .eq('participant_count', 0)
        .lt('started_at', fifteenMinutesAgo);
      console.log('🧹 Cleanup 5 (0 participants, > 15min):', cleanup5.error ? cleanup5.error.message : 'OK');
      
      // Cleanup 6: Mark rooms with only spectators (0 participants) older than 5 minutes
      // A debate can't happen without debaters
      const cleanup6 = await supabase
        .from('active_rooms')
        .update({ status: 'ended', ended_at: now })
        .eq('status', 'live')
        .eq('room_type', 'red')
        .eq('participant_count', 0)
        .lt('started_at', fiveMinutesAgo);
      console.log('🧹 Cleanup 6 (red room, 0 debaters, > 5min):', cleanup6.error ? cleanup6.error.message : 'OK');
      
      // Cleanup 7: Mark any room with 0 participants older than 2 hours as ended
      // These are definitely abandoned rooms
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const cleanup7 = await supabase
        .from('active_rooms')
        .update({ status: 'ended', ended_at: now })
        .eq('status', 'live')
        .eq('participant_count', 0)
        .lt('started_at', twoHoursAgo);
      console.log('🧹 Cleanup 7 (0 participants, > 2hr):', cleanup7.error ? cleanup7.error.message : 'OK');
      
      console.log('🧹 Expired room cleanup completed');
      
      // Now fetch only active rooms that:
      // 1. Are public
      // 2. Have status 'live'
      // 3. Have ends_at in the future OR started within the last hour
      // 4. Have at least some activity (participants or spectators) OR are very recent
      let query = supabase
        .from('active_rooms')
        .select('*')
        .eq('is_public', true)
        .eq('status', 'live')
        .order('started_at', { ascending: false })
        .limit(50);

      if (roomType) {
        query = query.eq('room_type', roomType);
      }

      const { data: allRooms, error } = await query;
      
      // Additional server-side filtering for rooms that should be shown:
      // - ends_at must be in the future, OR
      // - Room must have participants OR be very recent (< 5 min)
      // - NOT a forum room (forum rooms are displayed in /f/{slug})
      const nowTime = Date.now();
      const fiveMinutesMs = 5 * 60 * 1000;
      
      const data = (allRooms || []).filter(room => {
        // Include forum rooms - they now display on /live page too with special badge
        // Forum room IDs start with "forum-"
        const isForumRoom = room.room_id && room.room_id.startsWith('forum-');
        
        // If room has ends_at, check if it's still in the future
        if (room.ends_at) {
          const endsAtTime = new Date(room.ends_at).getTime();
          if (endsAtTime < nowTime) {
            console.log(`🚫 Filtering out expired room: ${room.room_id}`);
            return false;
          }
        }
        
        // For red rooms (non-forum), must have at least 1 participant OR be very recent
        if (room.room_type === 'red' && !isForumRoom) {
          const startedAt = new Date(room.started_at).getTime();
          const isRecent = (nowTime - startedAt) < fiveMinutesMs;
          const hasParticipants = room.participant_count > 0;
          
          if (!hasParticipants && !isRecent) {
            console.log(`🚫 Filtering out empty red room: ${room.room_id}`);
            return false;
          }
        }
        
        return true;
      });
      
      console.log('📋 Found', data?.length || 0, 'active rooms (after filtering)');

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
      
      // For forum rooms, try to get the forum_room_type from forum_rooms table
      // This tells us if it's a 'live' (chat), 'debate', or 'help' room
      const forumRoomIds = data.filter(r => r.room_id?.startsWith('forum-')).map(r => r.room_id);
      let forumRoomTypes = {};
      
      if (forumRoomIds.length > 0) {
        try {
          const { data: forumRooms, error: forumError } = await supabase
            .from('forum_rooms')
            .select('room_id, room_type')
            .in('room_id', forumRoomIds);
          
          if (!forumError && forumRooms) {
            forumRooms.forEach(fr => {
              forumRoomTypes[fr.room_id] = fr.room_type;
            });
            console.log('📋 Forum room types loaded:', Object.keys(forumRoomTypes).length);
          }
        } catch (e) {
          console.warn('⚠️ Could not load forum room types:', e.message);
        }
      }
      
      // Merge forum_room_type into results
      const enrichedData = data.map(room => ({
        ...room,
        forum_room_type: forumRoomTypes[room.room_id] || null
      }));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ rooms: enrichedData || [] }),
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
          durationMinutes,
          // Creator room specific fields
          isCreatorRoom,
          challengerTimeLimit,
          maxQueueSize,
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

        // Determine if this is a creator room
        const effectiveRoomType = roomType || 'red';
        const effectiveIsCreatorRoom = isCreatorRoom || effectiveRoomType === 'creator';

        const { data, error } = await supabase
          .from('active_rooms')
          .upsert({
            room_id: roomId,
            host_id: hostId,
            host_name: hostName || 'Host',
            host_avatar: hostAvatar,
            room_type: effectiveRoomType,
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
            // Creator room specific fields
            is_creator_room: effectiveIsCreatorRoom,
            challenger_time_limit: effectiveIsCreatorRoom ? (challengerTimeLimit || null) : null,
            max_queue_size: effectiveIsCreatorRoom ? (maxQueueSize || null) : null,
            current_challenger_id: null,
            current_challenger_name: null,
            current_challenger_started_at: null,
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
                room: { 
                  room_id: roomId, 
                  room_type: effectiveRoomType, 
                  topic,
                  is_creator_room: effectiveIsCreatorRoom,
                },
                inviteCode,
                inviteLink: `https://sphere.chatspheres.com/index.html?room=${roomId}&invite=${inviteCode}`,
                warning: 'Room created but not saved to database (migration pending)'
              }),
            };
          }
          throw error;
        }

        console.log(`🏠 Room created: ${roomId} (${effectiveRoomType}${effectiveIsCreatorRoom ? ' - Creator Room' : ''})`);

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

      case 'leave': {
        // User is leaving the room - decrement appropriate count
        const { roomId, isSpectator } = body;

        if (!roomId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Room ID is required' }),
          };
        }

        // Get current room data
        const { data: room, error: fetchError } = await supabase
          .from('active_rooms')
          .select('participant_count, spectator_count, status')
          .eq('room_id', roomId)
          .single();

        if (fetchError || !room || room.status === 'ended') {
          // Room doesn't exist or already ended - that's fine
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, message: 'Room not found or ended' }),
          };
        }

        // Decrement the appropriate count
        const updates = {};
        if (isSpectator) {
          updates.spectator_count = Math.max(0, (room.spectator_count || 0) - 1);
        } else {
          updates.participant_count = Math.max(0, (room.participant_count || 0) - 1);
        }

        const { error } = await supabase
          .from('active_rooms')
          .update(updates)
          .eq('room_id', roomId);

        if (error) {
          console.error('Error updating count on leave:', error);
        }

        console.log(`👋 User left room ${roomId} (spectator: ${isSpectator}). New counts: participant=${updates.participant_count ?? room.participant_count}, spectator=${updates.spectator_count ?? room.spectator_count}`);

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

        const endedAt = new Date().toISOString();

        // End in active_rooms
        const { error } = await supabase
          .from('active_rooms')
          .update({ 
            status: 'ended',
            ended_at: endedAt
          })
          .eq('room_id', roomId);

        if (error) throw error;

        // Also end in forum_rooms if this was a forum room
        try {
          await supabase
            .from('forum_rooms')
            .update({ 
              status: 'ended',
              ended_at: endedAt
            })
            .eq('room_id', roomId);
          console.log(`🏁 Forum room also ended: ${roomId}`);
        } catch (forumError) {
          // Not a forum room or table doesn't exist - ignore
          console.log(`ℹ️ No forum room to end for: ${roomId}`);
        }

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
