'use strict';

/**
 * Get Stripe Connect Status
 * 
 * Returns the user's Stripe Connect account status.
 * Syncs with Stripe to get the latest status.
 */

const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
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

    // Get stored Connect status
    const { data: balance, error } = await supabase
      .from('gem_balances')
      .select('stripe_account_id, stripe_account_status, stripe_onboarding_complete, stripe_charges_enabled, stripe_payouts_enabled, stripe_connected_at')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    // No account connected
    if (!balance?.stripe_account_id) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          connected: false,
          status: 'not_connected',
          onboardingComplete: false,
          chargesEnabled: false,
          payoutsEnabled: false,
          needsOnboarding: true,
        }),
      };
    }

    // Sync with Stripe to get latest status
    let stripeAccount;
    try {
      stripeAccount = await stripe.accounts.retrieve(balance.stripe_account_id);
    } catch (stripeError) {
      // Account doesn't exist in Stripe - reset local status
      if (stripeError.code === 'account_invalid' || stripeError.type === 'invalid_request_error') {
        await supabase
          .from('gem_balances')
          .update({
            stripe_account_id: null,
            stripe_account_status: 'not_connected',
            stripe_onboarding_complete: false,
            stripe_charges_enabled: false,
            stripe_payouts_enabled: false,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            connected: false,
            status: 'not_connected',
            onboardingComplete: false,
            chargesEnabled: false,
            payoutsEnabled: false,
            needsOnboarding: true,
            message: 'Please reconnect your payout account',
          }),
        };
      }
      throw stripeError;
    }

    // Determine status
    const chargesEnabled = stripeAccount.charges_enabled || false;
    const payoutsEnabled = stripeAccount.payouts_enabled || false;
    const detailsSubmitted = stripeAccount.details_submitted || false;
    
    let status = 'pending';
    let onboardingComplete = false;
    
    if (chargesEnabled && payoutsEnabled) {
      status = 'active';
      onboardingComplete = true;
    } else if (stripeAccount.requirements?.disabled_reason) {
      status = 'restricted';
    } else if (detailsSubmitted) {
      status = 'pending'; // Stripe is reviewing
    }

    // Update local database if status changed
    if (
      status !== balance.stripe_account_status ||
      onboardingComplete !== balance.stripe_onboarding_complete ||
      chargesEnabled !== balance.stripe_charges_enabled ||
      payoutsEnabled !== balance.stripe_payouts_enabled
    ) {
      await supabase
        .from('gem_balances')
        .update({
          stripe_account_status: status,
          stripe_onboarding_complete: onboardingComplete,
          stripe_charges_enabled: chargesEnabled,
          stripe_payouts_enabled: payoutsEnabled,
          stripe_connected_at: onboardingComplete && !balance.stripe_connected_at ? new Date().toISOString() : balance.stripe_connected_at,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
    }

    // Check if there are pending requirements
    const pendingRequirements = stripeAccount.requirements?.currently_due || [];
    const eventuallyDue = stripeAccount.requirements?.eventually_due || [];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        connected: true,
        status,
        onboardingComplete,
        chargesEnabled,
        payoutsEnabled,
        accountId: balance.stripe_account_id,
        needsOnboarding: !onboardingComplete || pendingRequirements.length > 0,
        pendingRequirements: pendingRequirements.length,
        connectedAt: balance.stripe_connected_at,
        // Don't expose sensitive details
        email: stripeAccount.email ? `${stripeAccount.email.substring(0, 3)}***` : null,
      }),
    };

  } catch (error) {
    console.error('❌ Error getting Connect status:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to get Connect status',
        message: error.message,
      }),
    };
  }
};
