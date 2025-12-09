'use strict';

/**
 * Check Email Verification Status
 * 
 * Checks if a user's email has been verified via Supabase auth.
 * Used to enforce email verification before accessing certain features.
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  try {
    let userId;
    
    if (event.httpMethod === 'GET') {
      userId = event.queryStringParameters?.userId;
    } else if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      userId = body.userId;
    }

    if (!userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'userId is required' }),
      };
    }

    // Get user from Supabase auth
    const { data: { user }, error } = await supabase.auth.admin.getUserById(userId);

    if (error) {
      console.error('❌ Error fetching user:', error);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          isVerified: true, // Fail open to not block users on error
          error: 'Could not verify status'
        }),
      };
    }

    if (!user) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'User not found' }),
      };
    }

    // Check email_confirmed_at field
    const isVerified = !!user.email_confirmed_at;
    const provider = user.app_metadata?.provider || 'email';
    
    // OAuth users (Google, etc.) are considered verified
    const isOAuthUser = provider !== 'email';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        isVerified: isVerified || isOAuthUser,
        email: user.email,
        provider,
        verifiedAt: user.email_confirmed_at,
        // If not verified, indicate they need to verify
        needsVerification: !isVerified && !isOAuthUser,
      }),
    };

  } catch (error) {
    console.error('❌ Check email verification error:', error);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        isVerified: true, // Fail open
        error: 'Verification check failed'
      }),
    };
  }
};
