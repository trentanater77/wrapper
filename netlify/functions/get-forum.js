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
    const { data: activeRooms } = await supabase.from('forum_rooms').select('*').eq('forum_id', forum.id).eq('status', 'live').order('started_at', { ascending: false }).limit(20);

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
        activeRooms: activeRooms || [],
      }),
    };
  } catch (error) {
    console.error('❌ Error getting forum:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to get forum', message: error.message }) };
  }
};
