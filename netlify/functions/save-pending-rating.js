'use strict';

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  try {
    const body = JSON.parse(event.body || '{}');

    if (event.httpMethod === 'DELETE') {
      // Clear pending rating
      const { userId, roomId } = body;
      
      if (!userId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'userId is required' }),
        };
      }

      const query = supabase.from('pending_ratings').delete().eq('user_id', userId);
      if (roomId) {
        query.eq('room_id', roomId);
      }

      await query;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true }),
      };
    }

    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }

    const { userId, roomId, otherUserId, otherUserName } = body;

    // Validate required fields
    if (!userId || !roomId || !otherUserId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields: userId, roomId, otherUserId' }),
      };
    }

    // Can't have pending rating for yourself
    if (userId === otherUserId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Cannot create pending rating for yourself' }),
      };
    }

    // Save the pending rating
    const { data, error } = await supabase
      .from('pending_ratings')
      .upsert({
        user_id: userId,
        room_id: roomId,
        other_user_id: otherUserId,
        other_user_name: otherUserName || null,
      }, {
        onConflict: 'user_id,room_id'
      })
      .select()
      .single();

    if (error) {
      // Handle table not existing
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        console.log('⚠️ pending_ratings table does not exist yet');
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, message: 'Pending rating noted (tables not yet created)' }),
        };
      }
      console.error('❌ Save pending rating error:', error);
      throw error;
    }

    console.log(`📝 Pending rating saved: ${userId} needs to rate ${otherUserId}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Pending rating saved',
      }),
    };

  } catch (error) {
    console.error('❌ Save pending rating error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to save pending rating',
        message: error.message,
      }),
    };
  }
};
