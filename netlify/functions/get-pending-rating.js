'use strict';

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const userId = event.queryStringParameters?.userId;

    if (!userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'userId is required' }),
      };
    }

    // Get the most recent pending rating for this user
    const { data: pendingRating, error } = await supabase
      .from('pending_ratings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
      console.error('❌ Get pending rating error:', error);
      throw error;
    }

    if (!pendingRating) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          hasPending: false,
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        hasPending: true,
        pendingRating: {
          roomId: pendingRating.room_id,
          otherUserId: pendingRating.other_user_id,
          otherUserName: pendingRating.other_user_name,
          createdAt: pendingRating.created_at,
        },
      }),
    };

  } catch (error) {
    console.error('❌ Get pending rating error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to get pending rating',
        message: error.message,
      }),
    };
  }
};
