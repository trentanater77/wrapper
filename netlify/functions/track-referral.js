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

// Gem rewards configuration
// NOTE: Referral gems are SPENDABLE immediately but NOT CASHABLE until vested
// Gems vest (become cashable) when:
// 1. The referred user makes ANY purchase, OR
// 2. 30 days pass AND the referred user completes 5+ conversations
// This is "Jeff Bezos Approved" anti-fraud protection
const REWARDS = {
  SIGNUP_COMPLETE: {
    referrer: 500,
    referred: 500,
  },
  FIRST_PURCHASE: {
    referrer: 250,
    referred: 100,
  },
  SUBSCRIPTION: {
    referrer: 1000,
    referred: 500,
  },
};

// Vesting requirements
const VESTING_REQUIREMENTS = {
  DAYS_REQUIRED: 30,        // Days before time-based vesting
  CHATS_REQUIRED: 5,        // Minimum chats for time-based vesting
  PURCHASE_VESTS: true,     // Any purchase immediately vests all pending gems
};

exports.handler = async function(event) {
  // Handle CORS preflight
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
    const { action, referralCode, userId, referredUserId } = body;

    if (!action) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'action is required' }),
      };
    }

    let result;

    switch (action) {
      case 'click':
        // Track a referral link click
        result = await trackClick(referralCode);
        break;

      case 'signup':
        // Track when a referred user signs up
        result = await trackSignup(referralCode, referredUserId);
        break;

      case 'activate':
        // Track when referred user completes first conversation
        // This triggers the gem rewards for both parties!
        result = await activateReferral(referredUserId);
        break;

      case 'purchase':
        // Track first purchase (bonus gems)
        result = await trackPurchase(referredUserId);
        break;

      case 'subscribe':
        // Track subscription (bonus gems)
        result = await trackSubscription(referredUserId);
        break;

      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid action' }),
        };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result),
    };

  } catch (error) {
    console.error('❌ Track referral error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to track referral',
        message: error.message 
      }),
    };
  }
};

