'use strict';

/**
 * Get KYC Verification Status
 * 
 * Returns the user's current KYC verification status.
 */

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
        body: JSON.stringify({ error: 'User ID is required' }),
      };
    }

    // Get KYC status
    const { data: kyc, error } = await supabase
      .from('kyc_verifications')
      .select('status, verified_at, first_name, last_name')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      throw error;
    }

    const isVerified = kyc?.status === 'verified';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        verified: isVerified,
        status: kyc?.status || 'unverified',
        verifiedAt: kyc?.verified_at || null,
        firstName: kyc?.first_name || null,
        lastName: kyc?.last_name || null,
      }),
    };

  } catch (error) {
    console.error('❌ Error getting KYC status:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to get verification status',
        message: error.message 
      }),
    };
  }
};
