'use strict';

/**
 * List Forums - Returns forums with filters and sorting
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
    const params = event.httpMethod === 'GET' ? (event.queryStringParameters || {}) : JSON.parse(event.body || '{}');
    const { userId, filter = 'top', category, search, page = 1, limit = 20, includeNsfw = false } = params;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let query = supabase.from('forums').select('*', { count: 'exact' }).is('deleted_at', null).in('forum_type', ['public', 'unlisted']);
    if (!includeNsfw) query = query.eq('is_nsfw', false);
    if (category && category !== 'all') query = query.eq('category', category);
    if (search && filter === 'search') query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);

    if (filter === 'joined' && userId) {
      const { data: memberships } = await supabase.from('forum_members').select('forum_id').eq('user_id', userId);
      if (!memberships?.length) {
        return { statusCode: 200, headers, body: JSON.stringify({ forums: [], pagination: { page: pageNum, limit: limitNum, total: 0, totalPages: 0 } }) };
      }
      const { data: forums, count } = await supabase.from('forums').select('*', { count: 'exact' }).in('id', memberships.map(m => m.forum_id)).is('deleted_at', null).order('name').range(offset, offset + limitNum - 1);
      return { statusCode: 200, headers, body: JSON.stringify({ forums: formatForums(forums), pagination: { page: pageNum, limit: limitNum, total: count || 0, totalPages: Math.ceil((count || 0) / limitNum) } }) };
    }

    switch (filter) {
      case 'new': query = query.order('created_at', { ascending: false }); break;
      case 'live': query = query.gt('active_room_count', 0).order('active_room_count', { ascending: false }); break;
      case 'trending': query = query.order('active_room_count', { ascending: false }); break;
      case 'search': query = query.order('member_count', { ascending: false }); break;
      default: query = query.order('member_count', { ascending: false });
    }

    query = query.range(offset, offset + limitNum - 1);
    const { data: forums, count, error } = await query;
    if (error) throw error;

    let userMemberships = {};
    if (userId && forums?.length) {
      const { data: memberships } = await supabase.from('forum_members').select('forum_id, role').eq('user_id', userId).in('forum_id', forums.map(f => f.id));
      memberships?.forEach(m => { userMemberships[m.forum_id] = m.role; });
    }

    const formattedForums = formatForums(forums).map(f => ({ ...f, userRole: userMemberships[f.id] || null, isMember: !!userMemberships[f.id] }));

    return { statusCode: 200, headers, body: JSON.stringify({ forums: formattedForums, pagination: { page: pageNum, limit: limitNum, total: count || 0, totalPages: Math.ceil((count || 0) / limitNum) } }) };
  } catch (error) {
    console.error('❌ Error listing forums:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to list forums', message: error.message }) };
  }
};

function formatForums(forums) {
  return (forums || []).map(f => ({
    id: f.id, slug: f.slug, name: f.name, description: f.description, category: f.category, tags: f.tags,
    forumType: f.forum_type, isNsfw: f.is_nsfw, ownerId: f.owner_id, iconUrl: f.icon_url, bannerUrl: f.banner_url,
    primaryColor: f.primary_color, memberCount: f.member_count, roomCount: f.room_count, activeRoomCount: f.active_room_count, createdAt: f.created_at,
  }));
}
