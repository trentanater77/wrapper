'use strict';

/**
 * Send Tip
 * 
 * Processes a tip from viewer to host.
 * Deducts from sender's spendable gems.
 * Credits 50% to host's cashable gems.
 * ChatSpheres keeps 50%.
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Commission rate (50% to host, 50% to platform)
const HOST_SHARE = 0.5;

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
    const { senderId, hostId, amount, roomId, senderName } = body;

    // Validate required fields
    if (!senderId || !hostId || !amount) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Missing required fields',
          required: ['senderId', 'hostId', 'amount']
        }),
      };
    }

    const tipAmount = parseInt(amount, 10);
    if (isNaN(tipAmount) || tipAmount < 10) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Minimum tip is 10 gems' }),
      };
    }

    // Get sender's gem balance
    const { data: senderBalance, error: senderError } = await supabase
      .from('gem_balances')
      .select('spendable_gems')
      .eq('user_id', senderId)
      .single();

    if (senderError || !senderBalance) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Sender has no gem balance' }),
      };
    }

    if (senderBalance.spendable_gems < tipAmount) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Insufficient gems',
          available: senderBalance.spendable_gems,
          required: tipAmount
        }),
      };
    }

    // Calculate host share (50%)
    const hostShare = Math.floor(tipAmount * HOST_SHARE);
    
    // Deduct from sender's spendable gems
    const newSenderBalance = senderBalance.spendable_gems - tipAmount;
    const { error: deductError } = await supabase
      .from('gem_balances')
      .update({ 
        spendable_gems: newSenderBalance,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', senderId);

    if (deductError) {
      console.error('❌ Error deducting gems:', deductError);
      throw deductError;
    }

    // Credit host's cashable gems (create record if doesn't exist)
    const { data: hostBalance } = await supabase
      .from('gem_balances')
      .select('cashable_gems')
      .eq('user_id', hostId)
      .single();

    if (!hostBalance) {
      // Create balance record for host
      await supabase
        .from('gem_balances')
        .insert({ 
          user_id: hostId, 
          spendable_gems: 0, 
          cashable_gems: hostShare,
          promo_gems: 0
        });
    } else {
      // Update existing balance
      const newHostCashable = (hostBalance.cashable_gems || 0) + hostShare;
      await supabase
        .from('gem_balances')
        .update({ 
          cashable_gems: newHostCashable,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', hostId);
    }

    // Log transaction for sender (tip sent)
    await supabase
      .from('gem_transactions')
      .insert({
        user_id: senderId,
        transaction_type: 'tip_sent',
        amount: -tipAmount,
        wallet_type: 'spendable',
        related_user_id: hostId,
        room_id: roomId || null,
        description: `Tipped ${tipAmount} gems to host`,
      });

    // Log transaction for host (tip received)
    await supabase
      .from('gem_transactions')
      .insert({
        user_id: hostId,
        transaction_type: 'tip_received',
        amount: hostShare,
        wallet_type: 'cashable',
        related_user_id: senderId,
        room_id: roomId || null,
        description: `Received tip: ${hostShare} gems (${tipAmount} total, 50% commission)`,
      });

    console.log(`💸 Tip processed: ${senderId} -> ${hostId}, amount: ${tipAmount}, host receives: ${hostShare}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        tipAmount,
        hostReceived: hostShare,
        platformFee: tipAmount - hostShare,
        senderNewBalance: newSenderBalance,
        message: `Successfully tipped ${tipAmount} gems!`
      }),
    };

  } catch (error) {
    console.error('❌ Error processing tip:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to process tip',
        message: error.message 
      }),
    };
  }
};
