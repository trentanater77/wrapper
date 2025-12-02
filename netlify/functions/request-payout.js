'use strict';

/**
 * Request Payout
 * 
 * Allows hosts to request a payout of their cashable gems.
 * Minimum payout: 500 gems ($4.95)
 * Conversion rate: 100 gems = $0.99
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Conversion rate: 100 gems = $0.99
const GEMS_PER_DOLLAR_UNIT = 100;
const DOLLAR_RATE = 0.99;
const MIN_PAYOUT_GEMS = 500; // Minimum 500 gems = $4.95

function gemsToUsd(gems) {
  return Math.round((gems / GEMS_PER_DOLLAR_UNIT) * DOLLAR_RATE * 100) / 100;
}

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
    const { userId, gemsAmount, payoutMethod, payoutEmail } = body;

    // Validate required fields
    if (!userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'User ID is required' }),
      };
    }

    if (!payoutEmail) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Payout email/username is required' }),
      };
    }

    // Get user's cashable balance
    const { data: balance, error: balanceError } = await supabase
      .from('gem_balances')
      .select('cashable_gems')
      .eq('user_id', userId)
      .single();

    if (balanceError || !balance) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'No gem balance found' }),
      };
    }

    const cashableGems = balance.cashable_gems || 0;
    const requestedGems = parseInt(gemsAmount, 10) || cashableGems; // Default to all cashable gems

    // Validate minimum payout
    if (requestedGems < MIN_PAYOUT_GEMS) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: `Minimum payout is ${MIN_PAYOUT_GEMS} gems ($${gemsToUsd(MIN_PAYOUT_GEMS)})`,
          currentBalance: cashableGems,
          minimum: MIN_PAYOUT_GEMS
        }),
      };
    }

    // Check if user has enough cashable gems
    if (requestedGems > cashableGems) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Insufficient cashable gems',
          requested: requestedGems,
          available: cashableGems
        }),
      };
    }

    // Check for pending payout requests
    const { data: pendingRequests } = await supabase
      .from('payout_requests')
      .select('id')
      .eq('user_id', userId)
      .in('status', ['pending', 'processing'])
      .limit(1);

    if (pendingRequests && pendingRequests.length > 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'You already have a pending payout request. Please wait for it to be processed.'
        }),
      };
    }

    const usdAmount = gemsToUsd(requestedGems);

    // Create payout request
    const { data: payoutRequest, error: insertError } = await supabase
      .from('payout_requests')
      .insert({
        user_id: userId,
        gems_amount: requestedGems,
        usd_amount: usdAmount,
        payout_method: payoutMethod || 'paypal',
        payout_email: payoutEmail,
        status: 'pending'
      })
      .select()
      .single();

    if (insertError) {
      console.error('❌ Error creating payout request:', insertError);
      throw insertError;
    }

    // Deduct gems from cashable balance (hold them)
    const newCashableBalance = cashableGems - requestedGems;
    await supabase
      .from('gem_balances')
      .update({ 
        cashable_gems: newCashableBalance,
        payout_email: payoutEmail,
        payout_method: payoutMethod || 'paypal',
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    // Log transaction
    await supabase
      .from('gem_transactions')
      .insert({
        user_id: userId,
        transaction_type: 'payout_request',
        amount: -requestedGems,
        wallet_type: 'cashable',
        description: `Payout request: ${requestedGems} gems → $${usdAmount} (${payoutMethod || 'paypal'})`
      });

    console.log(`💸 Payout request created: ${userId} requested ${requestedGems} gems ($${usdAmount})`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        request: {
          id: payoutRequest.id,
          gemsAmount: requestedGems,
          usdAmount,
          payoutMethod: payoutMethod || 'paypal',
          payoutEmail,
          status: 'pending'
        },
        newCashableBalance,
        message: `Payout request submitted! You'll receive $${usdAmount} via ${payoutMethod || 'PayPal'} within 3-5 business days.`
      }),
    };

  } catch (error) {
    console.error('❌ Error processing payout request:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to process payout request',
        message: error.message 
      }),
    };
  }
};
