'use strict';

/**
 * Admin: Manually Vest Referral Gems
 * 
 * Use this to vest gems for existing referrals where the referred user
 * already made a purchase before the vesting code was deployed.
 * 
 * Usage: ?referrerId=xxx&referredId=yyy
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const params = event.queryStringParameters || {};
  const { referrerId, referredId, action } = params;

  try {
    // List pending referrals
    if (action === 'list') {
      const { data: pending } = await supabase
        .from('referrals')
        .select('*')
        .eq('status', 'rewarded')
        .eq('vested', false);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: 'Pending (unvested) referrals',
          count: pending?.length || 0,
          referrals: pending,
        }, null, 2),
      };
    }

    // Vest specific referral
    if (!referrerId || !referredId) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: 'Admin Vest Gems Endpoint',
          usage: {
            'List pending': '?action=list',
            'Vest specific': '?referrerId=xxx&referredId=yyy',
          },
        }, null, 2),
      };
    }

    // Find the referral
    const { data: referral, error: findError } = await supabase
      .from('referrals')
      .select('*')
      .eq('referrer_user_id', referrerId)
      .eq('referred_user_id', referredId)
      .eq('status', 'rewarded')
      .single();

    if (findError || !referral) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Referral not found or not in rewarded status' }),
      };
    }

    if (referral.vested) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: 'Already vested', referral }),
      };
    }

    const gemsToVest = referral.gems_awarded_referrer || 0;

    // Get referrer's balance
    const { data: balance } = await supabase
      .from('gem_balances')
      .select('*')
      .eq('user_id', referrerId)
      .single();

    if (!balance) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Referrer balance not found' }),
      };
    }

    // Move gems from pending to cashable
    const newPending = Math.max(0, (balance.pending_referral_gems || 0) - gemsToVest);
    const newCashable = (balance.cashable_gems || 0) + gemsToVest;

    await supabase
      .from('gem_balances')
      .update({
        pending_referral_gems: newPending,
        cashable_gems: newCashable,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', referrerId);

    // Mark referral as vested
    await supabase
      .from('referrals')
      .update({
        vested: true,
        vested_at: new Date().toISOString(),
        vested_reason: 'Manual admin vest (retroactive)',
      })
      .eq('id', referral.id);

    // Log transaction
    await supabase
      .from('gem_transactions')
      .insert({
        user_id: referrerId,
        transaction_type: 'vest',
        amount: gemsToVest,
        wallet_type: 'cashable',
        description: 'Referral gems vested (admin retroactive)',
      });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Vested ${gemsToVest} gems for referrer ${referrerId}`,
        before: {
          pending_referral_gems: balance.pending_referral_gems || 0,
          cashable_gems: balance.cashable_gems || 0,
        },
        after: {
          pending_referral_gems: newPending,
          cashable_gems: newCashable,
        },
      }, null, 2),
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
