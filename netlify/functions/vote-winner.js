'use strict';

/**
 * Vote for Winner (Red Room)
 * 
 * Allows spectators and participants to vote for who won the debate.
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
    const { roomId, voterId, votedFor, isDraw } = body;

    if (!roomId || !voterId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Room ID and voter ID are required' }),
      };
    }

    if (!isDraw && !votedFor) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Must vote for a participant or select draw' }),
      };
    }

    // Check if room exists and is in voting state
    const { data: roomData, error: roomError } = await supabase
      .from('active_rooms')
      .select('status')
      .eq('room_id', roomId)
      .single();

    if (roomError || !roomData) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Room not found' }),
      };
    }

    if (roomData.status === 'ended') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Voting has ended for this room' }),
      };
    }

    // Check if user already voted
    const { data: existingVote } = await supabase
      .from('room_votes')
      .select('id')
      .eq('room_id', roomId)
      .eq('voter_id', voterId)
      .single();

    if (existingVote) {
      // Update existing vote
      const { error: updateError } = await supabase
        .from('room_votes')
        .update({
          voted_for: isDraw ? null : votedFor,
          is_draw_vote: isDraw || false,
        })
        .eq('room_id', roomId)
        .eq('voter_id', voterId);

      if (updateError) throw updateError;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Vote updated',
          isDraw: isDraw || false,
        }),
      };
    }

    // Insert new vote
    const { error: insertError } = await supabase
      .from('room_votes')
      .insert({
        room_id: roomId,
        voter_id: voterId,
        voted_for: isDraw ? null : votedFor,
        is_draw_vote: isDraw || false,
      });

    if (insertError) {
      if (insertError.code === '23505') { // Unique constraint violation
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'You have already voted' }),
        };
      }
      throw insertError;
    }

    console.log(`🗳️ Vote recorded: ${voterId} voted for ${isDraw ? 'DRAW' : votedFor} in room ${roomId}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: isDraw ? 'Voted for draw' : 'Vote recorded',
        isDraw: isDraw || false,
      }),
    };

  } catch (error) {
    console.error('❌ Error recording vote:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to record vote',
        message: error.message 
      }),
    };
  }
};
