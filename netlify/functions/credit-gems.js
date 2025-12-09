'use strict';

/**
 * Credit Gems to User
 * 
 * Admin function to manually credit gems to a user.
 * Used for fixing missing gem credits or manual adjustments.
 * 
 * PROTECTED: Requires X-Admin-Secret header
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Admin secret for protecting this endpoint (REQUIRED - no fallback for security)
const ADMIN_SECRET = process.env.ADMIN_SECRET;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Secret',
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

  // Verify admin secret - REQUIRED for security
  const adminSecret = event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'];
  if (!ADMIN_SECRET) {
    console.error('❌ ADMIN_SECRET environment variable not configured');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server configuration error - admin secret not set' }),
    };
  }
  if (adminSecret !== ADMIN_SECRET) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Unauthorized - Invalid admin secret' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { userId, amount, reason } = body;

    if (!userId || !amount) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'userId and amount are required' }),
      };
    }

    const gemAmount = parseInt(amount, 10);
    if (isNaN(gemAmount) || gemAmount <= 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'amount must be a positive number' }),
      };
    }

    // Check if gem balance record exists
    const { data: existing } = await supabase
      .from('gem_balances')
      .select('id, spendable_gems')
      .eq('user_id', userId)
      .single();

    let newBalance;

    if (!existing) {
      // Create new record
      const { error: insertError } = await supabase
        .from('gem_balances')
        .insert({ 
          user_id: userId, 
          spendable_gems: gemAmount, 
          cashable_gems: 0,
          promo_gems: 0
        });
      
      if (insertError) {
        throw insertError;
      }
      newBalance = gemAmount;
    } else {
      // Update existing
      newBalance = (existing.spendable_gems || 0) + gemAmount;
      const { error: updateError } = await supabase
        .from('gem_balances')
        .update({ 
          spendable_gems: newBalance,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);
      
      if (updateError) {
        throw updateError;
      }
    }

    // Log transaction
    await supabase
      .from('gem_transactions')
      .insert({
        user_id: userId,
        transaction_type: 'subscription_bonus',
        amount: gemAmount,
        wallet_type: 'spendable',
        description: reason || `Manual credit: ${gemAmount} gems`,
      });

    console.log(`💎 Credited ${gemAmount} gems to user ${userId}. New balance: ${newBalance}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        userId,
        credited: gemAmount,
        newBalance,
        message: `Successfully credited ${gemAmount} gems`
      }),
    };

  } catch (error) {
    console.error('❌ Error crediting gems:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to credit gems',
        message: error.message 
      }),
    };
  }
};
