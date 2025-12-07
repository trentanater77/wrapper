'use strict';

/**
 * Forum Invite - Creates and manages invite codes
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
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { action, userId, forumId, inviteId, maxUses, expiresInHours } = JSON.parse(event.body || '{}');

    if (!userId) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Authentication required' }) };
    if (!forumId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'forumId required' }) };

    const { data: forum } = await supabase.from('forums').select('id, owner_id, slug').eq('id', forumId).single();
    if (!forum) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Forum not found' }) };

    const isOwner = forum.owner_id === userId;
    const { data: modStatus } = await supabase.from('forum_moderators').select('id').eq('forum_id', forumId).eq('user_id', userId).single();
    if (!isOwner && !modStatus) return { statusCode: 403, headers, body: JSON.stringify({ error: 'No permission to manage invites' }) };

    switch (action) {
      case 'create': {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let inviteCode = '';
        const bytes = crypto.randomBytes(8);
        for (let i = 0; i < 8; i++) inviteCode += chars[bytes[i] % chars.length];

        const expiresAt = expiresInHours ? new Date(Date.now() + expiresInHours * 3600000) : null;
        const { data: invite } = await supabase.from('forum_invites').insert({ forum_id: forumId, invite_code: inviteCode, created_by: userId, max_uses: maxUses || null, expires_at: expiresAt }).select().single();
        
        const baseUrl = process.env.URL || 'https://sphere.chatspheres.com';
        return { statusCode: 201, headers, body: JSON.stringify({ success: true, invite: { id: invite.id, code: invite.invite_code, url: `${baseUrl}/f/${forum.slug}?invite=${inviteCode}`, maxUses: invite.max_uses, expiresAt: invite.expires_at } }) };
      }
      case 'delete': {
        if (!inviteId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'inviteId required' }) };
        await supabase.from('forum_invites').delete().eq('id', inviteId).eq('forum_id', forumId);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Invite deleted' }) };
      }
      case 'list': {
        const { data: invites } = await supabase.from('forum_invites').select('*').eq('forum_id', forumId).eq('is_active', true).order('created_at', { ascending: false });
        const baseUrl = process.env.URL || 'https://sphere.chatspheres.com';
        return { statusCode: 200, headers, body: JSON.stringify({ invites: invites?.map(inv => ({ id: inv.id, code: inv.invite_code, url: `${baseUrl}/f/${forum.slug}?invite=${inv.invite_code}`, maxUses: inv.max_uses, useCount: inv.use_count, expiresAt: inv.expires_at })) || [] }) };
      }
      default:
        return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}` }) };
    }
  } catch (error) {
    console.error('❌ Error in forum invite:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Forum invite action failed', message: error.message }) };
  }
};
