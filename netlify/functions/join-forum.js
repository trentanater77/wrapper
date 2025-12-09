'use strict';

/**
 * Join Forum - Allows a user to join a forum
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
    const { userId, forumId, forumSlug, inviteCode } = JSON.parse(event.body || '{}');
    
    if (!userId) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Authentication required' }) };
    if (!forumId && !forumSlug) return { statusCode: 400, headers, body: JSON.stringify({ error: 'forumId or forumSlug required' }) };

    let query = supabase.from('forums').select('*');
    query = forumId ? query.eq('id', forumId) : query.eq('slug', forumSlug);
    const { data: forum, error } = await query.single();
    
    if (error || !forum || forum.deleted_at) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Forum not found' }) };

    const { data: banStatus } = await supabase.from('forum_bans').select('id, expires_at, reason').eq('forum_id', forum.id).eq('user_id', userId).single();
    if (banStatus && (!banStatus.expires_at || new Date(banStatus.expires_at) > new Date())) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'You are banned from this forum', reason: banStatus.reason }) };
    }

    const { data: existing } = await supabase.from('forum_members').select('id, role').eq('forum_id', forum.id).eq('user_id', userId).single();
    if (existing) return { statusCode: 200, headers, body: JSON.stringify({ success: true, alreadyMember: true, role: existing.role }) };

    if (forum.forum_type === 'private') {
      if (!inviteCode) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Invite code required', requiresInvite: true }) };
      
      const { data: invite } = await supabase.from('forum_invites').select('*').eq('forum_id', forum.id).eq('invite_code', inviteCode).eq('is_active', true).single();
      if (!invite) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Invalid invite code' }) };
      if (invite.expires_at && new Date(invite.expires_at) < new Date()) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Invite expired' }) };
      if (invite.max_uses && invite.use_count >= invite.max_uses) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Invite usage limit reached' }) };
      
      await supabase.from('forum_invites').update({ use_count: invite.use_count + 1 }).eq('id', invite.id);
    }

    const { error: joinError } = await supabase.from('forum_members').insert({ forum_id: forum.id, user_id: userId, role: 'member' });
    if (joinError?.code === '23505') return { statusCode: 200, headers, body: JSON.stringify({ success: true, alreadyMember: true }) };
    if (joinError) throw joinError;

    // Increment member count on the forum
    await supabase.rpc('increment_member_count', { forum_id_param: forum.id }).catch(() => {
      // Fallback: direct update if RPC doesn't exist
      supabase.from('forums').update({ member_count: forum.member_count + 1 }).eq('id', forum.id);
    });

    console.log(`✅ User ${userId} joined forum ${forum.slug} (ID: ${forum.id})`);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, forum: { id: forum.id, slug: forum.slug, name: forum.name }, role: 'member' }) };
  } catch (error) {
    console.error('❌ Error joining forum:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to join forum', message: error.message }) };
  }
};
