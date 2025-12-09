'use strict';

/**
 * Forum Room - Creates/updates/ends rooms within forums
 * 
 * RATE LIMITED: CREATE tier (30/hour) for create, STANDARD tier (60/min) for update/end
 * SANITIZED: XSS prevention on room titles, descriptions
 */

const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit, getClientIP, rateLimitResponse, RATE_LIMITS } = require('./utils/rate-limiter');
const { sanitizeText, sanitizeTextarea, sanitizeDisplayName } = require('./utils/sanitize');

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
    const { action, userId, forumId, forumSlug, roomId, roomUrl, title, description, hostName, roomType, peakViewers } = body;
    
    // Rate limiting (different tiers for create vs update/end)
    const clientIP = getClientIP(event);
    const rateConfig = action === 'create' ? RATE_LIMITS.CREATE : RATE_LIMITS.STANDARD;
    const rateLimitResult = await checkRateLimit(supabase, clientIP, rateConfig, `forum-room-${action || 'unknown'}`);
    if (!rateLimitResult.allowed) {
      return rateLimitResponse(rateLimitResult, rateConfig);
    }

    if (!userId) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Authentication required' }) };
    if (!action) return { statusCode: 400, headers, body: JSON.stringify({ error: 'action required' }) };

    let forum;
    if (forumId) {
      const { data } = await supabase.from('forums').select('*').eq('id', forumId).single();
      forum = data;
    } else if (forumSlug) {
      const { data } = await supabase.from('forums').select('*').eq('slug', forumSlug).single();
      forum = data;
    }
    if (!forum) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Forum not found' }) };

    const { data: banStatus } = await supabase.from('forum_bans').select('id, expires_at').eq('forum_id', forum.id).eq('user_id', userId).single();
    if (banStatus && (!banStatus.expires_at || new Date(banStatus.expires_at) > new Date())) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'You are banned from this forum' }) };
    }

    switch (action) {
      case 'create': {
        if (!roomId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'roomId required' }) };
        const { data: membership } = await supabase.from('forum_members').select('role').eq('forum_id', forum.id).eq('user_id', userId).single();
        if (!membership) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Must be member to create room', requiresMembership: true }) };

        const validRoomType = ['live', 'scheduled', 'lounge', 'debate', 'help'].includes(roomType) ? roomType : 'live';
        if (validRoomType === 'lounge' && forum.owner_id !== userId) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'Only owner can create lounge' }) };
        }

        // Sanitize inputs for XSS prevention
        const cleanTitle = sanitizeText(title, 200) || 'Untitled Room';
        const cleanDescription = description ? sanitizeTextarea(description, 1000) : null;
        const cleanHostName = sanitizeDisplayName(hostName, 50);

        const { data: room, error } = await supabase.from('forum_rooms').insert({
          forum_id: forum.id, room_id: roomId, room_url: roomUrl, title: cleanTitle,
          description: cleanDescription, host_id: userId, host_name: cleanHostName, room_type: validRoomType, status: 'live',
        }).select().single();
        if (error) throw error;

        console.log(`📺 Room created in forum ${forum.slug}: ${roomId}`);
        return { statusCode: 201, headers, body: JSON.stringify({ success: true, room: { id: room.id, roomId: room.room_id, forumSlug: forum.slug } }) };
      }
      case 'update': {
        if (!roomId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'roomId required' }) };
        
        // SECURITY: Verify user owns this room or is a forum moderator
        const { data: roomToUpdate } = await supabase.from('forum_rooms').select('host_id').eq('forum_id', forum.id).eq('room_id', roomId).single();
        if (!roomToUpdate) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Room not found' }) };
        
        const isRoomHost = roomToUpdate.host_id === userId;
        const isForumOwner = forum.owner_id === userId;
        const { data: modCheck } = await supabase.from('forum_moderators').select('id').eq('forum_id', forum.id).eq('user_id', userId).single();
        const isForumMod = !!modCheck;
        
        if (!isRoomHost && !isForumOwner && !isForumMod) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'Only the room host or forum moderators can update this room' }) };
        }
        
        const updateData = {};
        // Sanitize inputs for XSS prevention
        if (title !== undefined) updateData.title = sanitizeText(title, 200);
        if (description !== undefined) updateData.description = description ? sanitizeTextarea(description, 1000) : null;
        if (peakViewers !== undefined) updateData.peak_viewers = peakViewers;
        if (!Object.keys(updateData).length) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No fields to update' }) };
        await supabase.from('forum_rooms').update(updateData).eq('forum_id', forum.id).eq('room_id', roomId);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Room updated' }) };
      }
      case 'end': {
        if (!roomId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'roomId required' }) };
        
        // SECURITY: Verify user owns this room or is a forum moderator
        const { data: roomToEnd } = await supabase.from('forum_rooms').select('host_id').eq('forum_id', forum.id).eq('room_id', roomId).single();
        if (!roomToEnd) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Room not found' }) };
        
        const isRoomHostEnd = roomToEnd.host_id === userId;
        const isForumOwnerEnd = forum.owner_id === userId;
        const { data: modCheckEnd } = await supabase.from('forum_moderators').select('id').eq('forum_id', forum.id).eq('user_id', userId).single();
        const isForumModEnd = !!modCheckEnd;
        
        if (!isRoomHostEnd && !isForumOwnerEnd && !isForumModEnd) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'Only the room host or forum moderators can end this room' }) };
        }
        
        await supabase.from('forum_rooms').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('forum_id', forum.id).eq('room_id', roomId);
        console.log(`🔴 Room ended in forum ${forum.slug}: ${roomId}`);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Room ended' }) };
      }
      default:
        return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}` }) };
    }
  } catch (error) {
    console.error('❌ Error in forum room:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Forum room action failed', message: error.message }) };
  }
};