// Track a click on a referral link
async function trackClick(referralCode) {
  if (!referralCode) {
    throw new Error('referralCode is required');
  }

  // Find the referrer by their code (first 8 chars of user ID)
  const { data: users } = await supabase
    .from('profiles')
    .select('user_id')
    .ilike('user_id', `${referralCode.toLowerCase()}%`)
    .limit(1);

  if (!users || users.length === 0) {
    // Try auth.users directly
    const { data: authUser } = await supabase.auth.admin.listUsers();
    const referrer = authUser?.users?.find(u => 
      u.id.substring(0, 8).toUpperCase() === referralCode.toUpperCase()
    );
    
    if (!referrer) {
      throw new Error('Invalid referral code');
    }
    
    // Create click record
    const { data, error } = await supabase
      .from('referrals')
      .insert({
        referrer_user_id: referrer.id,
        referral_code: referralCode.toUpperCase(),
        status: 'clicked',
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating referral:', error);
      // Table might not exist yet - that's okay
      return { success: true, message: 'Click tracked' };
    }

    return { success: true, referralId: data?.id };
  }

  // Create click record
  const { data, error } = await supabase
    .from('referrals')
    .insert({
      referrer_user_id: users[0].user_id,
      referral_code: referralCode.toUpperCase(),
      status: 'clicked',
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating referral:', error);
    return { success: true, message: 'Click tracked' };
  }

  return { success: true, referralId: data?.id };
}

// Track when a referred user signs up
async function trackSignup(referralCode, referredUserId) {
  if (!referralCode || !referredUserId) {
    throw new Error('referralCode and referredUserId are required');
  }

  // Find the most recent click for this referral code
  const { data: referral, error: findError } = await supabase
    .from('referrals')
    .select('*')
    .eq('referral_code', referralCode.toUpperCase())
    .eq('status', 'clicked')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (findError || !referral) {
    console.log('No pending referral found for code:', referralCode);
    return { success: false, message: 'No pending referral found' };
  }

  // FRAUD PREVENTION: Block self-referrals
  if (referral.referrer_user_id === referredUserId) {
    console.log('🚫 FRAUD BLOCKED: User tried to refer themselves:', referredUserId);
    return { success: false, message: 'Self-referral not allowed' };
  }

  // Update the referral with the referred user
  const { data, error } = await supabase
    .from('referrals')
    .update({
      referred_user_id: referredUserId,
      status: 'signed_up',
      updated_at: new Date().toISOString(),
    })
    .eq('id', referral.id)
    .select()
    .single();

  if (error) {
    console.error('Error updating referral:', error);
    throw error;
  }

  console.log(`✅ Referral signup tracked: ${referredUserId} referred by ${referral.referrer_user_id}`);

  return { success: true, referralId: data.id };
}

// Activate referral when referred user completes first conversation
// This awards gems to BOTH parties!
async function activateReferral(referredUserId) {
  if (!referredUserId) {
    throw new Error('referredUserId is required');
  }

  // Find the referral for this user
  const { data: referral, error: findError } = await supabase
    .from('referrals')
    .select('*')
    .eq('referred_user_id', referredUserId)
    .eq('status', 'signed_up')
    .single();

  if (findError || !referral) {
    console.log('No pending referral found for user:', referredUserId);
    return { success: false, message: 'No pending referral found' };
  }

  // FRAUD PREVENTION: Double-check not a self-referral
  if (referral.referrer_user_id === referredUserId) {
    console.log('🚫 FRAUD BLOCKED: Self-referral activation attempt:', referredUserId);
    // Mark as fraudulent so it doesn't keep trying
    await supabase
      .from('referrals')
      .update({ status: 'fraudulent', updated_at: new Date().toISOString() })
      .eq('id', referral.id);
    return { success: false, message: 'Self-referral not allowed' };
  }

  // Award gems to the referrer (pending vesting - becomes cashable when referred user proves value)
  await awardGems(
    referral.referrer_user_id, 
    REWARDS.SIGNUP_COMPLETE.referrer, 
    'referral_bonus',
    `Referral bonus - friend completed first chat`,
    true // isReferralGem = true - these are pending vesting
  );

  // Award gems to the referred user (spendable immediately as welcome bonus)
  await awardGems(
    referredUserId, 
    REWARDS.SIGNUP_COMPLETE.referred, 
    'welcome_bonus',
    `Welcome bonus - signed up with referral link`,
    false // Not a referral gem - immediately spendable as welcome gift
  );

  // Update the referral status
  const { data, error } = await supabase
    .from('referrals')
    .update({
      status: 'rewarded',
      gems_awarded_referrer: REWARDS.SIGNUP_COMPLETE.referrer,
      gems_awarded_referred: REWARDS.SIGNUP_COMPLETE.referred,
      updated_at: new Date().toISOString(),
    })
    .eq('id', referral.id)
    .select()
    .single();

  if (error) {
    console.error('Error updating referral:', error);
    throw error;
  }

  console.log(`✅ Referral activated! ${referral.referrer_user_id} and ${referredUserId} each got gems!`);

  return { 
    success: true, 
    referrerGems: REWARDS.SIGNUP_COMPLETE.referrer,
    referredGems: REWARDS.SIGNUP_COMPLETE.referred,
  };
}

// Track first purchase (bonus gems + VEST ALL PENDING REFERRAL GEMS)
// A purchase is the strongest anti-fraud signal - proves user is real and valuable
async function trackPurchase(referredUserId) {
  if (!referredUserId) {
    throw new Error('referredUserId is required');
  }

  // Find the referral for this user
  const { data: referral } = await supabase
    .from('referrals')
    .select('*')
    .eq('referred_user_id', referredUserId)
    .eq('status', 'rewarded')
    .is('first_purchase_rewarded', null)
    .single();

  if (!referral) {
    return { success: false, message: 'No eligible referral found' };
  }

  // 🎉 VEST ALL PENDING REFERRAL GEMS - Purchase proves the user is real!
  if (VESTING_REQUIREMENTS.PURCHASE_VESTS && !referral.vested) {
    console.log('🎉 Purchase detected! Vesting all pending referral gems...');
    await vestReferralGems(
      referral.referrer_user_id, 
      referredUserId, 
      'Referred user made first purchase'
    );
  }

  // Award bonus gems (these go directly to cashable since purchase already vested)
  await awardGems(
    referral.referrer_user_id, 
    REWARDS.FIRST_PURCHASE.referrer, 
    'referral_purchase_bonus',
    `Referral bonus - friend made first purchase`,
    false // Not pending - goes straight to spendable (could go to cashable since vested)
  );

  await awardGems(
    referredUserId, 
    REWARDS.FIRST_PURCHASE.referred, 
    'purchase_bonus',
    `Bonus gems for first purchase`,
    false
  );

  // Mark as rewarded
  await supabase
    .from('referrals')
    .update({
      first_purchase_rewarded: true,
      gems_awarded_referrer: referral.gems_awarded_referrer + REWARDS.FIRST_PURCHASE.referrer,
      gems_awarded_referred: referral.gems_awarded_referred + REWARDS.FIRST_PURCHASE.referred,
      updated_at: new Date().toISOString(),
    })
    .eq('id', referral.id);

  return { success: true, gemsVested: true };
}

// Track subscription (bonus gems + VEST ALL PENDING REFERRAL GEMS)
// A subscription is even stronger than a purchase - premium anti-fraud signal
async function trackSubscription(referredUserId) {
  if (!referredUserId) {
    throw new Error('referredUserId is required');
  }

  // Find the referral for this user
  const { data: referral } = await supabase
    .from('referrals')
    .select('*')
    .eq('referred_user_id', referredUserId)
    .is('subscription_rewarded', null)
    .single();

  if (!referral) {
    return { success: false, message: 'No eligible referral found' };
  }

  // 🎉 VEST ALL PENDING REFERRAL GEMS - Subscription proves the user is committed!
  if (VESTING_REQUIREMENTS.PURCHASE_VESTS && !referral.vested) {
    console.log('🎉 Subscription detected! Vesting all pending referral gems...');
    await vestReferralGems(
      referral.referrer_user_id, 
      referredUserId, 
      'Referred user subscribed'
    );
  }

  // Award bonus gems
  await awardGems(
    referral.referrer_user_id, 
    REWARDS.SUBSCRIPTION.referrer, 
    'referral_subscription_bonus',
    `Referral bonus - friend subscribed`,
    false // Not pending since subscription already vested
  );

  await awardGems(
    referredUserId, 
    REWARDS.SUBSCRIPTION.referred, 
    'subscription_bonus',
    `Bonus gems for subscribing`,
    false
  );

  // Mark as rewarded
  await supabase
    .from('referrals')
    .update({
      subscription_rewarded: true,
      gems_awarded_referrer: (referral.gems_awarded_referrer || 0) + REWARDS.SUBSCRIPTION.referrer,
      gems_awarded_referred: (referral.gems_awarded_referred || 0) + REWARDS.SUBSCRIPTION.referred,
      updated_at: new Date().toISOString(),
    })
    .eq('id', referral.id);

  return { success: true, gemsVested: true };
}

// Helper function to award gems to a user
// For referrals: gems are SPENDABLE immediately but NOT CASHABLE until vested
async function awardGems(userId, amount, transactionType, description, isReferralGem = false) {
  console.log(`💎 Awarding ${amount} gems to user ${userId}... (referral: ${isReferralGem})`);
  
  // Update or create gem balance
  const { data: existingBalance, error: fetchError } = await supabase
    .from('gem_balances')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (fetchError && fetchError.code !== 'PGRST116') {
    console.error('Error fetching gem balance:', fetchError);
  }

  if (existingBalance) {
    // Update existing balance
    const updateData = {
      spendable_gems: (existingBalance.spendable_gems || 0) + amount,
      updated_at: new Date().toISOString(),
    };
    
    if (isReferralGem) {
      // Track as pending referral gems (not cashable yet)
      updateData.pending_referral_gems = (existingBalance.pending_referral_gems || 0) + amount;
      updateData.promo_gems = (existingBalance.promo_gems || 0) + amount;
    }
    
    const { error: updateError } = await supabase
      .from('gem_balances')
      .update(updateData)
      .eq('user_id', userId);
    
    if (updateError) {
      console.error('Error updating gem balance:', updateError);
      throw updateError;
    }
    console.log(`✅ Updated existing balance: +${amount} gems${isReferralGem ? ' (pending vesting)' : ''}`);
  } else {
    // Create new balance record
    const insertData = {
      user_id: userId,
      spendable_gems: amount,
      cashable_gems: 0,
      promo_gems: isReferralGem ? amount : 0,
      pending_referral_gems: isReferralGem ? amount : 0,
    };
    
    const { error: insertError } = await supabase
      .from('gem_balances')
      .insert(insertData);
    
    if (insertError) {
      console.error('Error creating gem balance:', insertError);
      throw insertError;
    }
    console.log(`✅ Created new balance with ${amount} gems${isReferralGem ? ' (pending vesting)' : ''}`);
  }

  // Record transaction
  const { error: txError } = await supabase
    .from('gem_transactions')
    .insert({
      user_id: userId,
      transaction_type: transactionType,
      amount: amount,
      wallet_type: isReferralGem ? 'pending_referral' : 'spendable',
      description: description + (isReferralGem ? ' (vests when referral makes purchase or stays active 30+ days)' : ''),
    });

  if (txError) {
    console.error('Error recording transaction:', txError);
  }

  console.log(`✅ Awarded ${amount} gems to user ${userId}`);
}

// Vest pending referral gems (move from pending to cashable)
// Called when a referred user makes a purchase or meets activity requirements
async function vestReferralGems(referrerUserId, referredUserId, reason) {
  console.log(`🔓 Vesting referral gems for referrer ${referrerUserId} (reason: ${reason})`);
  
  // Get the referrer's current balance
  const { data: balance, error: fetchError } = await supabase
    .from('gem_balances')
    .select('*')
    .eq('user_id', referrerUserId)
    .single();
  
  if (fetchError || !balance) {
    console.log('No balance found for referrer');
    return { success: false, message: 'No balance found' };
  }
  
  // Find the referral record to get the gem amounts
  const { data: referral } = await supabase
    .from('referrals')
    .select('gems_awarded_referrer, vested')
    .eq('referrer_user_id', referrerUserId)
    .eq('referred_user_id', referredUserId)
    .single();
  
  if (!referral || referral.vested) {
    console.log('Referral not found or already vested');
    return { success: false, message: 'Already vested or not found' };
  }
  
  const gemsToVest = referral.gems_awarded_referrer || 0;
  
  if (gemsToVest <= 0) {
    return { success: false, message: 'No gems to vest' };
  }
  
  // Move gems from pending to cashable
  const newPending = Math.max(0, (balance.pending_referral_gems || 0) - gemsToVest);
  const newCashable = (balance.cashable_gems || 0) + gemsToVest;
  
  const { error: updateError } = await supabase
    .from('gem_balances')
    .update({
      pending_referral_gems: newPending,
      cashable_gems: newCashable,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', referrerUserId);
  
  if (updateError) {
    console.error('Error vesting gems:', updateError);
    return { success: false, message: 'Failed to vest gems' };
  }
  
  // Mark the referral as vested
  await supabase
    .from('referrals')
    .update({
      vested: true,
      vested_at: new Date().toISOString(),
      vested_reason: reason,
    })
    .eq('referrer_user_id', referrerUserId)
    .eq('referred_user_id', referredUserId);
  
  // Log the vesting transaction
  await supabase
    .from('gem_transactions')
    .insert({
      user_id: referrerUserId,
      transaction_type: 'vest',
      amount: gemsToVest,
      wallet_type: 'cashable',
      description: `Referral gems vested: ${reason}`,
    });
  
  console.log(`✅ Vested ${gemsToVest} gems for user ${referrerUserId}`);
  return { success: true, gemsVested: gemsToVest };
}

// Export for use by other functions (e.g., stripe-webhook)
module.exports.vestReferralGems = vestReferralGems;
