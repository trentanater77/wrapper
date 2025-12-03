'use strict';

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
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { raterId, ratedId, roomId, rating, feedback } = body;

    // Validate required fields
    if (!raterId || !ratedId || !roomId || !rating) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields: raterId, ratedId, roomId, rating' }),
      };
    }

    // Validate rating value
    if (!['good', 'bad'].includes(rating)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Rating must be "good" or "bad"' }),
      };
    }

    // Can't rate yourself
    if (raterId === ratedId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Cannot rate yourself' }),
      };
    }

    // Submit the rating
    const { data, error } = await supabase
      .from('user_ratings')
      .upsert({
        rater_id: raterId,
        rated_id: ratedId,
        room_id: roomId,
        rating: rating,
        feedback: feedback?.trim() || null,
      }, {
        onConflict: 'rater_id,rated_id,room_id'
      })
      .select()
      .single();

    if (error) {
      console.error('❌ Rating submission error:', error);
      throw error;
    }

    // Remove any pending rating for this user/room
    await supabase
      .from('pending_ratings')
      .delete()
      .eq('user_id', raterId)
      .eq('room_id', roomId);

    console.log(`✅ Rating submitted: ${raterId} rated ${ratedId} as ${rating}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Rating submitted successfully',
      }),
    };

  } catch (error) {
    console.error('❌ Submit rating error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to submit rating',
        message: error.message,
      }),
    };
  }
};
