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

function getEffectivePlanType(subscription) {
  const rawPlan = subscription?.plan_type || 'free';
  if (rawPlan === 'free') return 'free';

  const status = subscription?.status || 'active';
  const end = subscription?.current_period_end ? new Date(subscription.current_period_end) : null;

  if (status === 'canceled' && end && end.getTime() <= Date.now()) {
    return 'free';
  }

  return rawPlan;
}

async function isCreatorPartner(userId) {
  if (!userId) return false;
  try {
    const { data, error } = await supabase
      .from('creator_partners')
      .select('status')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();
    if (error) return false;
    return !!data;
  } catch (_) {
    return false;
  }
}

async function getUserPlanType(userId) {
  if (!userId) return 'free';
  try {
    const { data, error } = await supabase
      .from('user_subscriptions')
      .select('plan_type,status,current_period_end')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return 'free';
    return getEffectivePlanType(data);
  } catch (_) {
    return 'free';
  }
}

async function canCreateGreenRoom(hostId) {
  const plan = await getUserPlanType(hostId);
  return plan === 'host_pro' || plan === 'pro_bundle';
}

async function canCreateCreatorRoom(hostId) {
  const plan = await getUserPlanType(hostId);
  if (plan === 'host_pro' || plan === 'pro_bundle') return true;
  return await isCreatorPartner(hostId);
}

// Generate a short invite code
function generateInviteCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function getControlApiBaseUrl() {
  return (process.env.CONTROL_API_BASE_URL || process.env.LIVEKIT_CONTROL_API_BASE_URL || '').replace(/\/$/, '');
}

function getControlApiKey() {
  return process.env.CONTROL_API_KEY || process.env.LIVEKIT_CONTROL_API_KEY || '';
}

function getAppBaseUrl() {
  return (process.env.APP_BASE_URL || process.env.URL || 'https://tivoq.com').replace(/\/$/, '');
}

