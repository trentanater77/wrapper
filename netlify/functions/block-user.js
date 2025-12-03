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
    const { blockerId, blockedId, action } = body;

    // Validate required fields
    if (!blockerId || !blockedId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields: blockerId, blockedId' }),
      };
    }

    // Can't block yourself
    if (blockerId === blockedId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Cannot block yourself' }),
      };
    }

    if (action === 'unblock') {
      // Remove the block
      const { error } = await supabase
        .from('user_blocks')
        .delete()
        .eq('blocker_id', blockerId)
        .eq('blocked_id', blockedId);

      if (error) {
        console.error('❌ Unblock error:', error);
        throw error;
      }

      console.log(`✅ Unblocked: ${blockerId} unblocked ${blockedId}`);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'User unblocked successfully',
        }),
      };
    } else {
      // Add the block
      const { data, error } = await supabase
        .from('user_blocks')
        .upsert({
          blocker_id: blockerId,
          blocked_id: blockedId,
        }, {
          onConflict: 'blocker_id,blocked_id'
        })
        .select()
        .single();

      if (error) {
        console.error('❌ Block error:', error);
        throw error;
      }

      console.log(`🚫 Blocked: ${blockerId} blocked ${blockedId}`);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'User blocked successfully',
        }),
      };
    }

  } catch (error) {
    console.error('❌ Block user error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to block/unblock user',
        message: error.message,
      }),
    };
  }
};
