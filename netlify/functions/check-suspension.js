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

    // Check for active suspension
    const { data: suspension, error } = await supabase
      .from('user_suspensions')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .or('expires_at.is.null,expires_at.gt.now()')
      .order('suspended_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
      console.error('❌ Check suspension error:', error);
      throw error;
    }

    if (!suspension) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          isSuspended: false,
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        isSuspended: true,
        suspension: {
          reason: suspension.reason,
          suspendedAt: suspension.suspended_at,
          expiresAt: suspension.expires_at,
          isPermanent: !suspension.expires_at,
        },
      }),
    };

  } catch (error) {
    console.error('❌ Check suspension error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to check suspension',
        message: error.message,
      }),
    };
  }
};
