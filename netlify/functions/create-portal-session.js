'use strict';

/**
 * Create Stripe Customer Portal Session
 * 
 * Creates a billing portal session for subscription management.
 * User can cancel subscription, update payment method, view invoices.
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// CORS headers
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
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
    // Check Stripe configuration
    if (!process.env.STRIPE_SECRET_KEY) {
      console.error('❌ STRIPE_SECRET_KEY not configured');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Billing not configured',
          message: 'Stripe is not properly configured. Please contact support.'
        }),
      };
    }
    
    const body = JSON.parse(event.body || '{}');
    const { userId, returnUrl } = body;

    if (!userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'userId is required' }),
      };
    }

    console.log(`📋 Creating billing portal session for user: ${userId}`);

    // Get user's Stripe customer ID from subscription
    const { data: subscription, error: subError } = await supabase
      .from('user_subscriptions')
      .select('stripe_customer_id, plan_type, status')
      .eq('user_id', userId)
      .single();

    console.log(`📋 Subscription lookup result:`, { 
      found: !!subscription, 
      error: subError?.message,
      hasCustomerId: !!subscription?.stripe_customer_id,
      plan: subscription?.plan_type,
      status: subscription?.status
    });

    if (subError) {
      // Check if it's a "no rows" error vs other errors
      if (subError.code === 'PGRST116') {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ 
            error: 'No subscription found',
            message: 'You don\'t have an active subscription. Please subscribe first.'
          }),
        };
      }
      console.error('❌ Subscription lookup error:', subError);
      throw subError;
    }

    if (!subscription?.stripe_customer_id) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ 
          error: 'No billing account',
          message: 'No billing account found for your subscription. This may be a legacy subscription. Please contact support.'
        }),
      };
    }

    const customerId = subscription.stripe_customer_id;
    console.log(`📋 Found Stripe customer ID: ${customerId.substring(0, 10)}...`);

    // Create billing portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl || `${process.env.URL || 'https://sphere.chatspheres.com'}/profile.html`,
    });

    console.log(`✅ Created billing portal session for customer ${customerId}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        url: session.url,
      }),
    };

  } catch (error) {
    console.error('❌ Portal session error:', error);
    
    // Provide more specific error messages
    let userMessage = 'Failed to create billing portal session. Please try again.';
    
    if (error.type === 'StripeInvalidRequestError') {
      if (error.message?.includes('No such customer')) {
        userMessage = 'Your billing account was not found. This may be a legacy subscription. Please contact support.';
      } else if (error.message?.includes('portal configuration')) {
        userMessage = 'Billing portal is not configured. Please contact support.';
      } else {
        userMessage = 'Billing error: ' + error.message;
      }
    }
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to create billing portal session',
        message: userMessage
      }),
    };
  }
};
