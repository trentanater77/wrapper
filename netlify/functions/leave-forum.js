'use strict';

/**
 * Leave Forum - Allows a user to leave a forum
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { userId, forumId, forumSlug } = JSON.parse(event.body || '{}');
    
    if (!userId) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Authentication required' }) };
    if (!forumId && !forumSlug) return { statusCode: 400, headers, body: JSON.stringify({ error: 'forumId or forumSlug required' }) };

    let query = supabase.from('forums').select('id, slug, name, owner_id');
    query = forumId ? query.eq('id', forumId) : query.eq('slug', forumSlug);
    const { data: forum, error } = await query.single();
    
    if (error || !forum) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Forum not found' }) };
    if (forum.owner_id === userId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Owners cannot leave. Transfer ownership first.', isOwner: true }) };

    const { data: membership } = await supabase.from('forum_members').select('id').eq('forum_id', forum.id).eq('user_id', userId).single();
    if (!membership) return { statusCode: 200, headers, body: JSON.stringify({ success: true, wasNotMember: true }) };

    await supabase.from('forum_members').delete().eq('forum_id', forum.id).eq('user_id', userId);
    await supabase.from('forum_moderators').delete().eq('forum_id', forum.id).eq('user_id', userId);

    // Decrement member count on the forum
    await supabase.rpc('decrement_member_count', { forum_id_param: forum.id }).catch(async () => {
      // Fallback: direct update if RPC doesn't exist
      const { data: currentForum } = await supabase.from('forums').select('member_count').eq('id', forum.id).single();
      if (currentForum) {
        await supabase.from('forums').update({ member_count: Math.max(0, (currentForum.member_count || 1) - 1) }).eq('id', forum.id);
      }
    });

    console.log(`✅ User ${userId} left forum ${forum.slug}`);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, forum: { id: forum.id, slug: forum.slug, name: forum.name } }) };
  } catch (error) {
    console.error('❌ Error leaving forum:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to leave forum', message: error.message }) };
  }
};
