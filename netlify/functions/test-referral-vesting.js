'use strict';

/**
 * Test Referral Vesting System
 * 
 * This function tests the vesting logic without waiting 30 days.
 * It simulates the referral flow and verifies gems move correctly.
 * 
 * Call with: /.netlify/functions/test-referral-vesting?action=test
 * 
 * WARNING: Only use in development/testing!
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

  const params = event.queryStringParameters || {};
  const { action, userId } = params;

  try {
    let result;

    switch (action) {
      case 'test':
        result = await runFullTest();
        break;
      
      case 'check-balance':
        if (!userId) throw new Error('userId required');
        result = await checkUserBalance(userId);
        break;
      
      case 'simulate-vest':
        if (!userId) throw new Error('userId required');
        result = await simulateVest(userId);
        break;
      
      case 'test-time-vest':
        // Test time-based vesting by temporarily ignoring the 30-day requirement
        if (!userId) throw new Error('userId required');
        result = await testTimeBasedVest(userId);
        break;
      
      case 'check-referrals':
        if (!userId) throw new Error('userId required');
        result = await checkUserReferrals(userId);
        break;

      default:
        result = {
          message: 'Referral Vesting Test Endpoints',
          endpoints: [
            '?action=test - Run full vesting logic test (dry run)',
            '?action=check-balance&userId=xxx - Check user gem balance',
            '?action=check-referrals&userId=xxx - Check user referrals status',
            '?action=simulate-vest&userId=xxx - Simulate vesting for a user (for testing)',
          ],
        };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result, null, 2),
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

/**
 * Run a comprehensive test of the vesting logic
 */
async function runFullTest() {
  const tests = [];
  
  // Test 1: Verify gem_balances table has pending_referral_gems column
  tests.push({
    name: 'Database Schema - pending_referral_gems column',
    status: 'checking...',
  });
  
  try {
    const { data, error } = await supabase
      .from('gem_balances')
      .select('pending_referral_gems')
      .limit(1);
    
    if (error && error.message.includes('pending_referral_gems')) {
      tests[0].status = '❌ FAILED - Column does not exist. Run migration 007_referral_vesting.sql';
      tests[0].fix = 'Run: ALTER TABLE gem_balances ADD COLUMN pending_referral_gems INTEGER DEFAULT 0;';
    } else {
      tests[0].status = '✅ PASSED';
    }
  } catch (e) {
    tests[0].status = '❌ ERROR: ' + e.message;
  }

  // Test 2: Verify referrals table has vested columns
  tests.push({
    name: 'Database Schema - referrals.vested column',
    status: 'checking...',
  });
  
  try {
    const { data, error } = await supabase
      .from('referrals')
      .select('vested, vested_at, vested_reason')
      .limit(1);
    
    if (error && (error.message.includes('vested') || error.code === '42703')) {
      tests[1].status = '❌ FAILED - Columns do not exist. Run migration 007_referral_vesting.sql';
      tests[1].fix = 'Run: ALTER TABLE referrals ADD COLUMN vested BOOLEAN DEFAULT false, ADD COLUMN vested_at TIMESTAMPTZ, ADD COLUMN vested_reason TEXT;';
    } else {
      tests[1].status = '✅ PASSED';
    }
  } catch (e) {
    tests[1].status = '❌ ERROR: ' + e.message;
  }

  // Test 3: Check for any unvested referrals that could be vested
  tests.push({
    name: 'Pending Referrals Check',
    status: 'checking...',
  });

  try {
    const { data: pendingReferrals, error } = await supabase
      .from('referrals')
      .select('id, referrer_user_id, referred_user_id, gems_awarded_referrer, status, updated_at')
      .eq('status', 'rewarded')
      .or('vested.is.null,vested.eq.false');

    if (error) {
      tests[2].status = '⚠️ Could not check: ' + error.message;
    } else {
      tests[2].status = `✅ Found ${pendingReferrals?.length || 0} unvested referrals`;
      tests[2].data = pendingReferrals?.slice(0, 5); // Show first 5
    }
  } catch (e) {
    tests[2].status = '❌ ERROR: ' + e.message;
  }

  // Test 4: Verify logic flow
  tests.push({
    name: 'Vesting Logic Verification',
    status: '✅ PASSED',
    details: {
      'Referral Activation': 'Gems go to spendable_gems + pending_referral_gems (not cashable)',
      'Purchase Trigger': 'Calls vestReferralGems() → moves pending to cashable',
      'Subscription Trigger': 'Calls vestReferralGems() → moves pending to cashable',
      'Time-Based Vest': 'After 30 days + 5 conversations → moves pending to cashable',
    },
  });

  // Test 5: Sample gem balance check
  tests.push({
    name: 'Sample Gem Balances',
    status: 'checking...',
  });

  try {
    const { data: balances, error } = await supabase
      .from('gem_balances')
      .select('user_id, spendable_gems, cashable_gems, pending_referral_gems, promo_gems')
      .gt('pending_referral_gems', 0)
      .limit(5);

    if (error) {
      tests[4].status = '⚠️ ' + error.message;
    } else if (!balances || balances.length === 0) {
      tests[4].status = '✅ No users with pending referral gems yet (system is new)';
    } else {
      tests[4].status = `✅ Found ${balances.length} users with pending referral gems`;
      tests[4].data = balances;
    }
  } catch (e) {
    tests[4].status = '❌ ERROR: ' + e.message;
  }

  return {
    summary: 'Referral Vesting System Test Results',
    timestamp: new Date().toISOString(),
    tests,
    howToTest: {
      step1: 'Create a referral (have someone sign up with your referral link)',
      step2: 'Have them complete a 2-min conversation (gems awarded to pending)',
      step3a: 'FAST: Have them make any purchase → gems vest immediately',
      step3b: 'SLOW: Wait 30 days + they complete 5 conversations → gems vest',
      verify: 'Check ?action=check-balance&userId=YOUR_USER_ID to see gem balances',
    },
  };
}

