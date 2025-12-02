'use strict';

/**
 * Stripe Webhook Handler
 * 
 * Handles Stripe events like subscription created, updated, canceled.
 * Updates the Supabase database accordingly.
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
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
 */
async function handleCheckoutComplete(session) {
  const userId = session.metadata?.user_id;
  const planType = session.metadata?.plan_type || 'free';
  const customerId = session.customer;
  const subscriptionId = session.subscription;

  if (!userId) {
    console.error('❌ No user_id in checkout session metadata');
    return;
  }

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
