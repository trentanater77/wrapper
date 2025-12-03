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
    const body = JSON.parse(event.body || '{}');
    const { userId, returnUrl } = body;

    if (!userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'userId is required' }),
      };
    }

    // Get user's Stripe customer ID from subscription
    const { data: subscription, error: subError } = await supabase
      .from('user_subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single();

    if (subError || !subscription?.stripe_customer_id) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ 
          error: 'No subscription found',
          message: 'You need an active subscription to manage billing.'
        }),
      };
    }

    const customerId = subscription.stripe_customer_id;

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
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to create billing portal session',
        message: error.message 
      }),
    };
  }
};
