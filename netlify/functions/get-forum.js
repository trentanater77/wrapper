'use strict';

/**
 * Get Forum - Retrieves a single forum by slug or ID
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  try {
    let slug, forumId, userId;
    if (event.httpMethod === 'GET') {
      slug = event.queryStringParameters?.slug;
      forumId = event.queryStringParameters?.id;
      userId = event.queryStringParameters?.userId;
    } else {
      const body = JSON.parse(event.body || '{}');
      slug = body.slug; forumId = body.id; userId = body.userId;
    }

    if (!slug && !forumId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'slug or id is required' }) };
    }

    let query = supabase.from('forums').select('*');
    query = forumId ? query.eq('id', forumId) : query.eq('slug', slug);
    const { data: forum, error } = await query.single();

    if (error || !forum || forum.deleted_at) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Forum not found' }) };
    }

    if (forum.forum_type === 'private') {
      if (!userId) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Private forum', requiresAuth: true }) };
      }
      const { data: membership } = await supabase.from('forum_members').select('role').eq('forum_id', forum.id).eq('user_id', userId).single();
      if (!membership) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Private forum', requiresInvite: true }) };
      }
    }

    let userMembership = null, userRole = null, isBanned = false, isMuted = false;
    if (userId) {
      const { data: membership } = await supabase.from('forum_members').select('role, joined_at, notifications_enabled').eq('forum_id', forum.id).eq('user_id', userId).single();
      if (membership) { userMembership = membership; userRole = membership.role; }
      
      if (!userRole || userRole === 'member') {
        const { data: modStatus } = await supabase.from('forum_moderators').select('id').eq('forum_id', forum.id).eq('user_id', userId).single();
        if (modStatus) userRole = 'moderator';
      }
      if (forum.owner_id === userId) userRole = 'owner';

      const { data: banStatus } = await supabase.from('forum_bans').select('id, expires_at').eq('forum_id', forum.id).eq('user_id', userId).single();
      if (banStatus && (!banStatus.expires_at || new Date(banStatus.expires_at) > new Date())) isBanned = true;

      const { data: muteStatus } = await supabase.from('forum_mutes').select('id, expires_at').eq('forum_id', forum.id).eq('user_id', userId).single();
      if (muteStatus && (!muteStatus.expires_at || new Date(muteStatus.expires_at) > new Date())) isMuted = true;
    }

    const { data: moderators } = await supabase.from('forum_moderators').select('user_id').eq('forum_id', forum.id).limit(50);
    const { data: announcements } = await supabase.from('forum_announcements').select('id, title, content, created_at').eq('forum_id', forum.id).eq('is_pinned', true).order('pin_order').limit(3);
    const { data: forumRooms } = await supabase.from('forum_rooms').select('*').eq('forum_id', forum.id).eq('status', 'live').order('started_at', { ascending: false }).limit(20);

    // Enrich forum rooms with participant counts from active_rooms table
    let activeRooms = [];
    if (forumRooms && forumRooms.length > 0) {
      const roomIds = forumRooms.map(r => r.room_id);
      const { data: activeRoomData } = await supabase
        .from('active_rooms')
        .select('room_id, participant_count, spectator_count, status, started_at, ended_at')
        .in('room_id', roomIds);
      
      // Create a map for quick lookup
      const activeRoomMap = {};
      const now = Date.now();
      const oldRoomThreshold = 30 * 60 * 1000; // 30 minutes - rooms older than this are likely stale
      const veryOldThreshold = 60 * 60 * 1000; // 1 hour - definitely stale
      const roomsToEnd = [];
      
      if (activeRoomData) {
        activeRoomData.forEach(ar => {
          activeRoomMap[ar.room_id] = ar;
          
          // Check if room is stale
          const startedAt = new Date(ar.started_at).getTime();
          const age = now - startedAt;
          const isEnded = ar.status === 'ended';
          const isEmpty = (ar.participant_count || 0) === 0;
          const isOld = age > oldRoomThreshold;
          const isVeryOld = age > veryOldThreshold;
          
          // Room should be ended if:
          // 1. It's already marked as ended in active_rooms
          // 2. It's empty (0 participants)
          // 3. It's older than 1 hour (ghost participants - leave beacons not sent)
          // 4. It's older than 30 min and empty
          if (isEnded || isEmpty || isVeryOld || (isOld && isEmpty)) {
            roomsToEnd.push(ar.room_id);
            console.log(`🧹 Room ${ar.room_id} marked for cleanup: ended=${isEnded}, empty=${isEmpty}, age=${Math.floor(age/60000)}min, participants=${ar.participant_count}`);
          }
        });
      }
      
      // Also check for forum rooms that don't have a matching active_room entry
      // OR forum rooms that are very old based on their started_at
      forumRooms.forEach(fr => {
        if (!activeRoomMap[fr.room_id]) {
          // No active_room entry - this forum room is orphaned
          roomsToEnd.push(fr.room_id);
          console.log(`🧹 Orphaned forum room ${fr.room_id} marked for cleanup`);
        } else {
          // Check if forum room itself is old
          const frStarted = new Date(fr.started_at).getTime();
          const frAge = now - frStarted;
          if (frAge > veryOldThreshold && !roomsToEnd.includes(fr.room_id)) {
            roomsToEnd.push(fr.room_id);
            console.log(`🧹 Old forum room ${fr.room_id} marked for cleanup: age=${Math.floor(frAge/60000)}min`);
          }
        }
      });
      
      // Clean up stale rooms - mark them as ended
      if (roomsToEnd.length > 0) {
        console.log(`🧹 Cleaning up ${roomsToEnd.length} stale forum rooms`);
        const endedAt = new Date().toISOString();
        
        // End in active_rooms
        await supabase
          .from('active_rooms')
          .update({ status: 'ended', ended_at: endedAt })
          .in('room_id', roomsToEnd)
          .eq('status', 'live');
        
        // End in forum_rooms
        await supabase
          .from('forum_rooms')
          .update({ status: 'ended', ended_at: endedAt })
          .in('room_id', roomsToEnd)
          .eq('status', 'live');
      }
      
      // Merge forum room data with active room counts, filtering out ended rooms
      activeRooms = forumRooms
        .filter(fr => !roomsToEnd.includes(fr.room_id))
        .map(fr => {
          const ar = activeRoomMap[fr.room_id] || {};
          return {
            ...fr,
            participant_count: ar.participant_count || 0,
            spectator_count: ar.spectator_count || 0,
            is_truly_live: ar.status === 'live' && (ar.participant_count || 0) >= 2
          };
        });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        forum: {
          id: forum.id, slug: forum.slug, name: forum.name, description: forum.description, rules: forum.rules,
          category: forum.category, tags: forum.tags, forumType: forum.forum_type, isNsfw: forum.is_nsfw,
          ownerId: forum.owner_id, iconUrl: forum.icon_url, bannerUrl: forum.banner_url,
          primaryColor: forum.primary_color, memberCount: forum.member_count, roomCount: forum.room_count,
          activeRoomCount: forum.active_room_count, createdAt: forum.created_at,
        },
        user: userId ? { isMember: !!userMembership, role: userRole, isBanned, isMuted, canModerate: ['moderator', 'owner'].includes(userRole), joinedAt: userMembership?.joined_at } : null,
        moderators: moderators?.map(m => m.user_id) || [],
        announcements: announcements || [],
        activeRooms: activeRooms,
      }),
    };
  } catch (error) {
    console.error('❌ Error getting forum:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to get forum', message: error.message }) };
  }
};
