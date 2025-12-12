'use strict';

/**
 * Stripe Connect Onboarding
 * 
 * Creates a Stripe Connect Express account for creators and returns
 * an onboarding link to complete their account setup.
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
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async function(event) {
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
    const { userId, userEmail, userName } = body;

    if (!userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'User ID is required' }),
      };
    }

    // Check if user already has a connected account
    const { data: existing } = await supabase
      .from('gem_balances')
      .select('stripe_account_id, stripe_account_status, stripe_onboarding_complete')
      .eq('user_id', userId)
      .single();

    let stripeAccountId = existing?.stripe_account_id;

    // If account exists and is fully set up, no need to onboard again
    if (stripeAccountId && existing?.stripe_onboarding_complete) {
      // Verify with Stripe that account is still valid
      try {
        const account = await stripe.accounts.retrieve(stripeAccountId);
        
        if (account.charges_enabled && account.payouts_enabled) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              alreadyConnected: true,
              message: 'Your payout account is already set up!',
              accountId: stripeAccountId,
            }),
          };
        }
        
        // Account exists but needs more info - create new onboarding link
        console.log(`🔄 Account ${stripeAccountId} needs additional info`);
      } catch (e) {
        // Account doesn't exist in Stripe anymore - create new one
        console.log(`⚠️ Account ${stripeAccountId} not found in Stripe, creating new`);
        stripeAccountId = null;
      }
    }

    // Create new Express account if needed
    if (!stripeAccountId) {
      console.log(`🆕 Creating new Stripe Connect account for user ${userId}`);
      
      const account = await stripe.accounts.create({
        type: 'express',
        email: userEmail || undefined,
        metadata: {
          user_id: userId,
          platform: 'chatspheres',
        },
        capabilities: {
          transfers: { requested: true },
        },
        business_type: 'individual',
        settings: {
          payouts: {
            schedule: {
              interval: 'manual', // Creators request payouts manually
            },
          },
        },
      });

      stripeAccountId = account.id;
      console.log(`✅ Created Stripe account: ${stripeAccountId}`);

      // Save to database
      const { error: upsertError } = await supabase
        .from('gem_balances')
        .upsert({
          user_id: userId,
          stripe_account_id: stripeAccountId,
          stripe_account_status: 'pending',
          stripe_onboarding_complete: false,
          stripe_charges_enabled: false,
          stripe_payouts_enabled: false,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id',
        });

      if (upsertError) {
        console.error('❌ Error saving Stripe account ID:', upsertError);
        // Don't throw - account is created, just DB save failed
      }
    }

    // Create onboarding link
    const baseUrl = process.env.URL || 'https://sphere.chatspheres.com';
    
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${baseUrl}/cashout.html?connect=refresh`,
      return_url: `${baseUrl}/cashout.html?connect=complete`,
      type: 'account_onboarding',
    });

    console.log(`🔗 Onboarding link created for ${stripeAccountId}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        url: accountLink.url,
        accountId: stripeAccountId,
        message: 'Complete your payout account setup',
      }),
    };

  } catch (error) {
    console.error('❌ Error in connect-onboarding:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to create onboarding link',
        message: error.message,
      }),
    };
  }
};
