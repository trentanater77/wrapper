'use strict';

/**
 * Forum Moderation - Handles ban, mute, add/remove mods, announcements
 * 
 * SANITIZED: XSS prevention on announcement titles, content, forum updates
 */

const { createClient } = require('@supabase/supabase-js');
const { sanitizeText, sanitizeTextarea, sanitizeTags, sanitizeUrl } = require('./utils/sanitize');

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
    const body = JSON.parse(event.body || '{}');
    const { action, userId, forumId, targetUserId, reason, duration, announcementId, title, content, roomId, forumData, newOwnerId } = body;

    if (!userId) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Authentication required' }) };
    if (!forumId || !action) return { statusCode: 400, headers, body: JSON.stringify({ error: 'forumId and action required' }) };

    const { data: forum } = await supabase.from('forums').select('*').eq('id', forumId).single();
    if (!forum) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Forum not found' }) };

    const isOwner = forum.owner_id === userId;
    const { data: modStatus } = await supabase.from('forum_moderators').select('can_ban, can_mute, can_delete_rooms, can_pin').eq('forum_id', forumId).eq('user_id', userId).single();
    const canModerate = isOwner || !!modStatus;

    if (!canModerate) return { statusCode: 403, headers, body: JSON.stringify({ error: 'No permission' }) };

    switch (action) {
      case 'ban': {
        if (!targetUserId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'targetUserId required' }) };
        if (!isOwner && !modStatus?.can_ban) return { statusCode: 403, headers, body: JSON.stringify({ error: 'No ban permission' }) };
        if (targetUserId === forum.owner_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Cannot ban owner' }) };
        const expiresAt = duration ? new Date(Date.now() + duration * 3600000) : null;
        await supabase.from('forum_members').delete().eq('forum_id', forumId).eq('user_id', targetUserId);
        await supabase.from('forum_moderators').delete().eq('forum_id', forumId).eq('user_id', targetUserId);
        await supabase.from('forum_bans').upsert({ forum_id: forumId, user_id: targetUserId, banned_by: userId, reason, expires_at: expiresAt }, { onConflict: 'forum_id,user_id' });
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'User banned' }) };
      }
      case 'unban': {
        if (!targetUserId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'targetUserId required' }) };
        await supabase.from('forum_bans').delete().eq('forum_id', forumId).eq('user_id', targetUserId);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'User unbanned' }) };
      }
      case 'mute': {
        if (!targetUserId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'targetUserId required' }) };
        if (!isOwner && !modStatus?.can_mute) return { statusCode: 403, headers, body: JSON.stringify({ error: 'No mute permission' }) };
        const expiresAt = duration ? new Date(Date.now() + duration * 3600000) : null;
        await supabase.from('forum_mutes').upsert({ forum_id: forumId, user_id: targetUserId, muted_by: userId, reason, expires_at: expiresAt }, { onConflict: 'forum_id,user_id' });
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'User muted' }) };
      }
      case 'unmute': {
        if (!targetUserId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'targetUserId required' }) };
        await supabase.from('forum_mutes').delete().eq('forum_id', forumId).eq('user_id', targetUserId);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'User unmuted' }) };
      }
      case 'addMod': {
        if (!isOwner) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Only owner can add mods' }) };
        if (!targetUserId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'targetUserId required' }) };
        await supabase.from('forum_moderators').upsert({ forum_id: forumId, user_id: targetUserId, added_by: userId }, { onConflict: 'forum_id,user_id' });
        await supabase.from('forum_members').update({ role: 'moderator' }).eq('forum_id', forumId).eq('user_id', targetUserId);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Moderator added' }) };
      }
      case 'removeMod': {
        if (!isOwner) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Only owner can remove mods' }) };
        await supabase.from('forum_moderators').delete().eq('forum_id', forumId).eq('user_id', targetUserId);
        await supabase.from('forum_members').update({ role: 'member' }).eq('forum_id', forumId).eq('user_id', targetUserId);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Moderator removed' }) };
      }
      case 'pin': {
        if (!title) return { statusCode: 400, headers, body: JSON.stringify({ error: 'title required' }) };
        if (!isOwner && !modStatus?.can_pin) return { statusCode: 403, headers, body: JSON.stringify({ error: 'No pin permission' }) };
        const { count } = await supabase.from('forum_announcements').select('id', { count: 'exact' }).eq('forum_id', forumId).eq('is_pinned', true);
        if (count >= 3) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Max 3 pins allowed' }) };
        // Sanitize announcement title and content for XSS prevention
        const cleanTitle = sanitizeText(title, 200);
        const cleanContent = content ? sanitizeTextarea(content, 2000) : null;
        const { data: announcement } = await supabase.from('forum_announcements').insert({ forum_id: forumId, title: cleanTitle, content: cleanContent, created_by: userId, pin_order: count || 0 }).select().single();
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, announcement }) };
      }
      case 'unpin': {
        if (!announcementId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'announcementId required' }) };
        await supabase.from('forum_announcements').update({ is_pinned: false }).eq('id', announcementId).eq('forum_id', forumId);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Unpinned' }) };
      }
      case 'updateForum': {
        if (!isOwner) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Only owner can update' }) };
        const updateData = {};
        // Sanitize all forum fields for XSS prevention
        if (forumData?.name !== undefined) updateData.name = sanitizeText(forumData.name, 100);
        if (forumData?.description !== undefined) updateData.description = sanitizeTextarea(forumData.description, 1000);
        if (forumData?.rules !== undefined) updateData.rules = sanitizeTextarea(forumData.rules, 2000);
        if (forumData?.category !== undefined) updateData.category = forumData.category;
        if (forumData?.tags !== undefined) updateData.tags = sanitizeTags(forumData.tags, 10, 30);
        if (forumData?.forum_type !== undefined) updateData.forum_type = forumData.forum_type;
        if (forumData?.is_nsfw !== undefined) updateData.is_nsfw = Boolean(forumData.is_nsfw);
        if (forumData?.icon_url !== undefined) updateData.icon_url = forumData.icon_url ? sanitizeUrl(forumData.icon_url) : null;
        if (forumData?.banner_url !== undefined) updateData.banner_url = forumData.banner_url ? sanitizeUrl(forumData.banner_url) : null;
        // Validate color format (hex only)
        const hexColorPattern = /^#[0-9A-Fa-f]{6}$/;
        if (forumData?.primary_color !== undefined) updateData.primary_color = hexColorPattern.test(forumData.primary_color) ? forumData.primary_color : null;
        if (forumData?.secondary_color !== undefined) updateData.secondary_color = hexColorPattern.test(forumData.secondary_color) ? forumData.secondary_color : null;
        updateData.updated_at = new Date().toISOString();
        await supabase.from('forums').update(updateData).eq('id', forumId);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Forum updated' }) };
      }
      case 'deleteForum': {
        if (!isOwner) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Only owner can delete' }) };
        await supabase.from('forums').update({ deleted_at: new Date().toISOString() }).eq('id', forumId);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Forum deleted' }) };
      }
      case 'transferOwnership': {
        if (!isOwner) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Only owner can transfer' }) };
        if (!newOwnerId || newOwnerId === userId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid newOwnerId' }) };
        await supabase.from('forums').update({ owner_id: newOwnerId, updated_at: new Date().toISOString() }).eq('id', forumId);
        await supabase.from('forum_members').update({ role: 'member' }).eq('forum_id', forumId).eq('user_id', userId);
        await supabase.from('forum_members').update({ role: 'owner' }).eq('forum_id', forumId).eq('user_id', newOwnerId);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Ownership transferred' }) };
      }
      default:
        return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}` }) };
    }
  } catch (error) {
    console.error('❌ Error in forum moderation:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Moderation failed', message: error.message }) };
  }
};
