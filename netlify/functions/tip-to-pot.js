'use strict';

/**
 * Tip to Pot (Red Room)
 * 
 * During Red Room debates, tips go into a temporary pot.
 * At the end, the winner takes the pot based on audience vote.
 * If pot < 100 gems, refund everyone (void rule).
 */

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
    const { senderId, recipientId, amount, roomId, senderName } = body;

    // Validate required fields
    if (!senderId || !recipientId || !amount || !roomId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Missing required fields',
          required: ['senderId', 'recipientId', 'amount', 'roomId']
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

    // Add to pot_transactions (held state)
    const { error: potError } = await supabase
      .from('pot_transactions')
      .insert({
        room_id: roomId,
        sender_id: senderId,
        sender_name: senderName || 'Anonymous',
        recipient_id: recipientId,
        amount: tipAmount,
        status: 'held'
      });

    if (potError) {
      console.error('❌ Error adding to pot:', potError);
      // Refund the sender
      await supabase
        .from('gem_balances')
        .update({ 
          spendable_gems: senderBalance.spendable_gems,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', senderId);
      throw potError;
    }

    // Update room's pot amount
    const { data: roomData } = await supabase
      .from('active_rooms')
      .select('pot_amount')
      .eq('room_id', roomId)
      .single();

    if (roomData) {
      await supabase
        .from('active_rooms')
        .update({ 
          pot_amount: (roomData.pot_amount || 0) + tipAmount 
        })
        .eq('room_id', roomId);
    }

    // Log transaction for sender
    await supabase
      .from('gem_transactions')
      .insert({
        user_id: senderId,
        transaction_type: 'tip_sent',
        amount: -tipAmount,
        wallet_type: 'spendable',
        related_user_id: recipientId,
        room_id: roomId,
        description: `Added ${tipAmount} gems to Red Room pot`,
      });

    // Get current pot total
    const { data: potTotal } = await supabase
      .rpc('get_room_pot', { p_room_id: roomId });

    console.log(`🔴 Pot tip: ${senderId} -> pot for ${recipientId}, amount: ${tipAmount}, total pot: ${potTotal}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        tipAmount,
        potTotal: potTotal || tipAmount,
        senderNewBalance: newSenderBalance,
        message: `Added ${tipAmount} gems to the pot!`
      }),
    };

  } catch (error) {
    console.error('❌ Error processing pot tip:', error);
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
