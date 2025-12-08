'use strict';

/**
 * Send Tip
 * 
 * Processes a tip from viewer to host.
 * Deducts from sender's spendable gems.
 * 
 * REVENUE SPLIT:
 * - Standard (non-forum): 50% host, 50% platform
 * - Forum tip: 45% host, 10% forum creator, 45% platform
 *   (If host IS the forum creator: 55% host, 45% platform)
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Commission rates
const STANDARD_HOST_SHARE = 0.50;      // Standard: 50% host, 50% platform
const FORUM_HOST_SHARE = 0.45;         // Forum: 45% host
const FORUM_CREATOR_SHARE = 0.10;      // Forum: 10% forum creator
const FORUM_HOST_CREATOR_SHARE = 0.55; // Forum (host is creator): 55% host

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
    const { senderId, hostId, amount, roomId, senderName, forumId } = body;

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

    // Check if this is a forum tip and determine revenue split
    let hostShare, forumCreatorShare = 0, forumOwnerId = null;
    
    if (forumId) {
      // Forum tip - check forum ownership
      const { data: forum } = await supabase
        .from('forums')
        .select('owner_id')
        .eq('id', forumId)
        .single();
      
      if (forum && forum.owner_id) {
        forumOwnerId = forum.owner_id;
        
        if (forumOwnerId === hostId) {
          // Host IS the forum creator - they get 55%
          hostShare = Math.floor(tipAmount * FORUM_HOST_CREATOR_SHARE);
          forumCreatorShare = 0; // Already included in host share
        } else {
          // Different host and creator - split: 45% host, 10% creator
          hostShare = Math.floor(tipAmount * FORUM_HOST_SHARE);
          forumCreatorShare = Math.floor(tipAmount * FORUM_CREATOR_SHARE);
        }
      } else {
        // Forum not found or no owner - use standard split
        hostShare = Math.floor(tipAmount * STANDARD_HOST_SHARE);
      }
    } else {
      // Standard tip (non-forum) - 50% to host
      hostShare = Math.floor(tipAmount * STANDARD_HOST_SHARE);
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
    const hostDescription = forumId 
      ? `Received tip: ${hostShare} gems (${tipAmount} total, forum tip)`
      : `Received tip: ${hostShare} gems (${tipAmount} total, 50% commission)`;
    
    await supabase
      .from('gem_transactions')
      .insert({
        user_id: hostId,
        transaction_type: 'tip_received',
        amount: hostShare,
        wallet_type: 'cashable',
        related_user_id: senderId,
        room_id: roomId || null,
        description: hostDescription,
      });

    // If forum tip with separate creator, credit forum creator and log
    if (forumCreatorShare > 0 && forumOwnerId && forumOwnerId !== hostId) {
      // Credit forum creator's cashable gems
      const { data: creatorBalance } = await supabase
        .from('gem_balances')
        .select('cashable_gems')
        .eq('user_id', forumOwnerId)
        .single();

      if (!creatorBalance) {
        await supabase
          .from('gem_balances')
          .insert({ 
            user_id: forumOwnerId, 
            spendable_gems: 0, 
            cashable_gems: forumCreatorShare,
            promo_gems: 0
          });
      } else {
        await supabase
          .from('gem_balances')
          .update({ 
            cashable_gems: (creatorBalance.cashable_gems || 0) + forumCreatorShare,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', forumOwnerId);
      }

      // Log transaction for forum creator
      await supabase
        .from('gem_transactions')
        .insert({
          user_id: forumOwnerId,
          transaction_type: 'forum_revenue',
          amount: forumCreatorShare,
          wallet_type: 'cashable',
          related_user_id: hostId,
          room_id: roomId || null,
          description: `Forum revenue: ${forumCreatorShare} gems (10% of ${tipAmount} tip)`,
        });

      // Log to forum_earnings table
      await supabase
        .from('forum_earnings')
        .insert({
          forum_id: forumId,
          owner_id: forumOwnerId,
          room_id: roomId || null,
          total_tip_amount: tipAmount,
          creator_share: forumCreatorShare,
          tipper_id: senderId,
          host_id: hostId,
        });
    }

    // Detailed logging for testing revenue split
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('💸 TIP PROCESSED - REVENUE SPLIT:');
    console.log(`   Total: ${tipAmount} gems`);
    console.log(`   Host (${hostId.substring(0,8)}...): ${hostShare} gems (${Math.round(hostShare/tipAmount*100)}%)`);
    if (forumCreatorShare > 0) {
      console.log(`   Forum Creator (${forumOwnerId.substring(0,8)}...): ${forumCreatorShare} gems (${Math.round(forumCreatorShare/tipAmount*100)}%)`);
    }
    console.log(`   Platform: ${tipAmount - hostShare - forumCreatorShare} gems (${Math.round((tipAmount - hostShare - forumCreatorShare)/tipAmount*100)}%)`);
    if (forumId) {
      console.log(`   Forum ID: ${forumId}`);
      console.log(`   Host is creator: ${forumOwnerId === hostId}`);
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const response = {
      success: true,
      tipAmount,
      hostReceived: hostShare,
      platformFee: tipAmount - hostShare - forumCreatorShare,
      senderNewBalance: newSenderBalance,
      message: `Successfully tipped ${tipAmount} gems!`
    };
    
    if (forumCreatorShare > 0) {
      response.forumCreatorReceived = forumCreatorShare;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response),
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
