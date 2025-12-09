'use strict';

const { createClient } = require('@supabase/supabase-js');

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

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // GET - Check muted users for a room
  if (event.httpMethod === 'GET') {
    try {
      const roomId = event.queryStringParameters?.roomId;

      if (!roomId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'roomId is required' }),
        };
      }

      const { data: mutes, error } = await supabase
        .from('muted_chat_users')
        .select('muted_user_id')
        .eq('room_id', roomId);

      // Handle table not existing
      if (error) {
        if (error.code === '42P01' || error.message?.includes('does not exist')) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ mutedUserIds: [] }),
          };
        }
        console.error('❌ Get mutes error:', error);
        // Return empty on error
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ mutedUserIds: [] }),
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          mutedUserIds: mutes?.map(m => m.muted_user_id) || [],
        }),
      };

    } catch (error) {
      console.error('❌ Get mutes error:', error);
      // Return empty on error
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ mutedUserIds: [] }),
      };
    }
  }

  // POST - Mute or unmute a user
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { roomId, hostId, mutedUserId, action } = body;

    // Validate required fields
    if (!roomId || !hostId || !mutedUserId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields: roomId, hostId, mutedUserId' }),
      };
    }

    // Can't mute yourself
    if (hostId === mutedUserId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Cannot mute yourself' }),
      };
    }

    // SECURITY: Verify the hostId is actually the host of this room
    const { data: roomData, error: roomError } = await supabase
      .from('active_rooms')
      .select('host_id')
      .eq('room_id', roomId)
      .single();

    if (roomError || !roomData) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Room not found' }),
      };
    }

    if (roomData.host_id !== hostId) {
      console.log(`⚠️ Unauthorized mute attempt: ${hostId} tried to mute in room owned by ${roomData.host_id}`);
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Only the room host can mute users' }),
      };
    }

    if (action === 'unmute') {
      // Remove the mute
      const { error } = await supabase
        .from('muted_chat_users')
        .delete()
        .eq('room_id', roomId)
        .eq('muted_user_id', mutedUserId);

      if (error) {
        throw error;
      }

      console.log(`🔊 Unmuted: Host ${hostId} unmuted ${mutedUserId} in room ${roomId}`);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'User unmuted',
        }),
      };
    } else {
      // Add the mute
      const { error } = await supabase
        .from('muted_chat_users')
        .upsert({
          room_id: roomId,
          muted_user_id: mutedUserId,
          host_id: hostId,
        }, {
          onConflict: 'room_id,muted_user_id'
        });

      if (error) {
        throw error;
      }

      console.log(`🔇 Muted: Host ${hostId} muted ${mutedUserId} in room ${roomId}`);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'User muted',
        }),
      };
    }

  } catch (error) {
    console.error('❌ Mute user error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to mute/unmute user',
        message: error.message,
      }),
    };
  }
};
