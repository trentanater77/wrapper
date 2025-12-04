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

    // Handle table not existing or no rows
    if (error) {
      // PGRST116 = no rows found, 42P01 = table doesn't exist
      if (error.code === 'PGRST116' || error.code === '42P01' || error.message?.includes('does not exist')) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ hasPending: false }),
        };
      }
      console.error('❌ Get pending rating error:', error);
      // Return no pending on error
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ hasPending: false }),
      };
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
    // Return no pending on error
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ hasPending: false }),
    };
  }
};
