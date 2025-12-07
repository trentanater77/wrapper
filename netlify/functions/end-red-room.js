'use strict';

/**
 * End Red Room - Distribute pot to winner(s)
 * 
 * Logic:
 * 1. Get all votes for the room
 * 2. Determine winner (most votes) or draw
 * 3. If pot < 100 gems ($1), refund everyone (void rule)
 * 4. Otherwise, distribute pot to winner(s)
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Commission rate (50% to winner, 50% to platform)
const WINNER_SHARE = 0.5;
const VOID_THRESHOLD = 100; // Minimum pot to distribute (prevents credit card washing)

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
    const { roomId, hostId } = body;

    if (!roomId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Room ID is required' }),
      };
    }

    // Get room data
    const { data: roomData, error: roomError } = await supabase
      .from('active_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (roomError || !roomData) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Room not found' }),
      };
    }

    // Verify caller is the host
    if (hostId && roomData.host_id !== hostId) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Only the host can end the room' }),
      };
    }

    // Get all held pot transactions
    const { data: potTransactions, error: potError } = await supabase
      .from('pot_transactions')
      .select('*')
      .eq('room_id', roomId)
      .eq('status', 'held');

    if (potError) {
      throw potError;
    }

    const totalPot = potTransactions?.reduce((sum, t) => sum + t.amount, 0) || 0;

    // VOID RULE: If pot < 100 gems, refund everyone
    if (totalPot < VOID_THRESHOLD) {
      console.log(`🔴 VOID RULE: Pot (${totalPot}) < ${VOID_THRESHOLD}, refunding all`);
      
      // Refund each sender
      for (const tx of potTransactions || []) {
        // Return gems to sender
        const { data: senderBalance } = await supabase
          .from('gem_balances')
          .select('spendable_gems')
          .eq('user_id', tx.sender_id)
          .single();

        if (senderBalance) {
          await supabase
            .from('gem_balances')
            .update({ 
              spendable_gems: senderBalance.spendable_gems + tx.amount,
              updated_at: new Date().toISOString()
            })
            .eq('user_id', tx.sender_id);
        }

        // Mark transaction as refunded
        await supabase
          .from('pot_transactions')
          .update({ 
            status: 'refunded',
            released_at: new Date().toISOString()
          })
          .eq('id', tx.id);

        // Log refund
        await supabase
          .from('gem_transactions')
          .insert({
            user_id: tx.sender_id,
            transaction_type: 'refund',
            amount: tx.amount,
            wallet_type: 'spendable',
            room_id: roomId,
            description: `Refund: Pot under ${VOID_THRESHOLD} gems minimum`,
          });
      }

      // Mark room as ended
      await supabase
        .from('active_rooms')
        .update({ 
          status: 'ended',
          ended_at: new Date().toISOString()
        })
        .eq('room_id', roomId);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          result: 'void',
          totalPot,
          reason: `Pot under ${VOID_THRESHOLD} gems minimum - all refunded`,
        }),
      };
    }

    // Get votes
    const { data: votes, error: voteError } = await supabase
      .from('room_votes')
      .select('*')
      .eq('room_id', roomId);

    if (voteError) {
      throw voteError;
    }

    // Count tips per recipient (this is the scoreboard data)
    const tipCounts = {};
    for (const tx of potTransactions || []) {
      tipCounts[tx.recipient_id] = (tipCounts[tx.recipient_id] || 0) + tx.amount;
    }

    // Count votes (if any)
    const voteCounts = {};
    let drawVotes = 0;

    for (const vote of votes || []) {
      if (vote.is_draw_vote) {
        drawVotes++;
      } else if (vote.voted_for) {
        voteCounts[vote.voted_for] = (voteCounts[vote.voted_for] || 0) + 1;
      }
    }

    // Determine winner - prefer votes, but if no votes, use tips received
    let winners = [];
    let maxVotes = 0;
    let isDraw = false;

    // First try votes
    for (const [participantId, count] of Object.entries(voteCounts)) {
      if (count > maxVotes) {
        maxVotes = count;
        winners = [participantId];
      } else if (count === maxVotes) {
        winners.push(participantId);
      }
    }

    // If draw votes are highest, treat as a draw
    if (drawVotes >= maxVotes && drawVotes > 0) {
      isDraw = true;
      winners = Object.keys(tipCounts);
    }
    
    // If no votes at all, determine winner by tips received
    if (winners.length === 0 && Object.keys(tipCounts).length > 0) {
      let maxTips = 0;
      for (const [recipientId, tipAmount] of Object.entries(tipCounts)) {
        if (tipAmount > maxTips) {
          maxTips = tipAmount;
          winners = [recipientId];
        } else if (tipAmount === maxTips) {
          winners.push(recipientId);
        }
      }
      // If tips are equal, it's a draw
      if (winners.length > 1) {
        isDraw = true;
      }
    }
    
    // If still no winners, get all recipients
    if (winners.length === 0) {
      const recipientIds = [...new Set(potTransactions.map(t => t.recipient_id))];
      winners = recipientIds;
      isDraw = winners.length > 1;
    }

    // Calculate share per winner
    const winnerPot = Math.floor(totalPot * WINNER_SHARE);
    const sharePerWinner = Math.floor(winnerPot / winners.length);

    console.log(`🔴 Red Room ended: pot=${totalPot}, winners=${winners.length}, share=${sharePerWinner}`);

    // Distribute to winners
    for (const winnerId of winners) {
      // Get or create winner's balance
      const { data: winnerBalance } = await supabase
        .from('gem_balances')
        .select('cashable_gems')
        .eq('user_id', winnerId)
        .single();

      if (!winnerBalance) {
        await supabase
          .from('gem_balances')
          .insert({ 
            user_id: winnerId, 
            spendable_gems: 0, 
            cashable_gems: sharePerWinner,
            promo_gems: 0
          });
      } else {
        await supabase
          .from('gem_balances')
          .update({ 
            cashable_gems: winnerBalance.cashable_gems + sharePerWinner,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', winnerId);
      }

      // Log transaction
      await supabase
        .from('gem_transactions')
        .insert({
          user_id: winnerId,
          transaction_type: 'tip_received',
          amount: sharePerWinner,
          wallet_type: 'cashable',
          room_id: roomId,
          description: isDraw 
            ? `Red Room draw: ${sharePerWinner} gems (split pot of ${totalPot})`
            : `Red Room winner: ${sharePerWinner} gems (50% of ${totalPot} pot)`,
        });
    }

    // Mark all pot transactions as released
    await supabase
      .from('pot_transactions')
      .update({ 
        status: 'released',
        released_at: new Date().toISOString()
      })
      .eq('room_id', roomId)
      .eq('status', 'held');

    // Mark room as ended
    await supabase
      .from('active_rooms')
      .update({ 
        status: 'ended',
        ended_at: new Date().toISOString()
      })
      .eq('room_id', roomId);

    // Get winner's name for display
    let winnerName = null;
    if (!isDraw && winners.length === 1) {
      const { data: winnerProfile } = await supabase
        .from('user_profiles')
        .select('username, display_name')
        .eq('id', winners[0])
        .single();
      
      winnerName = winnerProfile?.display_name || winnerProfile?.username || 'Winner';
    }

    console.log(`🏆 Red Room ${roomId} ended: ${isDraw ? 'DRAW' : 'WINNER'} - ${winnerName || 'Multiple winners'}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        result: isDraw ? 'draw' : 'winner',
        totalPot,
        winnerAmount: sharePerWinner,
        winnerShare: sharePerWinner,
        winners: winners,
        winnerName: winnerName,
        platformFee: totalPot - (sharePerWinner * winners.length),
      }),
    };

  } catch (error) {
    console.error('❌ Error ending red room:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to end room',
        message: error.message 
      }),
    };
  }
};