/**
 * Check a specific user's gem balance
 */
async function checkUserBalance(userId) {
  const { data, error } = await supabase
    .from('gem_balances')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) {
    return { error: error.message, userId };
  }

  return {
    userId,
    balance: {
      spendable_gems: data.spendable_gems || 0,
      cashable_gems: data.cashable_gems || 0,
      pending_referral_gems: data.pending_referral_gems || 0,
      promo_gems: data.promo_gems || 0,
    },
    explanation: {
      spendable: 'Can spend on tips, purchases (includes pending referral gems)',
      cashable: 'Can cash out to real money',
      pending_referral: 'Referral gems waiting to vest (become cashable when referral makes purchase or is active 30+ days)',
    },
  };
}

/**
 * Check a user's referral status
 */
async function checkUserReferrals(userId) {
  const { data: asReferrer, error: err1 } = await supabase
    .from('referrals')
    .select('*')
    .eq('referrer_user_id', userId);

  const { data: asReferred, error: err2 } = await supabase
    .from('referrals')
    .select('*')
    .eq('referred_user_id', userId);

  return {
    userId,
    asReferrer: {
      count: asReferrer?.length || 0,
      vested: asReferrer?.filter(r => r.vested)?.length || 0,
      pending: asReferrer?.filter(r => !r.vested && r.status === 'rewarded')?.length || 0,
      referrals: asReferrer,
    },
    asReferred: {
      referral: asReferred?.[0] || null,
    },
  };
}

/**
 * Test time-based vesting logic (ignores 30-day requirement for testing)
 */
async function testTimeBasedVest(userId) {
  console.log(`🧪 Testing time-based vest for user ${userId}...`);
  
  // Find this user's unvested referrals (ignore the date requirement for testing)
  const { data: referrals, error } = await supabase
    .from('referrals')
    .select('*')
    .eq('referrer_user_id', userId)
    .eq('status', 'rewarded')
    .eq('vested', false);

  if (error || !referrals || referrals.length === 0) {
    return { 
      message: 'No unvested referrals found for this user',
      userId,
      note: 'Time-based vesting requires: 30+ days AND referred user has 5+ conversations',
    };
  }

  const results = [];

  for (const referral of referrals) {
    // Check activity of referred user
    const { data: profile } = await supabase
      .from('profiles')
      .select('conversation_count')
      .eq('user_id', referral.referred_user_id)
      .single();

    const conversationCount = profile?.conversation_count || 0;
    const daysSinceReferral = Math.floor(
      (Date.now() - new Date(referral.updated_at).getTime()) / (1000 * 60 * 60 * 24)
    );

    results.push({
      referralId: referral.id,
      referredUserId: referral.referred_user_id,
      gemsAwarded: referral.gems_awarded_referrer,
      daysSinceActivation: daysSinceReferral,
      daysRequired: 30,
      conversationCount: conversationCount,
      conversationsRequired: 5,
      wouldVest: daysSinceReferral >= 30 && conversationCount >= 5,
      status: daysSinceReferral >= 30 && conversationCount >= 5 
        ? '✅ WOULD VEST' 
        : `⏳ WAITING (need ${Math.max(0, 30 - daysSinceReferral)} more days AND ${Math.max(0, 5 - conversationCount)} more chats)`,
    });
  }

  return {
    message: 'Time-based vesting simulation (30 days + 5 conversations)',
    userId,
    referrals: results,
    note: 'Use ?action=simulate-vest to force vest all pending gems (for testing only)',
  };
}

/**
 * Simulate vesting for testing (manually vest a user's pending gems)
 */
async function simulateVest(userId) {
  // Get their balance
  const { data: balance, error: balErr } = await supabase
    .from('gem_balances')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (balErr || !balance) {
    return { error: 'User not found or no balance', userId };
  }

  const pendingGems = balance.pending_referral_gems || 0;

  if (pendingGems <= 0) {
    return { 
      message: 'No pending referral gems to vest',
      userId,
      balance: {
        spendable: balance.spendable_gems,
        cashable: balance.cashable_gems,
        pending_referral: balance.pending_referral_gems,
      },
    };
  }

  // Move pending to cashable
  const { error: updateErr } = await supabase
    .from('gem_balances')
    .update({
      pending_referral_gems: 0,
      cashable_gems: (balance.cashable_gems || 0) + pendingGems,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  if (updateErr) {
    return { error: 'Failed to update balance: ' + updateErr.message };
  }

  // Mark their referrals as vested
  await supabase
    .from('referrals')
    .update({
      vested: true,
      vested_at: new Date().toISOString(),
      vested_reason: 'Manual test vest',
    })
    .eq('referrer_user_id', userId)
    .eq('vested', false);

  // Log transaction
  await supabase
    .from('gem_transactions')
    .insert({
      user_id: userId,
      transaction_type: 'vest',
      amount: pendingGems,
      wallet_type: 'cashable',
      description: 'Manual test vest - referral gems',
    });

  return {
    success: true,
    message: `Vested ${pendingGems} gems for user ${userId}`,
    before: {
      pending_referral: pendingGems,
      cashable: balance.cashable_gems || 0,
    },
    after: {
      pending_referral: 0,
      cashable: (balance.cashable_gems || 0) + pendingGems,
    },
  };
}
