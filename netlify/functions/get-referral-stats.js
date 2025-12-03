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
  // Handle CORS preflight
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

    // Get referral stats for this user
    // Note: This requires a 'referrals' table in Supabase with:
    // - id (uuid, primary key)
    // - referrer_user_id (uuid, foreign key to auth.users)
    // - referred_user_id (uuid, foreign key to auth.users, nullable)
    // - referral_code (text, unique for each user)
    // - status (text: 'clicked', 'signed_up', 'active', 'rewarded')
    // - gems_awarded_referrer (integer, default 0)
    // - gems_awarded_referred (integer, default 0)
    // - created_at (timestamp)
    // - updated_at (timestamp)

    // Get all referrals where this user is the referrer
    const { data: referrals, error: referralsError } = await supabase
      .from('referrals')
      .select('*')
      .eq('referrer_user_id', userId);

    if (referralsError) {
      console.log('Referrals table may not exist yet:', referralsError.message);
      // Return empty stats if table doesn't exist
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          clicks: 0,
          signups: 0,
          active: 0,
          gemsEarned: 0,
        }),
      };
    }

    // Calculate stats
    const clicks = referrals?.length || 0;
    const signups = referrals?.filter(r => r.status !== 'clicked').length || 0;
    const active = referrals?.filter(r => r.status === 'active' || r.status === 'rewarded').length || 0;
    const gemsEarned = referrals?.reduce((sum, r) => sum + (r.gems_awarded_referrer || 0), 0) || 0;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        clicks,
        signups,
        active,
        gemsEarned,
      }),
    };

  } catch (error) {
    console.error('❌ Get referral stats error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to get referral stats',
        message: error.message 
      }),
    };
  }
};
