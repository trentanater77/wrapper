'use strict';

/**
 * Manage Queue
 * 
 * Handle queue operations for Creator Rooms:
 * - Join queue (user or guest)
 * - Leave queue
 * - Get queue status
 * - Next challenger (host only)
 * - Challenger done
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Content-Type': 'application/json',
};

const BOOST_MIN_GEMS = 100;
const DEFAULT_CALL_SECONDS = 5 * 60;
const STANDARD_HOST_SHARE = 0.5;
const PAID_SLOT_PRICES = {
  5: 1500,
  10: 3000,
};

function safeInt(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isoNow() {
  return new Date().toISOString();
}

async function getSpendableBalance(userId) {
  const { data, error } = await supabase
    .from('gem_balances')
    .select('spendable_gems')
    .eq('user_id', userId)
    .single();
  if (error || !data) {
    return { spendable_gems: 0, exists: false };
  }
  return { spendable_gems: data.spendable_gems || 0, exists: true };
}

async function getCashableBalance(userId) {
  const { data, error } = await supabase
    .from('gem_balances')
    .select('cashable_gems')
    .eq('user_id', userId)
    .single();
  if (error || !data) {
    return { cashable_gems: 0, exists: false };
  }
  return { cashable_gems: data.cashable_gems || 0, exists: true };
}

async function ensureHostCashableCredit(hostId, amount) {
  const hostBalance = await getCashableBalance(hostId);
  if (!hostBalance.exists) {
    await supabase
      .from('gem_balances')
      .insert({
        user_id: hostId,
        spendable_gems: 0,
        cashable_gems: amount,
        promo_gems: 0,
      });
    return;
  }

  await supabase
    .from('gem_balances')
    .update({
      cashable_gems: hostBalance.cashable_gems + amount,
      updated_at: isoNow(),
    })
    .eq('user_id', hostId);
}

async function deductSpendableGems(userId, amount) {
  const senderBalance = await getSpendableBalance(userId);
  if (!senderBalance.exists) {
    return { ok: false, error: 'Sender has no gem balance' };
  }
  if (senderBalance.spendable_gems < amount) {
    return { ok: false, error: 'Insufficient gems', available: senderBalance.spendable_gems };
  }

  await supabase
    .from('gem_balances')
    .update({
      spendable_gems: senderBalance.spendable_gems - amount,
      updated_at: isoNow(),
    })
    .eq('user_id', userId);

  return { ok: true, remaining: senderBalance.spendable_gems - amount };
}

async function logGemTransaction({ userId, transactionType, amount, walletType, relatedUserId, roomId, description }) {
  try {
    await supabase
      .from('gem_transactions')
      .insert({
        user_id: userId,
        transaction_type: transactionType,
        amount,
        wallet_type: walletType,
        related_user_id: relatedUserId || null,
        room_id: roomId || null,
        description: description || null,
      });
  } catch (e) {
    console.warn('⚠️ Failed to log gem transaction:', e.message);
  }
}

async function applyMonetizedCharge({ roomId, payerId, hostId, gems, transactionType }) {
  const amount = safeInt(gems, 0);
  if (amount <= 0) {
    return { ok: false, error: 'Invalid amount' };
  }

  const deductResult = await deductSpendableGems(payerId, amount);
  if (!deductResult.ok) {
    return deductResult;
  }

  const hostShare = Math.floor(amount * STANDARD_HOST_SHARE);
  await ensureHostCashableCredit(hostId, hostShare);

  await logGemTransaction({
    userId: payerId,
    transactionType,
    amount: -amount,
    walletType: 'spendable',
    relatedUserId: hostId,
    roomId,
    description: `${transactionType}: spent ${amount} gems`,
  });

  await logGemTransaction({
    userId: hostId,
    transactionType,
    amount: hostShare,
    walletType: 'cashable',
    relatedUserId: payerId,
    roomId,
    description: `${transactionType}: received ${hostShare} gems`,
  });

  return { ok: true, senderRemaining: deductResult.remaining, hostShare };
}

function getQueueSortKey(entry) {
  const paidGems = safeInt(entry.paid_gems, 0);
  const boostGems = safeInt(entry.boost_gems, 0);
  const joinedAt = entry.joined_at ? new Date(entry.joined_at).getTime() : 0;

  if (paidGems > 0) {
    return { tier: 0, primary: joinedAt, secondary: joinedAt, boost: boostGems };
  }
  if (boostGems > 0) {
    return { tier: 1, primary: -boostGems, secondary: joinedAt, boost: boostGems };
  }
  return { tier: 2, primary: joinedAt, secondary: joinedAt, boost: boostGems };
}

function compareQueueEntries(a, b) {
  const ak = getQueueSortKey(a);
  const bk = getQueueSortKey(b);
  if (ak.tier !== bk.tier) return ak.tier - bk.tier;
  if (ak.primary !== bk.primary) return ak.primary - bk.primary;
  if (ak.secondary !== bk.secondary) return ak.secondary - bk.secondary;
  return 0;
}

async function setActiveRoomChallengerFields(roomId, payload) {
  try {
    await supabase
      .from('active_rooms')
      .update(payload)
      .eq('room_id', roomId);
  } catch (e) {
    const fallback = {
      current_challenger_id: payload.current_challenger_id,
      current_challenger_name: payload.current_challenger_name,
      current_challenger_started_at: payload.current_challenger_started_at,
    };
    await supabase
      .from('active_rooms')
      .update(fallback)
      .eq('room_id', roomId);
  }
}

async function setActiveQueueEntry(entryId, calledAt, timeLimitSeconds) {
  try {
    await supabase
      .from('room_queue')
      .update({
        status: 'active',
        called_at: calledAt,
        time_limit_seconds: timeLimitSeconds,
      })
      .eq('id', entryId);
  } catch (e) {
    await supabase
      .from('room_queue')
      .update({
        status: 'active',
        called_at: calledAt,
      })
      .eq('id', entryId);
  }
}

async function markActiveEntryCompleted(roomId, entryId, endedAt) {
  await supabase
    .from('room_queue')
    .update({ status: 'completed', ended_at: endedAt })
    .eq('room_id', roomId)
    .eq('id', entryId)
    .eq('status', 'active');
}

async function pickNextWaitingEntry(roomId) {
  const { data, error } = await supabase
    .from('room_queue')
    .select('*')
    .eq('room_id', roomId)
    .eq('status', 'waiting')
    .order('queue_position', { ascending: true })
    .limit(1)
    .single();
  if (error) return null;
  return data;
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // Verify Supabase configuration
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('❌ Missing Supabase configuration');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server configuration error', message: 'Database not configured' }),
    };
  }

  // GET: Get queue status for a room
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};
      const { roomId, userId, guestSessionId, autoAdvance, hostId } = params;

      console.log('📥 GET queue request:', { roomId, userId, guestSessionId, timestamp: new Date().toISOString() });

      if (!roomId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Room ID is required' }),
        };
      }

      const { data: room } = await supabase
        .from('active_rooms')
        .select('challenger_time_limit, host_id')
        .eq('room_id', roomId)
        .single();

      // Get full queue for the room
      const { data: queue, error: queueError } = await supabase
        .from('room_queue')
        .select('*')
        .eq('room_id', roomId)
        .eq('status', 'waiting')
        .order('queue_position', { ascending: true });
      
      // Debug: Also check for ALL entries in the room (any status) to diagnose issues
      const { data: allEntries } = await supabase
        .from('room_queue')
        .select('id, status, queue_position, user_id, guest_session_id, guest_name, created_at')
        .eq('room_id', roomId)
        .order('created_at', { ascending: false })
        .limit(10);
      
      if (allEntries && allEntries.length > 0) {
        console.log('📊 All queue entries for room (debug):', allEntries.map(e => ({
          id: e.id,
          status: e.status,
          pos: e.queue_position,
          name: e.guest_name,
          userId: e.user_id?.substring(0, 8),
          guestSession: e.guest_session_id?.substring(0, 15)
        })));
      }
      
      console.log('📋 Queue query result:', { 
        queueLength: queue?.length || 0, 
        queueError,
        queueItems: queue?.map(q => ({ id: q.id, status: q.status, position: q.queue_position, guestSessionId: q.guest_session_id?.substring(0, 10), userId: q.user_id?.substring(0, 10) }))
      });

      if (queueError) {
        // Table might not exist yet
        if (queueError.code === '42P01') {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ queue: [], position: null, totalInQueue: 0 }),
          };
        }
        throw queueError;
      }

      // Get current active challenger
      const { data: activeChallenger } = await supabase
        .from('room_queue')
        .select('*')
        .eq('room_id', roomId)
        .eq('status', 'active')
        .single();

      const shouldAutoAdvance = (autoAdvance === '1' || autoAdvance === 'true') && hostId && room?.host_id === hostId;

      if (shouldAutoAdvance && activeChallenger?.called_at) {
        const timeLimitFromEntry = safeInt(activeChallenger.time_limit_seconds, 0);
        const timeLimitFromPaid = safeInt(activeChallenger.paid_minutes, 0) > 0
          ? safeInt(activeChallenger.paid_minutes, 0) * 60
          : 0;
        const timeLimitFromRoom = safeInt(room?.challenger_time_limit, 0);
        const effectiveLimitSeconds = timeLimitFromEntry || timeLimitFromPaid || timeLimitFromRoom || DEFAULT_CALL_SECONDS;

        const calledAtMs = new Date(activeChallenger.called_at).getTime();
        const expiresAtMs = calledAtMs + effectiveLimitSeconds * 1000;
        if (Number.isFinite(expiresAtMs) && Date.now() >= expiresAtMs) {
          const endedAt = isoNow();
          await markActiveEntryCompleted(roomId, activeChallenger.id, endedAt);
          await setActiveRoomChallengerFields(roomId, {
            current_challenger_id: null,
            current_challenger_name: null,
            current_challenger_started_at: null,
            current_challenger_queue_id: null,
            current_challenger_time_limit_seconds: null,
            current_challenger_expires_at: null,
          });
          await reorderQueue(roomId);
          const nextChallenger = await pickNextWaitingEntry(roomId);
          if (nextChallenger) {
            const now = isoNow();
            const nextLimitSeconds =
              safeInt(nextChallenger.time_limit_seconds, 0) ||
              (safeInt(nextChallenger.paid_minutes, 0) > 0 ? safeInt(nextChallenger.paid_minutes, 0) * 60 : 0) ||
              timeLimitFromRoom ||
              DEFAULT_CALL_SECONDS;

            await setActiveQueueEntry(nextChallenger.id, now, nextLimitSeconds);
            await setActiveRoomChallengerFields(roomId, {
              current_challenger_id: nextChallenger.user_id,
              current_challenger_name: nextChallenger.guest_name || 'Challenger',
              current_challenger_started_at: now,
              current_challenger_queue_id: nextChallenger.id,
              current_challenger_time_limit_seconds: nextLimitSeconds,
              current_challenger_expires_at: new Date(Date.now() + nextLimitSeconds * 1000).toISOString(),
            });
            await reorderQueue(roomId);
          }
        }
      }

      // Find user's position if they're in queue
      let userPosition = null;
      let userStatus = null;
      
      if (userId || guestSessionId) {
        console.log('🔍 Looking for user in queue:', { 
          lookingForUserId: userId, 
          lookingForGuestSessionId: guestSessionId,
          queueLength: queue?.length || 0
        });
        
        const userEntry = queue.find(q => 
          (userId && q.user_id === userId) || 
          (guestSessionId && q.guest_session_id === guestSessionId)
        );
        
        if (userEntry) {
          console.log('✅ Found user in queue:', { 
            position: userEntry.queue_position, 
            status: userEntry.status,
            matchedByUserId: userId && userEntry.user_id === userId,
            matchedByGuestSession: guestSessionId && userEntry.guest_session_id === guestSessionId
          });
          userPosition = userEntry.queue_position;
          userStatus = userEntry.status;
        } else if (activeChallenger) {
          // Check if user is the active challenger
          if ((userId && activeChallenger.user_id === userId) ||
              (guestSessionId && activeChallenger.guest_session_id === guestSessionId)) {
            console.log('✅ User is the active challenger');
            userStatus = 'active';
            userPosition = 0; // Currently active
          } else {
            console.log('ℹ️ User not found in queue or as active challenger');
          }
        } else {
          console.log('ℹ️ User not found in queue, no active challenger');
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          queue: queue.map(q => ({
            id: q.id,
            position: q.queue_position,
            name: q.guest_name || 'Guest', // Use guest_name which stores actual username for all users
            isUser: q.user_id ? true : false,
            joinedAt: q.joined_at,
            paidGems: safeInt(q.paid_gems, 0),
            paidMinutes: safeInt(q.paid_minutes, 0),
            boostGems: safeInt(q.boost_gems, 0),
          })),
          activeChallenger: activeChallenger ? {
            id: activeChallenger.id,
            name: activeChallenger.guest_name || 'Challenger',
            isUser: !!activeChallenger.user_id,
            userId: activeChallenger.user_id,
            guestSessionId: activeChallenger.guest_session_id,
            startedAt: activeChallenger.called_at,
            timeLimitSeconds: safeInt(activeChallenger.time_limit_seconds, 0) || (safeInt(activeChallenger.paid_minutes, 0) > 0 ? safeInt(activeChallenger.paid_minutes, 0) * 60 : null) || safeInt(room?.challenger_time_limit, 0) || DEFAULT_CALL_SECONDS,
          } : null,
          position: userPosition,
          userStatus,
          totalInQueue: queue.length,
        }),
      };

    } catch (error) {
      console.error('❌ Error getting queue:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to get queue' }),
      };
    }
  }

  // POST: Queue operations
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { action, roomId } = body;

    if (!roomId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Room ID is required' }),
      };
    }

    switch (action) {
      case 'join': {
        const { userId, userName, guestName, guestSessionId } = body;

        console.log('🎯 JOIN queue request:', { roomId, userId, userName, guestName, guestSessionId });
        console.log('🎯 Full request body:', JSON.stringify(body));

        // Must have either userId or guestSessionId
        if (!userId && !guestSessionId) {
          console.log('❌ No user ID or guest session ID provided');
          console.log('❌ Body received:', JSON.stringify(body));
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
              error: 'User ID or guest session ID is required',
              received: { userId, guestSessionId, hasBody: !!body }
            }),
          };
        }

        // Check if room exists and is a creator room
        let room, roomError;
        try {
          const result = await supabase
            .from('active_rooms')
            .select('room_type, is_creator_room, max_queue_size, host_id')
            .eq('room_id', roomId)
            .eq('status', 'live')
            .single();
          room = result.data;
          roomError = result.error;
        } catch (e) {
          console.error('❌ Room lookup exception:', e);
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Database error during room lookup', message: e.message }),
          };
        }

        console.log('🏠 Room lookup result:', { room, roomError });
        
        if (roomError || !room) {
          console.log('❌ Room not found:', roomError);
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Room not found or not live', details: roomError?.message }),
          };
        }

        if (room.room_type !== 'creator' && !room.is_creator_room) {
          console.log('❌ Room is not a creator room:', room.room_type, room.is_creator_room);
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'This room does not have a queue' }),
          };
        }
        
        console.log('✅ Room is valid creator room');

        // Check if host is trying to join their own queue
        if (userId && room.host_id === userId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Host cannot join their own queue' }),
          };
        }

        // Check if already in queue
        let existing = null;
        try {
          let existingQuery = supabase
            .from('room_queue')
            .select('*')
            .eq('room_id', roomId)
            .in('status', ['waiting', 'active']);

          if (userId) {
            existingQuery = existingQuery.eq('user_id', userId);
          } else {
            existingQuery = existingQuery.eq('guest_session_id', guestSessionId);
          }

          const { data, error: existingError } = await existingQuery.single();
          
          // Error code PGRST116 means no rows found, which is expected
          if (existingError && existingError.code !== 'PGRST116') {
            console.log('⚠️ Existing check query note:', existingError.code, existingError.message);
          }
          
          existing = data;
        } catch (e) {
          console.error('❌ Check existing exception:', e);
          // Continue - treat as not in queue
        }

        if (existing) {
          console.log('✅ Already in queue:', { 
            id: existing.id, 
            status: existing.status, 
            position: existing.queue_position,
            room_id: existing.room_id,
            guestSessionId: existing.guest_session_id,
            userId: existing.user_id
          });
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              message: 'Already in queue',
              position: existing.queue_position,
              status: existing.status,
              alreadyInQueue: true,
            }),
          };
        }
        
        console.log('✅ Not already in queue, proceeding to join');

        // Check queue size limit
        if (room.max_queue_size) {
          try {
            const { count, error: countError } = await supabase
              .from('room_queue')
              .select('*', { count: 'exact', head: true })
              .eq('room_id', roomId)
              .eq('status', 'waiting');

            console.log('📊 Queue count:', count, countError);

            if (!countError && count >= room.max_queue_size) {
              return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Queue is full' }),
              };
            }
          } catch (e) {
            console.error('❌ Queue count exception:', e);
            // Continue - don't block join if count check fails
          }
        }

        // Get next position
        let nextPosition = 1;
        try {
          const { data: lastInQueue, error: posError } = await supabase
            .from('room_queue')
            .select('queue_position')
            .eq('room_id', roomId)
            .eq('status', 'waiting')
            .order('queue_position', { ascending: false })
            .limit(1)
            .single();

          console.log('📍 Last in queue:', lastInQueue, posError);
          nextPosition = (lastInQueue?.queue_position || 0) + 1;
        } catch (e) {
          console.error('❌ Position lookup exception:', e);
          // Default to position 1
        }
        
        console.log('📍 Next position will be:', nextPosition);

        // Add to queue
        const queueEntry = {
          room_id: roomId,
          user_id: userId || null,
          guest_name: guestName || (userId ? userName : 'Guest'),
          guest_session_id: userId ? null : guestSessionId,
          queue_position: nextPosition,
          status: 'waiting',
        };

        console.log('📝 Inserting queue entry:', queueEntry);
        
        let newEntry, insertError;
        try {
          const result = await supabase
            .from('room_queue')
            .insert(queueEntry)
            .select()
            .single();
          newEntry = result.data;
          insertError = result.error;
        } catch (e) {
          console.error('❌ Insert exception:', e);
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
              error: 'Database insert failed', 
              message: e.message,
              queueEntry 
            }),
          };
        }

        console.log('📝 Insert result:', { newEntry, insertError });

        if (insertError) {
          console.log('❌ Insert error:', insertError);
          console.log('❌ Insert error code:', insertError.code);
          console.log('❌ Insert error message:', insertError.message);
          console.log('❌ Insert error details:', insertError.details);
          
          // Handle unique constraint violation - reactivate old entry
          if (insertError.code === '23505') {
            console.log('🔄 Unique constraint violation - looking for old entry to reactivate');
            
            // Find the old entry (any status)
            let oldEntryQuery = supabase
              .from('room_queue')
              .select('*')
              .eq('room_id', roomId);
            
            if (userId) {
              oldEntryQuery = oldEntryQuery.eq('user_id', userId);
            } else {
              oldEntryQuery = oldEntryQuery.eq('guest_session_id', guestSessionId);
            }
            
            const { data: oldEntry, error: oldEntryError } = await oldEntryQuery.single();
            
            console.log('🔍 Old entry lookup:', { oldEntry: oldEntry ? { id: oldEntry.id, status: oldEntry.status, position: oldEntry.queue_position } : null, oldEntryError });
            
            if (oldEntry && (oldEntry.status === 'left' || oldEntry.status === 'completed')) {
              // Reactivate the old entry
              const newPosition = nextPosition; // Use the position we calculated earlier

              const reactivationPayload = {
                status: 'waiting',
                queue_position: newPosition,
                guest_name: guestName || (userId ? userName : 'Guest'),
                joined_at: new Date().toISOString(),
                ended_at: null,
                paid_gems: 0,
                paid_minutes: 0,
                paid_purchased_at: null,
                boost_gems: 0,
                boost_updated_at: null,
                time_limit_seconds: null,
                disconnect_retry_count: 0,
                last_disconnect_at: null,
              };

              let reactivated;
              let reactivateError;
              try {
                const result = await supabase
                  .from('room_queue')
                  .update(reactivationPayload)
                  .eq('id', oldEntry.id)
                  .select()
                  .single();
                reactivated = result.data;
                reactivateError = result.error;
              } catch (e) {
                const result = await supabase
                  .from('room_queue')
                  .update({
                    status: 'waiting',
                    queue_position: newPosition,
                    guest_name: guestName || (userId ? userName : 'Guest'),
                    joined_at: new Date().toISOString(),
                    ended_at: null,
                  })
                  .eq('id', oldEntry.id)
                  .select()
                  .single();
                reactivated = result.data;
                reactivateError = result.error;
              }
              
              console.log('🔄 Reactivated old entry:', { reactivated, reactivateError });
              
              if (!reactivateError && reactivated) {
                return {
                  statusCode: 200,
                  headers,
                  body: JSON.stringify({
                    success: true,
                    position: reactivated.queue_position,
                    queueId: reactivated.id,
                    reactivated: true,
                  }),
                };
              }
            } else if (oldEntry && (oldEntry.status === 'waiting' || oldEntry.status === 'active')) {
              // Entry is already active/waiting
              return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                  success: true,
                  message: 'Already in queue',
                  position: oldEntry.queue_position,
                  status: oldEntry.status,
                  alreadyInQueue: true,
                }),
              };
            }
            
            // Fallback if lookup fails
            return {
              statusCode: 200,
              headers,
              body: JSON.stringify({
                success: true,
                message: 'Already in queue',
                alreadyInQueue: true,
              }),
            };
          }
          
          // Handle table not found
          if (insertError.code === '42P01') {
            return {
              statusCode: 500,
              headers,
              body: JSON.stringify({ 
                error: 'Queue table not found. Please run database migrations.',
                code: insertError.code
              }),
            };
          }
          
          // Handle other errors with more detail
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
              error: 'Failed to join queue',
              message: insertError.message,
              code: insertError.code,
              hint: insertError.hint || null
            }),
          };
        }

        console.log(`✅ User joined queue: ${roomId} at position ${nextPosition}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            position: nextPosition,
            queueId: newEntry.id,
          }),
        };
      }

      case 'boost': {
        const { userId, amount } = body;
        if (!userId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'User ID is required' }),
          };
        }

        const boostAmount = safeInt(amount, 0);
        if (boostAmount < BOOST_MIN_GEMS) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: `Minimum boost is ${BOOST_MIN_GEMS} gems` }),
          };
        }

        const { data: room } = await supabase
          .from('active_rooms')
          .select('host_id, room_type, is_creator_room')
          .eq('room_id', roomId)
          .eq('status', 'live')
          .single();

        if (!room || (room.room_type !== 'creator' && !room.is_creator_room)) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'This room does not have a queue' }),
          };
        }

        if (room.host_id === userId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Host cannot boost their own queue' }),
          };
        }

        const { data: entry } = await supabase
          .from('room_queue')
          .select('*')
          .eq('room_id', roomId)
          .eq('user_id', userId)
          .eq('status', 'waiting')
          .single();

        if (!entry) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'You must be in the queue to boost' }),
          };
        }

        const chargeResult = await applyMonetizedCharge({
          roomId,
          payerId: userId,
          hostId: room.host_id,
          gems: boostAmount,
          transactionType: 'creator_boost',
        });

        if (!chargeResult.ok) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: chargeResult.error, available: chargeResult.available }),
          };
        }

        const now = isoNow();
        const newBoostTotal = safeInt(entry.boost_gems, 0) + boostAmount;
        try {
          await supabase
            .from('room_queue')
            .update({ boost_gems: newBoostTotal, boost_updated_at: now })
            .eq('id', entry.id);
        } catch (e) {
          await supabase
            .from('room_queue')
            .update({ boost_gems: newBoostTotal })
            .eq('id', entry.id);
        }

        await reorderQueue(roomId);

        const { data: updatedEntry } = await supabase
          .from('room_queue')
          .select('queue_position, boost_gems')
          .eq('id', entry.id)
          .single();

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            boostGems: updatedEntry?.boost_gems ?? newBoostTotal,
            position: updatedEntry?.queue_position ?? null,
            senderRemaining: chargeResult.senderRemaining,
          }),
        };
      }

      case 'buy-slot': {
        const { userId, minutes, slotMinutes } = body;
        if (!userId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'User ID is required' }),
          };
        }

        const resolvedSlotMinutes = safeInt(typeof minutes !== 'undefined' ? minutes : slotMinutes, 0);
        if (![5, 10].includes(resolvedSlotMinutes)) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Invalid paid slot minutes' }),
          };
        }

        const { data: room } = await supabase
          .from('active_rooms')
          .select('host_id, room_type, is_creator_room, max_queue_size')
          .eq('room_id', roomId)
          .eq('status', 'live')
          .single();

        if (!room || (room.room_type !== 'creator' && !room.is_creator_room)) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'This room does not have a queue' }),
          };
        }

        if (room.host_id === userId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Host cannot buy a paid slot' }),
          };
        }

        const price = PAID_SLOT_PRICES[resolvedSlotMinutes];

        let entry = null;
        try {
          const { data } = await supabase
            .from('room_queue')
            .select('*')
            .eq('room_id', roomId)
            .eq('user_id', userId)
            .in('status', ['waiting', 'active'])
            .single();
          entry = data;
        } catch (e) {}

        if (entry && entry.status === 'active') {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Cannot buy a slot while you are active' }),
          };
        }

        const existingPaid = entry ? safeInt(entry.paid_gems, 0) : 0;
        const delta = Math.max(0, price - existingPaid);
        if (delta > 0) {
          const chargeResult = await applyMonetizedCharge({
            roomId,
            payerId: userId,
            hostId: room.host_id,
            gems: delta,
            transactionType: 'creator_paid_slot',
          });

          if (!chargeResult.ok) {
            return {
              statusCode: 400,
              headers,
              body: JSON.stringify({ error: chargeResult.error, available: chargeResult.available }),
            };
          }
        }

        const now = isoNow();

        if (!entry) {
          if (room.max_queue_size) {
            try {
              const { count } = await supabase
                .from('room_queue')
                .select('*', { count: 'exact', head: true })
                .eq('room_id', roomId)
                .eq('status', 'waiting');
              if (typeof count === 'number' && count >= room.max_queue_size) {
                return {
                  statusCode: 400,
                  headers,
                  body: JSON.stringify({ error: 'Queue is full' }),
                };
              }
            } catch (e) {}
          }

          const { data: lastInQueue } = await supabase
            .from('room_queue')
            .select('queue_position')
            .eq('room_id', roomId)
            .eq('status', 'waiting')
            .order('queue_position', { ascending: false })
            .limit(1)
            .single();
          const nextPosition = (lastInQueue?.queue_position || 0) + 1;

          const { data: inserted, error: insertError } = await supabase
            .from('room_queue')
            .insert({
              room_id: roomId,
              user_id: userId,
              guest_name: body.userName || 'Guest',
              queue_position: nextPosition,
              status: 'waiting',
              paid_gems: price,
              paid_minutes: resolvedSlotMinutes,
              paid_purchased_at: now,
              time_limit_seconds: resolvedSlotMinutes * 60,
            })
            .select()
            .single();

          if (insertError) throw insertError;
          entry = inserted;
        } else {
          try {
            await supabase
              .from('room_queue')
              .update({
                paid_gems: price,
                paid_minutes: resolvedSlotMinutes,
                paid_purchased_at: now,
                time_limit_seconds: resolvedSlotMinutes * 60,
              })
              .eq('id', entry.id);
          } catch (e) {
            await supabase
              .from('room_queue')
              .update({
                paid_gems: price,
                paid_minutes: resolvedSlotMinutes,
              })
              .eq('id', entry.id);
          }
        }

        await reorderQueue(roomId);

        const { data: updatedEntry } = await supabase
          .from('room_queue')
          .select('queue_position, paid_gems, paid_minutes')
          .eq('id', entry.id)
          .single();

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            position: updatedEntry?.queue_position ?? null,
            paidGems: updatedEntry?.paid_gems ?? price,
            paidMinutes: updatedEntry?.paid_minutes ?? resolvedSlotMinutes,
          }),
        };
      }

      case 'leave': {
        const { userId, guestSessionId, queueId } = body;

        let query = supabase
          .from('room_queue')
          .update({ status: 'left', ended_at: new Date().toISOString() })
          .eq('room_id', roomId);

        if (queueId) {
          query = query.eq('id', queueId);
        } else if (userId) {
          query = query.eq('user_id', userId);
        } else if (guestSessionId) {
          query = query.eq('guest_session_id', guestSessionId);
        } else {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'User identification required' }),
          };
        }

        const { error } = await query;

        if (error) throw error;

        // Reorder remaining queue positions
        await reorderQueue(roomId);

        console.log(`👋 User left queue: ${roomId}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true }),
        };
      }

      case 'next': {
        // Host calls next challenger
        const { hostId } = body;

        // Verify host
        const { data: room, error: roomError } = await supabase
          .from('active_rooms')
          .select('host_id, challenger_time_limit')
          .eq('room_id', roomId)
          .single();

        if (roomError || !room) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Room not found' }),
          };
        }

        if (room.host_id !== hostId) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ error: 'Only the host can call next challenger' }),
          };
        }

        // Get current active challenger before ending them
        const { data: previousChallenger } = await supabase
          .from('room_queue')
          .select('id, user_id, guest_session_id, guest_name')
          .eq('room_id', roomId)
          .eq('status', 'active')
          .single();

        // End current challenger if any
        if (previousChallenger) {
          await supabase
            .from('room_queue')
            .update({ 
              status: 'completed', 
              ended_at: new Date().toISOString() 
            })
            .eq('id', previousChallenger.id);
          
          console.log('👋 Previous challenger ended:', previousChallenger.guest_name || previousChallenger.user_id);
        }

        await reorderQueue(roomId);

        const nextChallenger = await pickNextWaitingEntry(roomId);
        const nextError = nextChallenger ? null : { message: 'no_next' };

        if (nextError || !nextChallenger) {
          // No one in queue
          await supabase
            .from('active_rooms')
            .update({
              current_challenger_id: null,
              current_challenger_name: null,
              current_challenger_started_at: null,
            })
            .eq('room_id', roomId);

          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              message: 'Queue is empty',
              nextChallenger: null,
            }),
          };
        }

        const now = isoNow();
        const limitSeconds =
          safeInt(nextChallenger.time_limit_seconds, 0) ||
          (safeInt(nextChallenger.paid_minutes, 0) > 0 ? safeInt(nextChallenger.paid_minutes, 0) * 60 : 0) ||
          safeInt(room.challenger_time_limit, 0) ||
          DEFAULT_CALL_SECONDS;

        await setActiveQueueEntry(nextChallenger.id, now, limitSeconds);

        await setActiveRoomChallengerFields(roomId, {
          current_challenger_id: nextChallenger.user_id,
          current_challenger_name: nextChallenger.guest_name || 'Challenger',
          current_challenger_started_at: now,
          current_challenger_queue_id: nextChallenger.id,
          current_challenger_time_limit_seconds: limitSeconds,
          current_challenger_expires_at: new Date(Date.now() + limitSeconds * 1000).toISOString(),
        });

        await reorderQueue(roomId);

        console.log(`🎯 Next challenger called: ${roomId} -> ${nextChallenger.guest_name || nextChallenger.user_id}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            nextChallenger: {
              id: nextChallenger.id,
              userId: nextChallenger.user_id,
              guestSessionId: nextChallenger.guest_session_id,
              name: nextChallenger.guest_name || 'Challenger',
              isUser: !!nextChallenger.user_id,
              timeLimit: limitSeconds,
            },
            previousChallenger: previousChallenger ? {
              id: previousChallenger.id,
              userId: previousChallenger.user_id,
              guestSessionId: previousChallenger.guest_session_id,
              name: previousChallenger.guest_name || 'Challenger',
            } : null,
          }),
        };
      }

      case 'done': {
        // Challenger clicks "I'm Done"
        const { userId, guestSessionId } = body;

        // Find and end the active entry
        let query = supabase
          .from('room_queue')
          .update({ 
            status: 'completed', 
            ended_at: new Date().toISOString() 
          })
          .eq('room_id', roomId)
          .eq('status', 'active');

        if (userId) {
          query = query.eq('user_id', userId);
        } else if (guestSessionId) {
          query = query.eq('guest_session_id', guestSessionId);
        }

        const { error } = await query;

        if (error) throw error;

        await setActiveRoomChallengerFields(roomId, {
          current_challenger_id: null,
          current_challenger_name: null,
          current_challenger_started_at: null,
          current_challenger_queue_id: null,
          current_challenger_time_limit_seconds: null,
          current_challenger_expires_at: null,
        });

        console.log(`✅ Challenger finished: ${roomId}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true }),
        };
      }

      case 'clear': {
        // Host clears the entire queue
        const { hostId } = body;

        // Verify host
        const { data: room } = await supabase
          .from('active_rooms')
          .select('host_id')
          .eq('room_id', roomId)
          .single();

        if (!room || room.host_id !== hostId) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ error: 'Only the host can clear the queue' }),
          };
        }

        // Mark all waiting entries as left
        await supabase
          .from('room_queue')
          .update({ 
            status: 'left', 
            ended_at: new Date().toISOString() 
          })
          .eq('room_id', roomId)
          .in('status', ['waiting', 'active']);

        await setActiveRoomChallengerFields(roomId, {
          current_challenger_id: null,
          current_challenger_name: null,
          current_challenger_started_at: null,
          current_challenger_queue_id: null,
          current_challenger_time_limit_seconds: null,
          current_challenger_expires_at: null,
        });

        console.log(`🧹 Queue cleared: ${roomId}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true }),
        };
      }

      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid action' }),
        };
    }

  } catch (error) {
    console.error('❌ Error managing queue:', error);
    console.error('❌ Error details:', JSON.stringify(error, null, 2));
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to manage queue',
        message: error.message,
        code: error.code,
        details: error.details || error.hint || null
      }),
    };
  }
};

// Helper: Reorder queue positions after someone leaves
async function reorderQueue(roomId) {
  try {
    const { data: waitingQueue, error } = await supabase
      .from('room_queue')
      .select('*')
      .eq('room_id', roomId)
      .eq('status', 'waiting')
      .order('queue_position', { ascending: true });

    if (error) {
      console.warn('⚠️ reorderQueue query error:', error.message);
      return;
    }

    if (!waitingQueue || waitingQueue.length === 0) return;

    const sorted = [...waitingQueue].sort(compareQueueEntries);

    // Update positions sequentially
    for (let i = 0; i < sorted.length; i++) {
      await supabase
        .from('room_queue')
        .update({ queue_position: i + 1 })
        .eq('id', sorted[i].id);
    }
  } catch (error) {
    console.error('Error reordering queue:', error);
  }
}
