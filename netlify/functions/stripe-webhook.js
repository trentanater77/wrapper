'use strict';

/**
 * Stripe Webhook Handler
 * 
 * Handles Stripe events like subscription created, updated, canceled.
 * Updates the Supabase database accordingly.
 */

// Validate Stripe configuration
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

if (!STRIPE_SECRET_KEY) {
  console.error('❌ STRIPE_SECRET_KEY not configured!');
}
if (!STRIPE_WEBHOOK_SECRET) {
  console.error('❌ STRIPE_WEBHOOK_SECRET not configured!');
}

// Log mode for debugging
const isTestMode = STRIPE_SECRET_KEY?.startsWith('sk_test_');
console.log(`💳 Stripe webhook running in ${isTestMode ? 'TEST' : 'LIVE'} mode`);

const stripe = require('stripe')(STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase with service role key (bypasses RLS)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Relevant Stripe events
const RELEVANT_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  // Identity verification events
  'identity.verification_session.verified',
  'identity.verification_session.requires_input',
];

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const sig = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;

  try {
    // Verify the webhook signature
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      webhookSecret
    );
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Webhook Error: ${err.message}` }),
    };
  }

  // Check if we've already processed this event
  const { data: existingEvent } = await supabase
    .from('stripe_events')
    .select('id')
    .eq('id', stripeEvent.id)
    .single();

  if (existingEvent) {
    console.log(`⚠️ Event ${stripeEvent.id} already processed, skipping`);
    return { statusCode: 200, body: JSON.stringify({ received: true, duplicate: true }) };
  }

  // Process relevant events
  if (RELEVANT_EVENTS.includes(stripeEvent.type)) {
    console.log(`📦 Processing event: ${stripeEvent.type}`);

    try {
      switch (stripeEvent.type) {
        case 'checkout.session.completed':
          await handleCheckoutComplete(stripeEvent.data.object);
          break;

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await handleSubscriptionUpdate(stripeEvent.data.object);
          break;

        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(stripeEvent.data.object);
          break;

        case 'invoice.payment_succeeded':
          await handlePaymentSucceeded(stripeEvent.data.object);
          break;

        case 'invoice.payment_failed':
          await handlePaymentFailed(stripeEvent.data.object);
          break;

        case 'identity.verification_session.verified':
          await handleIdentityVerified(stripeEvent.data.object);
          break;

        case 'identity.verification_session.requires_input':
          await handleIdentityRequiresInput(stripeEvent.data.object);
          break;
      }

      // Mark event as processed
      await supabase
        .from('stripe_events')
        .insert({ id: stripeEvent.id, event_type: stripeEvent.type });

      console.log(`✅ Successfully processed event: ${stripeEvent.type}`);

    } catch (error) {
      console.error(`❌ Error processing event ${stripeEvent.type}:`, error);
      // Don't return error - Stripe will retry. Log for debugging.
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ received: true }),
  };
};

/**
 * Handle checkout.session.completed
 * This fires when a user completes the Stripe checkout
 * Handles both subscriptions and one-time gem purchases
 */
async function handleCheckoutComplete(session) {
  const userId = session.metadata?.user_id;
  const customerId = session.customer;

  if (!userId) {
    console.error('❌ No user_id in checkout session metadata');
    return;
  }

  // Check if this is a gem purchase (one-time payment)
  if (session.mode === 'payment' && session.metadata?.type === 'gem_purchase') {
    await handleGemPurchase(session);
    return;
  }

  // Otherwise, handle as subscription
  const planType = session.metadata?.plan_type || 'free';
  const subscriptionId = session.subscription;

  console.log(`🎉 Checkout complete for user ${userId}, plan: ${planType}`);

  // Get subscription details
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  // Upsert user subscription record
  const { error } = await supabase
    .from('user_subscriptions')
    .upsert({
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      plan_type: planType,
      billing_period: subscription.items.data[0]?.price?.recurring?.interval === 'year' ? 'yearly' : 'monthly',
      status: subscription.status,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id',
    });

  if (error) {
    console.error('❌ Error upserting subscription:', error);
    throw error;
  }

  // If this is an Ad-Free plan or Pro Bundle, add bonus gems
  if (planType === 'ad_free_premium' || planType === 'pro_bundle') {
    await addBonusGems(userId, 1200, 'subscription_bonus');
  } else if (planType === 'ad_free_plus') {
    await addBonusGems(userId, 500, 'subscription_bonus');
  }
  
  // 🎉 VEST REFERRAL GEMS - Subscription proves this user is committed!
  await vestReferralGemsOnPurchase(userId, 'subscription');
}

/**
 * Handle gem pack purchase (one-time payment)
 */
async function handleGemPurchase(session) {
  const userId = session.metadata?.user_id;
  const gems = parseInt(session.metadata?.gems, 10);
  const packName = session.metadata?.pack_name || 'Gem Pack';
  const paymentIntentId = session.payment_intent;

  if (!userId || !gems || isNaN(gems)) {
    console.error('❌ Invalid gem purchase metadata:', session.metadata);
    return;
  }

  console.log(`💎 Gem purchase: ${gems} gems for user ${userId} (${packName})`);

  try {
    // Check if gem balance record exists
    const { data: existing } = await supabase
      .from('gem_balances')
      .select('id, spendable_gems')
      .eq('user_id', userId)
      .single();

    if (!existing) {
      // Create new record with purchased gems
      const { error: insertError } = await supabase
        .from('gem_balances')
        .insert({ 
          user_id: userId, 
          spendable_gems: gems, 
          cashable_gems: 0,
          promo_gems: 0
        });
      
      if (insertError) {
        console.error('❌ Error inserting gem balance:', insertError);
        throw insertError;
      }
      console.log(`💎 Created gem balance with ${gems} purchased gems for user ${userId}`);
    } else {
      // Update existing record - add to current balance
      const newBalance = (existing.spendable_gems || 0) + gems;
      const { error: updateError } = await supabase
        .from('gem_balances')
        .update({ 
          spendable_gems: newBalance,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);
      
      if (updateError) {
        console.error('❌ Error updating gem balance:', updateError);
        throw updateError;
      }
      console.log(`💎 Updated gem balance: ${existing.spendable_gems} + ${gems} = ${newBalance} for user ${userId}`);
    }

    // Log transaction
    const { error: txError } = await supabase
      .from('gem_transactions')
      .insert({
        user_id: userId,
        transaction_type: 'purchase',
        amount: gems,
        wallet_type: 'spendable',
        description: `Purchased: ${packName} (${gems} gems)`,
        stripe_payment_id: paymentIntentId,
      });
    
    if (txError) {
      console.error('❌ Error logging gem transaction:', txError);
      // Don't throw - gems were added, just logging failed
    }

    console.log(`✅ Successfully credited ${gems} gems to user ${userId}`);
    
    // 🎉 VEST REFERRAL GEMS - Purchase proves this user is real!
    await vestReferralGemsOnPurchase(userId, 'gem_purchase');
    
  } catch (error) {
    console.error('❌ Error processing gem purchase:', error);
    throw error;
  }
}

/**
 * Handle subscription updates (renewals, plan changes)
 */
async function handleSubscriptionUpdate(subscription) {
  const customerId = subscription.customer;

  // Find user by Stripe customer ID
  const { data: userSub, error: findError } = await supabase
    .from('user_subscriptions')
    .select('user_id, plan_type')
    .eq('stripe_customer_id', customerId)
    .single();

  if (findError || !userSub) {
    console.log('⚠️ No user found for customer:', customerId);
    return;
  }

  // Determine plan type from price
  let planType = userSub.plan_type;
  const priceId = subscription.items.data[0]?.price?.id;
  
  // Update subscription record
  const { error } = await supabase
    .from('user_subscriptions')
    .update({
      status: subscription.status,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_customer_id', customerId);

  if (error) {
    console.error('❌ Error updating subscription:', error);
    throw error;
  }

  console.log(`✅ Updated subscription for customer ${customerId}`);
}

/**
 * Handle subscription cancellation
 */
async function handleSubscriptionDeleted(subscription) {
  const customerId = subscription.customer;

  const { error } = await supabase
    .from('user_subscriptions')
    .update({
      status: 'canceled',
      plan_type: 'free',
      canceled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_customer_id', customerId);

  if (error) {
    console.error('❌ Error handling subscription deletion:', error);
    throw error;
  }

  console.log(`✅ Subscription canceled for customer ${customerId}`);
}

/**
 * Handle successful payment (subscription renewal)
 */
async function handlePaymentSucceeded(invoice) {
  const customerId = invoice.customer;
  const subscriptionId = invoice.subscription;

  // Only process subscription invoices
  if (!subscriptionId) return;

  // Find user
  const { data: userSub } = await supabase
    .from('user_subscriptions')
    .select('user_id, plan_type')
    .eq('stripe_customer_id', customerId)
    .single();

  if (!userSub) return;

  // Add monthly bonus gems for Ad-Free plans and Pro Bundle
  if (invoice.billing_reason === 'subscription_cycle') {
    if (userSub.plan_type === 'ad_free_premium' || userSub.plan_type === 'pro_bundle') {
      await addBonusGems(userSub.user_id, 1200, 'subscription_bonus');
    } else if (userSub.plan_type === 'ad_free_plus') {
      await addBonusGems(userSub.user_id, 500, 'subscription_bonus');
    }
  }

  console.log(`✅ Payment succeeded for customer ${customerId}`);
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(invoice) {
  const customerId = invoice.customer;

  const { error } = await supabase
    .from('user_subscriptions')
    .update({
      status: 'past_due',
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_customer_id', customerId);

  if (error) {
    console.error('❌ Error updating subscription status:', error);
  }

  console.log(`⚠️ Payment failed for customer ${customerId}`);
}

/**
 * Add bonus gems to user's spendable balance
 */
async function addBonusGems(userId, amount, transactionType) {
  try {
    // Check if gem balance record exists
    const { data: existing } = await supabase
      .from('gem_balances')
      .select('id, spendable_gems')
      .eq('user_id', userId)
      .single();

    if (!existing) {
      // Create new record with the bonus gems
      const { error: insertError } = await supabase
        .from('gem_balances')
        .insert({ 
          user_id: userId, 
          spendable_gems: amount, 
          cashable_gems: 0,
          promo_gems: 0
        });
      
      if (insertError) {
        console.error('❌ Error inserting gem balance:', insertError);
        throw insertError;
      }
      console.log(`💎 Created gem balance with ${amount} gems for user ${userId}`);
    } else {
      // Update existing record - add to current balance
      const newBalance = (existing.spendable_gems || 0) + amount;
      const { error: updateError } = await supabase
        .from('gem_balances')
        .update({ 
          spendable_gems: newBalance,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);
      
      if (updateError) {
        console.error('❌ Error updating gem balance:', updateError);
        throw updateError;
      }
      console.log(`💎 Updated gem balance: ${existing.spendable_gems} + ${amount} = ${newBalance} for user ${userId}`);
    }

    // Log transaction
    const { error: txError } = await supabase
      .from('gem_transactions')
      .insert({
        user_id: userId,
        transaction_type: transactionType,
        amount: amount,
        wallet_type: 'spendable',
        description: `Bonus: ${amount} gems`,
      });
    
    if (txError) {
      console.error('❌ Error logging gem transaction:', txError);
    }

    console.log(`💎 Added ${amount} bonus gems to user ${userId}`);
  } catch (error) {
    console.error('❌ Error in addBonusGems:', error);
    throw error;
  }
}

/**
 * Vest referral gems when a referred user makes a purchase
 * This is the key fraud protection - gems only become cashable when the referred user proves value
 */
async function vestReferralGemsOnPurchase(purchasingUserId, purchaseType) {
  console.log(`🔓 Checking for referral gems to vest for user ${purchasingUserId} (${purchaseType})...`);
  
  try {
    // Find if this user was referred by someone
    const { data: referral, error: findError } = await supabase
      .from('referrals')
      .select('*')
      .eq('referred_user_id', purchasingUserId)
      .eq('status', 'rewarded')
      .eq('vested', false)
      .single();
    
    if (findError || !referral) {
      console.log('No unvested referral found for this user');
      return;
    }
    
    const referrerId = referral.referrer_user_id;
    const gemsToVest = referral.gems_awarded_referrer || 0;
    
    if (gemsToVest <= 0) {
      console.log('No gems to vest');
      return;
    }
    
    console.log(`🎉 Found referral! Vesting ${gemsToVest} gems for referrer ${referrerId}`);
    
    // Get the referrer's current balance
    const { data: balance, error: balanceError } = await supabase
      .from('gem_balances')
      .select('*')
      .eq('user_id', referrerId)
      .single();
    
    if (balanceError || !balance) {
      console.error('Could not find referrer balance');
      return;
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
      .eq('user_id', referrerId);
    
    if (updateError) {
      console.error('Error updating referrer balance:', updateError);
      return;
    }
    
    // Mark the referral as vested
    await supabase
      .from('referrals')
      .update({
        vested: true,
        vested_at: new Date().toISOString(),
        vested_reason: `Referred user made ${purchaseType}`,
      })
      .eq('id', referral.id);
    
    // Log the vesting transaction
    await supabase
      .from('gem_transactions')
      .insert({
        user_id: referrerId,
        transaction_type: 'vest',
        amount: gemsToVest,
        wallet_type: 'cashable',
        description: `Referral gems vested: referred user made ${purchaseType}`,
      });
    
    console.log(`✅ Vested ${gemsToVest} gems for referrer ${referrerId}!`);
    
  } catch (error) {
    console.error('Error in vestReferralGemsOnPurchase:', error);
    // Don't throw - vesting failure shouldn't block the purchase
  }
}

/**
 * Handle identity verification completed (KYC)
 */
async function handleIdentityVerified(verificationSession) {
  const userId = verificationSession.metadata?.user_id;
  const sessionId = verificationSession.id;

  if (!userId) {
    console.error('❌ No user_id in verification session metadata');
    return;
  }

  console.log(`🆔 Identity verified for user ${userId}`);

  // Get verified data from the session
  const verifiedOutputs = verificationSession.verified_outputs || {};
  const firstName = verifiedOutputs.first_name || null;
  const lastName = verifiedOutputs.last_name || null;
  const dob = verifiedOutputs.dob ? 
    `${verifiedOutputs.dob.year}-${String(verifiedOutputs.dob.month).padStart(2, '0')}-${String(verifiedOutputs.dob.day).padStart(2, '0')}` : null;
  const documentType = verifiedOutputs.document?.type || null;

  // Update KYC verification record
  const { error: kycError } = await supabase
    .from('kyc_verifications')
    .upsert({
      user_id: userId,
      stripe_verification_id: sessionId,
      status: 'verified',
      verified_at: new Date().toISOString(),
      first_name: firstName,
      last_name: lastName,
      date_of_birth: dob,
      document_type: documentType,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'user_id'
    });

  if (kycError) {
    console.error('❌ Error updating KYC verification:', kycError);
    throw kycError;
  }

  // Update gem_balances to mark as KYC verified for quick checks
  await supabase
    .from('gem_balances')
    .update({ kyc_verified: true })
    .eq('user_id', userId);

  console.log(`✅ KYC verification complete for user ${userId}`);
}

/**
 * Handle identity verification requiring more input (failed/needs retry)
 */
async function handleIdentityRequiresInput(verificationSession) {
  const userId = verificationSession.metadata?.user_id;
  const sessionId = verificationSession.id;

  if (!userId) {
    console.error('❌ No user_id in verification session metadata');
    return;
  }

  const lastError = verificationSession.last_error;
  console.log(`⚠️ Identity verification requires input for user ${userId}: ${lastError?.reason || 'unknown'}`);

  // Update status to show user needs to retry
  await supabase
    .from('kyc_verifications')
    .upsert({
      user_id: userId,
      stripe_verification_id: sessionId,
      status: lastError ? 'failed' : 'pending',
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'user_id'
    });
}