async function stopActiveRecording({ recordingId, roomName, roomUrl }) {
  const baseUrl = getControlApiBaseUrl();
  const apiKey = getControlApiKey();
  if (!baseUrl || !apiKey || !recordingId) return { attempted: false };

  try {
    const response = await fetch(`${baseUrl}/recordings/stop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ recordingId, roomName, roomUrl }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.warn('⚠️ Failed to stop recording:', response.status, response.statusText, errorText);
      return { attempted: true, ok: false };
    }

    return { attempted: true, ok: true };
  } catch (error) {
    console.warn('⚠️ Failed to stop recording (exception):', error.message);
    return { attempted: true, ok: false };
  }
}

async function clearCreatorRoomQueue(roomId, endedAt) {
  if (!roomId) return;
  try {
    await supabase
      .from('room_queue')
      .update({
        status: 'left',
        ended_at: endedAt,
      })
      .eq('room_id', roomId)
      .in('status', ['waiting', 'active']);
  } catch (error) {
    console.warn('⚠️ Failed to clear creator room queue:', error.message);
  }
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

        let forumRoomType = null;
        let forumId = null;
        const isForumRoom = typeof roomId === 'string' && roomId.startsWith('forum-');
        if (isForumRoom) {
          try {
            const { data: forumRoom, error: forumRoomError } = await supabase
              .from('forum_rooms')
              .select('room_type, forum_id')
              .eq('room_id', roomId)
              .single();
            if (!forumRoomError && forumRoom) {
              forumRoomType = forumRoom.room_type || null;
              forumId = forumRoom.forum_id || null;
            }
          } catch (e) {}
        }
        
        if (isEnded || isExpired || isStale) {
          const endedAt = new Date().toISOString();

          // Mark as ended if not already
          if (!isEnded) {
            const isCreator = data.room_type === 'creator' || data.is_creator_room === true;
            if (isCreator && isExpired) {
              await clearCreatorRoomQueue(roomId, endedAt);
              if (data.active_recording_id) {
                await stopActiveRecording({
                  recordingId: data.active_recording_id,
                  roomName: roomId,
                  roomUrl: roomId,
                });
              }
            }

            const fullUpdate = await supabase
              .from('active_rooms')
              .update({
                status: 'ended',
                ended_at: endedAt,
                ended_reason: isExpired ? 'expired' : isStale ? 'abandoned' : 'ended',
                ended_by: null,
                queue_cleared_at: isCreator ? endedAt : null,
                active_recording_id: isCreator ? null : undefined,
                recording_started_at: isCreator ? null : undefined,
                recording_stopped_at: data.active_recording_id ? endedAt : null,
              })
              .eq('room_id', roomId);

            if (fullUpdate.error) {
              await supabase
                .from('active_rooms')
                .update({ status: 'ended', ended_at: endedAt })
                .eq('room_id', roomId);
            }
          }
          
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
              room: { ...data, status: 'ended', forum_room_type: forumRoomType, forum_id: forumId },
              status: 'ended',
              reason: isEnded ? 'manually_ended' : isExpired ? 'expired' : 'abandoned'
            }),
          };
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ room: { ...data, forum_room_type: forumRoomType, forum_id: forumId }, status: 'live' }),
        };
      }

      // List rooms - filter out expired ones
      const now = new Date().toISOString();
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
      
      console.log('🧹 Running expired room cleanup (Jeff Bezos approved™)...');

      // Creator rooms: if 0 participants, shorten ends_at to now + 2 minutes.
      // This allows rooms that were already empty (even before this deploy) to auto-close reliably.
      const emptyCreatorEndsAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
      try {
        await supabase
          .from('active_rooms')
          .update({ ends_at: emptyCreatorEndsAt })
          .eq('status', 'live')
          .eq('room_type', 'creator')
          .eq('participant_count', 0)
          .gt('ends_at', emptyCreatorEndsAt);
      } catch (e) {}

      try {
        await supabase
          .from('active_rooms')
          .update({ ends_at: emptyCreatorEndsAt })
          .eq('status', 'live')
          .eq('room_type', 'creator')
          .eq('participant_count', 0)
          .is('ends_at', null);
      } catch (e) {}

      let expiredCreatorRooms = [];
      try {
        const { data: expiredCreatorData } = await supabase
          .from('active_rooms')
          .select('room_id, active_recording_id')
          .eq('status', 'live')
          .eq('room_type', 'creator')
          .not('ends_at', 'is', null)
          .lt('ends_at', now);
        expiredCreatorRooms = expiredCreatorData || [];
      } catch (e) {}
      
      // Cleanup 1: Mark rooms past their ends_at as ended
      const cleanup1 = await supabase
        .from('active_rooms')
        .update({ status: 'ended', ended_at: now })
        .eq('status', 'live')
        .not('ends_at', 'is', null)
        .lt('ends_at', now);
      console.log('🧹 Cleanup 1 (past ends_at):', cleanup1.error ? cleanup1.error.message : 'OK');

      if (expiredCreatorRooms.length > 0) {
        for (const room of expiredCreatorRooms) {
          const endedAt = now;
          await clearCreatorRoomQueue(room.room_id, endedAt);
          if (room.active_recording_id) {
            await stopActiveRecording({
              recordingId: room.active_recording_id,
              roomName: room.room_id,
              roomUrl: room.room_id,
            });
          }

          const updateResult = await supabase
            .from('active_rooms')
            .update({
              ended_reason: 'expired',
              ended_by: null,
              queue_cleared_at: endedAt,
              recording_stopped_at: room.active_recording_id ? endedAt : null,
            })
            .eq('room_id', room.room_id);
          void updateResult;
        }
      }
      
      // Cleanup 2: Mark old rooms without ends_at as ended (> 1 hour old)
      // EXCLUDE Creator rooms - they only end when host ends them (up to 8 hours)
      const cleanup2 = await supabase
        .from('active_rooms')
        .update({ status: 'ended', ended_at: now })
        .eq('status', 'live')
        .is('ends_at', null)
        .neq('room_type', 'creator')
        .lt('started_at', oneHourAgo);
      console.log('🧹 Cleanup 2 (null ends_at, > 1hr, non-creator):', cleanup2.error ? cleanup2.error.message : 'OK');
      
      // Cleanup 3: Mark any non-creator room started > 3 hours ago as ended (safety net)
      const cleanup3 = await supabase
        .from('active_rooms')
        .update({ status: 'ended', ended_at: now })
        .eq('status', 'live')
        .neq('room_type', 'creator')
        .lt('started_at', threeHoursAgo);
      console.log('🧹 Cleanup 3 (> 3hrs old, non-creator):', cleanup3.error ? cleanup3.error.message : 'OK');
      
      // Cleanup 4: Also mark 'voting' rooms older than 1 hour as ended
      const cleanup4 = await supabase
        .from('active_rooms')
        .update({ status: 'ended', ended_at: now })
        .eq('status', 'voting')
        .lt('started_at', oneHourAgo);
      console.log('🧹 Cleanup 4 (voting > 1hr):', cleanup4.error ? cleanup4.error.message : 'OK');
      
      // Cleanup 5: CRITICAL - Mark non-creator rooms with 0 participants that are > 15 minutes old
      const cleanup5 = await supabase
        .from('active_rooms')
        .update({ status: 'ended', ended_at: now })
        .eq('status', 'live')
        .eq('participant_count', 0)
        .neq('room_type', 'creator')
        .lt('started_at', fifteenMinutesAgo);
      console.log('🧹 Cleanup 5 (0 participants, > 15min, non-creator):', cleanup5.error ? cleanup5.error.message : 'OK');
      
      // Cleanup 6: Mark red rooms with only spectators (0 participants) older than 5 minutes
      const cleanup6 = await supabase
        .from('active_rooms')
        .update({ status: 'ended', ended_at: now })
        .eq('status', 'live')
        .eq('room_type', 'red')
        .eq('participant_count', 0)
        .lt('started_at', fiveMinutesAgo);
      console.log('🧹 Cleanup 6 (red room, 0 debaters, > 5min):', cleanup6.error ? cleanup6.error.message : 'OK');
      
      // Cleanup 7: Mark any non-creator room with 0 participants older than 2 hours as ended
      const cleanup7 = await supabase
        .from('active_rooms')
        .update({ status: 'ended', ended_at: now })
        .eq('status', 'live')
        .eq('participant_count', 0)
        .neq('room_type', 'creator')
        .lt('started_at', twoHoursAgo);
      console.log('🧹 Cleanup 7 (0 participants, > 2hr, non-creator):', cleanup7.error ? cleanup7.error.message : 'OK');
      
      // ============================================================
      // CREATOR ROOM SPECIFIC CLEANUP (Jeff Bezos Approved™)
      // ============================================================
      
      // Cleanup 8: Creator rooms - end if EMPTY (0 participants) for 2+ hours
      // If host left and no one is there, room is abandoned
      const cleanup8 = await supabase
        .from('active_rooms')
        .update({ status: 'ended', ended_at: now })
        .eq('status', 'live')
        .eq('room_type', 'creator')
        .eq('participant_count', 0)
        .lt('started_at', twoHoursAgo);
      console.log('🧹 Cleanup 8 (creator room, EMPTY, > 2hr):', cleanup8.error ? cleanup8.error.message : 'OK');
      
      // Cleanup 9: Creator rooms - end if only 1 participant (just host, no challengers) for 2+ hours
      // Host is lonely - no one came to chat
      const cleanup9 = await supabase
        .from('active_rooms')
        .update({ status: 'ended', ended_at: now })
        .eq('status', 'live')
        .eq('room_type', 'creator')
        .eq('participant_count', 1)
        .lt('started_at', twoHoursAgo);
      console.log('🧹 Cleanup 9 (creator room, 1 participant only, > 2hr):', cleanup9.error ? cleanup9.error.message : 'OK');
      
      // Cleanup 10: HARD LIMIT - ALL rooms (including active creator rooms) end after 8 HOURS
      // Even Jeff Bezos takes bathroom breaks. No room should run forever.
      const cleanup10 = await supabase
        .from('active_rooms')
        .update({ status: 'ended', ended_at: now })
        .eq('status', 'live')
        .lt('started_at', eightHoursAgo);
      console.log('🧹 Cleanup 10 (ANY room > 8hrs - HARD LIMIT):', cleanup10.error ? cleanup10.error.message : 'OK');
      
      console.log('🧹 Expired room cleanup completed (all rooms checked)');
      
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
            .select('room_id, room_type, forum_id')
            .in('room_id', forumRoomIds);
          
          if (!forumError && forumRooms) {
            forumRooms.forEach(fr => {
              forumRoomTypes[fr.room_id] = { room_type: fr.room_type, forum_id: fr.forum_id || null };
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
        forum_room_type: forumRoomTypes[room.room_id]?.room_type || null,
        forum_id: forumRoomTypes[room.room_id]?.forum_id || null
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
          roomType, topic, description, coverImageUrl, isPublic,
          durationMinutes,
          sessionDurationMinutes,
          // Creator room specific fields
          isCreatorRoom,
          challengerTimeLimit,
          maxQueueSize,
        } = body;

        const effectiveRoomType = roomType || 'red';
        const effectiveIsCreatorRoom = !!(isCreatorRoom || effectiveRoomType === 'creator');

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
          const updates = {
            participant_count: (existingRoom.participant_count || 0) + 1,
          };

          const isCreator = existingRoom.room_type === 'creator' || existingRoom.is_creator_room === true;
          if (isCreator && existingRoom.started_at && existingRoom.session_duration_minutes) {
            const durationMinutes = parseInt(existingRoom.session_duration_minutes, 10);
            if ([60, 120, 180].includes(durationMinutes)) {
              const originalEndsAt = new Date(
                new Date(existingRoom.started_at).getTime() + durationMinutes * 60 * 1000
              ).toISOString();
              updates.ends_at = originalEndsAt;
            }
          }

          // Update participant count
          const { data: updated, error: updateError } = await supabase
            .from('active_rooms')
            .update(updates)
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
              inviteLink: `${getAppBaseUrl()}/index.html?room=${roomId}&invite=${existingRoom.invite_code}`,
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

        if (effectiveRoomType === 'green') {
          const allowed = await canCreateGreenRoom(hostId);
          if (!allowed) {
            return {
              statusCode: 403,
              headers,
              body: JSON.stringify({
                error: 'Green Rooms require Host Pro subscription',
              }),
            };
          }
        }

        if (effectiveIsCreatorRoom) {
          const allowed = await canCreateCreatorRoom(hostId);
          if (!allowed) {
            return {
              statusCode: 403,
              headers,
              body: JSON.stringify({
                error: 'Creator Rooms require Host Pro or Creator Partner status',
              }),
            };
          }
        }

        let duration = parseInt(sessionDurationMinutes ?? durationMinutes ?? 60, 10) || 60;
        const inviteCode = generateInviteCode();

        // Determine if this is a creator room
        // (effectiveRoomType + effectiveIsCreatorRoom computed earlier for gating)

        if (effectiveIsCreatorRoom && ![60, 120, 180].includes(duration)) {
          duration = 60;
        }

        let endsAt = new Date(Date.now() + duration * 60 * 1000).toISOString();
        console.log(`📅 Room ends_at: ${endsAt}`);

        let { data, error } = await supabase
          .from('active_rooms')
          .upsert({
            room_id: roomId,
            host_id: hostId,
            host_name: hostName || 'Host',
            host_avatar: hostAvatar,
            room_type: effectiveRoomType,
            topic: topic,
            description: description,
            cover_image_url: coverImageUrl || null,
            is_public: isPublic !== false,
            participant_count: 1,
            spectator_count: 0,
            pot_amount: 0,
            status: 'live',
            started_at: new Date().toISOString(),
            ends_at: endsAt,
            invite_code: inviteCode,
            // Creator room specific fields
            is_creator_room: effectiveIsCreatorRoom,
            session_duration_minutes: effectiveIsCreatorRoom ? duration : null,
            challenger_time_limit: effectiveIsCreatorRoom ? (challengerTimeLimit || null) : null,
            max_queue_size: effectiveIsCreatorRoom ? (maxQueueSize || null) : null,
            current_challenger_id: null,
            current_challenger_name: null,
            current_challenger_started_at: null,
            current_challenger_queue_id: null,
            current_challenger_time_limit_seconds: null,
            current_challenger_expires_at: null,
            ended_reason: null,
            ended_by: null,
            queue_cleared_at: null,
            active_recording_id: null,
            recording_started_at: null,
            recording_stopped_at: null,
          }, { onConflict: 'room_id' })
          .select()
          .single();

        // Handle database errors gracefully
        if (error) {
          console.log(`⚠️ Database error: ${error.code} - ${error.message}`);
          
          // Check if it's a missing column error (cover_image_url not migrated yet)
          if (error.code === '42703' || error.message?.includes('column') || error.message?.includes('cover_image_url') || error.message?.includes('session_duration_minutes')) {
            console.log(`⚠️ Missing column - trying without cover_image_url`);
            
            // Retry without cover_image_url
            const { data: retryData, error: retryError } = await supabase
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
                ends_at: endsAt,
                invite_code: inviteCode,
                is_creator_room: effectiveIsCreatorRoom,
                challenger_time_limit: effectiveIsCreatorRoom ? (challengerTimeLimit || null) : null,
                max_queue_size: effectiveIsCreatorRoom ? (maxQueueSize || null) : null,
                current_challenger_id: null,
                current_challenger_name: null,
                current_challenger_started_at: null,
              }, { onConflict: 'room_id' })
              .select()
              .single();
            
            if (!retryError) {
              console.log(`🏠 Room created (without cover): ${roomId}`);
              return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                  success: true,
                  room: retryData,
                  inviteCode,
                  inviteLink: `${getAppBaseUrl()}/index.html?room=${roomId}&invite=${inviteCode}`,
                  warning: 'Cover image not saved - run migration to enable'
                }),
              };
            }
            // If retry also failed, continue to other error handling
            error = retryError;
          }
          
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
                inviteLink: `${getAppBaseUrl()}/index.html?room=${roomId}&invite=${inviteCode}`,
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
            inviteLink: `${getAppBaseUrl()}/index.html?room=${roomId}&invite=${inviteCode}`,
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

      case 'set-recording': {
        const { roomId, hostId, recordingId, roomName, roomUrl } = body;

        if (!roomId || !hostId || !recordingId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'roomId, hostId, and recordingId are required' }),
          };
        }

        const { data: room, error: fetchError } = await supabase
          .from('active_rooms')
          .select('host_id, room_type, is_creator_room, status')
          .eq('room_id', roomId)
          .single();

        if (fetchError || !room || room.status === 'ended') {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Room not found or already ended' }),
          };
        }

        if (room.host_id && room.host_id !== hostId) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ error: 'Only the host can set recording state' }),
          };
        }

        const isCreator = room?.room_type === 'creator' || room?.is_creator_room === true;
        if (!isCreator) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Recording state is only tracked for creator rooms' }),
          };
        }

        const nowIso = new Date().toISOString();
        const { error: updateError } = await supabase
          .from('active_rooms')
          .update({
            active_recording_id: recordingId,
            recording_started_at: nowIso,
            recording_stopped_at: null,
          })
          .eq('room_id', roomId);

        if (updateError) throw updateError;

        console.log(`🎬 Recording state set for room ${roomId}: ${recordingId}`);
        void roomName;
        void roomUrl;

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true }),
        };
      }

      case 'clear-recording': {
        const { roomId, hostId } = body;

        if (!roomId || !hostId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'roomId and hostId are required' }),
          };
        }

        const { data: room, error: fetchError } = await supabase
          .from('active_rooms')
          .select('host_id, room_type, is_creator_room, status')
          .eq('room_id', roomId)
          .single();

        if (fetchError || !room || room.status === 'ended') {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Room not found or already ended' }),
          };
        }

        if (room.host_id && room.host_id !== hostId) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ error: 'Only the host can clear recording state' }),
          };
        }

        const isCreator = room?.room_type === 'creator' || room?.is_creator_room === true;
        if (!isCreator) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Recording state is only tracked for creator rooms' }),
          };
        }

        const nowIso = new Date().toISOString();
        const { error: updateError } = await supabase
          .from('active_rooms')
          .update({
            active_recording_id: null,
            recording_stopped_at: nowIso,
          })
          .eq('room_id', roomId);

        if (updateError) throw updateError;

        console.log(`🛑 Recording state cleared for room ${roomId}`);

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
          .select('participant_count, spectator_count, status, room_type, is_creator_room, started_at, session_duration_minutes, ends_at')
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

        const isCreator = room?.room_type === 'creator' || room?.is_creator_room === true;
        const nextParticipantCount = typeof updates.participant_count === 'number' ? updates.participant_count : (room.participant_count || 0);
        const becameEmpty = isCreator && nextParticipantCount === 0;
        if (becameEmpty) {
          const emptyEndsAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
          const shouldShorten = !room?.ends_at || new Date(room.ends_at).getTime() > new Date(emptyEndsAt).getTime();
          if (shouldShorten) {
            try {
              await supabase
                .from('active_rooms')
                .update({ ends_at: emptyEndsAt })
                .eq('room_id', roomId)
                .eq('status', 'live');
            } catch (e) {}
          }
        }

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
        const { roomId, hostId, reason } = body;

        if (!roomId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Room ID is required' }),
          };
        }

        const endedAt = new Date().toISOString();

        let room = null;
        try {
          const { data: roomData, error: roomError } = await supabase
            .from('active_rooms')
            .select('host_id, room_type, is_creator_room, active_recording_id')
            .eq('room_id', roomId)
            .single();
          if (roomError) throw roomError;
          room = roomData;
        } catch (error) {
          const { error: minimalEndError } = await supabase
            .from('active_rooms')
            .update({
              status: 'ended',
              ended_at: endedAt,
            })
            .eq('room_id', roomId);

          if (minimalEndError) throw minimalEndError;

          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, warning: 'Room ended (migration pending)' }),
          };
        }

        if (room && hostId && room.host_id !== hostId) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ error: 'Only the host can end the room' }),
          };
        }

        const isCreator = room?.room_type === 'creator' || room?.is_creator_room === true;
        if (isCreator) {
          await clearCreatorRoomQueue(roomId, endedAt);
          if (room?.active_recording_id) {
            await stopActiveRecording({
              recordingId: room.active_recording_id,
              roomName: roomId,
              roomUrl: roomId,
            });
          }
        }

        const endedReason = typeof reason === 'string' && reason.trim() ? reason.trim() : 'host_ended';
        const endedBy = hostId || null;

        const fullEnd = await supabase
          .from('active_rooms')
          .update({
            status: 'ended',
            ended_at: endedAt,
            ended_reason: endedReason,
            ended_by: endedBy,
            queue_cleared_at: isCreator ? endedAt : null,
            current_challenger_id: null,
            current_challenger_name: null,
            current_challenger_started_at: null,
            current_challenger_queue_id: null,
            current_challenger_time_limit_seconds: null,
            current_challenger_expires_at: null,
            active_recording_id: null,
            recording_started_at: null,
            recording_stopped_at: room?.active_recording_id ? endedAt : null,
          })
          .eq('room_id', roomId);

        if (fullEnd.error) {
          const { error: minimalEndError } = await supabase
            .from('active_rooms')
            .update({
              status: 'ended',
              ended_at: endedAt,
            })
            .eq('room_id', roomId);
          if (minimalEndError) throw minimalEndError;
        }

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
