'use strict';

const crypto = require('crypto');
const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SQUARE_WEBHOOK_SIGNATURE_KEY = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;

const SQUARE_ENVIRONMENT = (process.env.SQUARE_ENVIRONMENT || 'production').toLowerCase();
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID;

function getSquareApiBaseUrl() {
  return SQUARE_ENVIRONMENT === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';
}

function squareRequest({ path, method, body }) {
  return new Promise((resolve, reject) => {
    const baseUrl = getSquareApiBaseUrl();
    const url = `${baseUrl}${path}`;

    if (!SQUARE_ACCESS_TOKEN) {
      reject(new Error('SQUARE_ACCESS_TOKEN not configured'));
      return;
    }

    const normalizedMethod = String(method || 'GET').toUpperCase();
    const canHaveBody = normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD';
    const payload = canHaveBody && body ? JSON.stringify(body) : '';

    if (typeof fetch === 'function') {
      const fetchInit = {
        method: normalizedMethod,
        headers: {
          'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'Square-Version': '2025-10-16',
        },
      };

      if (payload) {
        fetchInit.body = payload;
      }

      fetch(url, fetchInit)
        .then(async (resp) => {
          const data = await resp.json().catch(() => null);
          if (!resp.ok) {
            const message = data?.errors?.[0]?.detail || data?.errors?.[0]?.code || `Square error (${resp.status})`;
            throw new Error(message);
          }
          return data;
        })
        .then(resolve)
        .catch(reject);
      return;
    }

    const req = https.request(
      url,
      {
        method: normalizedMethod,
        headers: {
          'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'Square-Version': '2025-10-16',
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let data = null;
          try {
            data = raw ? JSON.parse(raw) : null;
          } catch (e) {
            reject(e);
            return;
          }
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            const message = data?.errors?.[0]?.detail || data?.errors?.[0]?.code || `Square error (${res.statusCode})`;
            reject(new Error(message));
          }
        });
      }
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function findSquareSubscriptionForCustomer({ customerId, planVariationId }) {
  if (!customerId || !planVariationId) return null;

  const filter = { customer_ids: [customerId] };
  if (SQUARE_LOCATION_ID) {
    filter.location_ids = [SQUARE_LOCATION_ID];
  }

  const resp = await squareRequest({
    path: '/v2/subscriptions/search',
    method: 'POST',
    body: {
      query: {
        filter,
      },
      limit: 50,
    },
  });

  const subs = Array.isArray(resp?.subscriptions) ? resp.subscriptions : [];
  subs.sort((a, b) => {
    const aMs = a?.created_at ? new Date(a.created_at).getTime() : 0;
    const bMs = b?.created_at ? new Date(b.created_at).getTime() : 0;
    return bMs - aMs;
  });
  const candidates = subs.filter((s) => {
    if (!s?.id) return false;
    if (s?.plan_variation_id !== planVariationId) return false;
    const st = String(s?.status || '').toUpperCase();
    return st === 'ACTIVE' || st === 'PAUSED' || st === 'PENDING';
  });

  return candidates[0] || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timingSafeEqual(a, b) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

async function addSubscriptionBonusGemsFromPayment({ userId, amount, squarePaymentId, squareOrderId }) {
  const { data: existingTx, error: existingTxErr } = await supabase
    .from('gem_transactions')
    .select('id')
    .eq('transaction_type', 'subscription_bonus')
    .eq('square_order_id', squareOrderId)
    .limit(1)
    .maybeSingle();

  if (existingTxErr) throw existingTxErr;
  if (existingTx) return;

  const { data: existing } = await supabase
    .from('gem_balances')
    .select('id, spendable_gems')
    .eq('user_id', userId)
    .single();

  if (!existing) {
    const { error: insertError } = await supabase
      .from('gem_balances')
      .insert({
        user_id: userId,
        spendable_gems: amount,
        cashable_gems: 0,
        promo_gems: 0,
      });

    if (insertError) throw insertError;
  } else {
    const newBalance = (existing.spendable_gems || 0) + amount;
    const { error: updateError } = await supabase
      .from('gem_balances')
      .update({
        spendable_gems: newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (updateError) throw updateError;
  }

  const { error: txError } = await supabase
    .from('gem_transactions')
    .insert({
      user_id: userId,
      transaction_type: 'subscription_bonus',
      amount,
      wallet_type: 'spendable',
      description: `Bonus: ${amount} gems`,
      square_payment_id: squarePaymentId,
      square_order_id: squareOrderId,
    });

  if (txError) {
    console.error('❌ Error logging subscription gem transaction:', txError);
  }
}

function verifySquareWebhookSignature({ signatureHeader, requestBody, notificationUrl, signatureKey }) {
  if (!signatureHeader || !signatureKey || !notificationUrl) return false;

  const payload = `${notificationUrl}${requestBody}`;
  const expected = crypto
    .createHmac('sha256', signatureKey)
    .update(payload, 'utf8')
    .digest('base64');

  return timingSafeEqual(expected, signatureHeader);
}

function mapSquareSubscriptionStatus(squareStatus) {
  if (!squareStatus) return 'active';
  const s = String(squareStatus).toUpperCase();
  if (s === 'ACTIVE') return 'active';
  if (s === 'CANCELED' || s === 'CANCELLED' || s === 'DEACTIVATED') return 'canceled';
  if (s === 'PAUSED') return 'past_due';
  return 'active';
}

function parseSquareDateToIso(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

async function vestReferralGemsOnPurchase(purchasingUserId, purchaseType) {
  console.log(`🔓 Checking for referral gems to vest for user ${purchasingUserId} (${purchaseType})...`);

  try {
    const { data: referral, error: findError } = await supabase
      .from('referrals')
      .select('*')
      .eq('referred_user_id', purchasingUserId)
      .eq('status', 'rewarded')
      .eq('vested', false)
      .single();

    if (findError || !referral) {
      console.log('No unvested referral found for this user');
      return;
    }

    const referrerId = referral.referrer_user_id;
    const gemsToVest = referral.gems_awarded_referrer || 0;

    if (gemsToVest <= 0) {
      console.log('No gems to vest');
      return;
    }

    console.log(`🎉 Found referral! Vesting ${gemsToVest} gems for referrer ${referrerId}`);

    const { data: balance, error: balanceError } = await supabase
      .from('gem_balances')
      .select('*')
      .eq('user_id', referrerId)
      .single();

    if (balanceError || !balance) {
      console.error('Could not find referrer balance');
      return;
    }

    const newPending = Math.max(0, (balance.pending_referral_gems || 0) - gemsToVest);
    const newCashable = (balance.cashable_gems || 0) + gemsToVest;

    const { error: updateError } = await supabase
      .from('gem_balances')
      .update({
        pending_referral_gems: newPending,
        cashable_gems: newCashable,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', referrerId);

    if (updateError) {
      console.error('Error updating referrer balance:', updateError);
      return;
    }

    await supabase
      .from('referrals')
      .update({
        vested: true,
        vested_at: new Date().toISOString(),
        vested_reason: `Referred user made ${purchaseType}`,
      })
      .eq('id', referral.id);

    await supabase
      .from('gem_transactions')
      .insert({
        user_id: referrerId,
        transaction_type: 'vest',
        amount: gemsToVest,
        wallet_type: 'cashable',
        description: `Referral gems vested: referred user made ${purchaseType}`,
      });

    console.log(`✅ Vested ${gemsToVest} gems for referrer ${referrerId}!`);
  } catch (error) {
    console.error('Error in vestReferralGemsOnPurchase:', error);
  }
}

async function addPurchasedGems({ userId, gems, packName, squarePaymentId, squareOrderId }) {
  const { data: existing } = await supabase
    .from('gem_balances')
    .select('id, spendable_gems')
    .eq('user_id', userId)
    .single();

  if (!existing) {
    const { error: insertError } = await supabase
      .from('gem_balances')
      .insert({
        user_id: userId,
        spendable_gems: gems,
        cashable_gems: 0,
        promo_gems: 0,
      });

    if (insertError) {
      throw insertError;
    }
  } else {
    const newBalance = (existing.spendable_gems || 0) + gems;
    const { error: updateError } = await supabase
      .from('gem_balances')
      .update({
        spendable_gems: newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (updateError) {
      throw updateError;
    }
  }

  const { error: txError } = await supabase
    .from('gem_transactions')
    .insert({
      user_id: userId,
      transaction_type: 'purchase',
      amount: gems,
      wallet_type: 'spendable',
      description: `Purchased: ${packName} (${gems} gems)`,
      square_payment_id: squarePaymentId,
      square_order_id: squareOrderId,
    });

  if (txError) {
    console.error('❌ Error logging gem transaction:', txError);
  }
}

async function addSubscriptionBonusGems({ userId, amount, squareInvoiceId, squareSubscriptionId }) {
  const { data: existing } = await supabase
    .from('gem_balances')
    .select('id, spendable_gems')
    .eq('user_id', userId)
    .single();

  if (!existing) {
    const { error: insertError } = await supabase
      .from('gem_balances')
      .insert({
        user_id: userId,
        spendable_gems: amount,
        cashable_gems: 0,
        promo_gems: 0,
      });

    if (insertError) throw insertError;
  } else {
    const newBalance = (existing.spendable_gems || 0) + amount;
    const { error: updateError } = await supabase
      .from('gem_balances')
      .update({
        spendable_gems: newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (updateError) throw updateError;
  }

  const { error: txError } = await supabase
    .from('gem_transactions')
    .insert({
      user_id: userId,
      transaction_type: 'subscription_bonus',
      amount,
      wallet_type: 'spendable',
      description: `Bonus: ${amount} gems`,
      square_invoice_id: squareInvoiceId,
      square_subscription_id: squareSubscriptionId,
    });

  if (txError) {
    console.error('❌ Error logging subscription gem transaction:', txError);
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  if (!SQUARE_WEBHOOK_SIGNATURE_KEY) {
    console.error('❌ SQUARE_WEBHOOK_SIGNATURE_KEY not configured');
    return { statusCode: 500, body: 'Webhook not configured' };
  }

  const signature =
    event.headers['x-square-hmacsha256-signature'] ||
    event.headers['X-Square-HmacSha256-Signature'] ||
    event.headers['X-SQUARE-HMACSHA256-SIGNATURE'];

  const notificationUrl =
    process.env.SQUARE_WEBHOOK_NOTIFICATION_URL ||
    `${process.env.URL || 'https://tivoq.com'}/.netlify/functions/square-webhook`;

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  const isValid = verifySquareWebhookSignature({
    signatureHeader: signature,
    requestBody: rawBody,
    notificationUrl,
    signatureKey: SQUARE_WEBHOOK_SIGNATURE_KEY,
  });

  if (!isValid) {
    console.error('❌ Invalid Square webhook signature');
    return { statusCode: 403, body: 'Invalid signature' };
  }

  let squareEvent;
  try {
    squareEvent = JSON.parse(rawBody);
  } catch (e) {
    console.error('❌ Failed to parse Square webhook body');
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const eventId = squareEvent.event_id;
  const eventType = squareEvent.type;

  if (!eventId || !eventType) {
    return { statusCode: 400, body: 'Missing event id/type' };
  }

  const { data: existingEvent, error: existingEventError } = await supabase
    .from('square_events')
    .select('id')
    .eq('id', eventId)
    .maybeSingle();

  if (existingEventError) {
    throw existingEventError;
  }

  if (existingEvent) {
    return { statusCode: 200, body: JSON.stringify({ received: true, duplicate: true }) };
  }

  try {
    if (eventType === 'payment.created' || eventType === 'payment.updated') {
      const payment = squareEvent?.data?.object?.payment;
      const paymentId = payment?.id;
      const orderId = payment?.order_id;
      const paymentCustomerId = payment?.customer_id;
      const status = payment?.status;

      if (!paymentId || !orderId) {
        console.log('Square payment event missing payment/order id');
      } else if (status !== 'COMPLETED' && status !== 'APPROVED') {
        console.log(`Square payment ${paymentId} status=${status}; skipping`);
      } else {
        const { data: existingTx, error: existingTxError } = await supabase
          .from('gem_transactions')
          .select('id')
          .or(`square_payment_id.eq.${paymentId},square_order_id.eq.${orderId}`)
          .limit(1)
          .maybeSingle();

        if (existingTxError) throw existingTxError;

        const { data: pendingGem, error: pendingGemError } = await supabase
          .from('square_pending_gem_purchases')
          .select('*')
          .eq('square_order_id', orderId)
          .maybeSingle();

        if (pendingGemError) throw pendingGemError;

        if (pendingGem) {
          if (pendingGem.status === 'fulfilled') {
            console.log(`Pending purchase already fulfilled for order ${orderId}`);
          } else if (status !== 'COMPLETED') {
            console.log(`Square gem purchase payment ${paymentId} status=${status}; waiting for COMPLETED`);
          } else if (!existingTx) {
            const packName = pendingGem.gem_pack_key || 'Gem Pack';

            await addPurchasedGems({
              userId: pendingGem.user_id,
              gems: pendingGem.gems,
              packName,
              squarePaymentId: paymentId,
              squareOrderId: orderId,
            });

            await supabase
              .from('square_pending_gem_purchases')
              .update({
                status: 'fulfilled',
                square_payment_id: paymentId,
                fulfilled_at: new Date().toISOString(),
              })
              .eq('id', pendingGem.id);

            await vestReferralGemsOnPurchase(pendingGem.user_id, 'gem_purchase');
          }
        } else {
          const { data: pendingSub, error: pendingSubError } = await supabase
            .from('square_pending_subscriptions')
            .select('*')
            .eq('square_order_id', orderId)
            .maybeSingle();

          if (pendingSubError) throw pendingSubError;

          if (!pendingSub) {
            console.log(`No pending Square order found for order ${orderId}`);
          } else {
            const nowIso = new Date().toISOString();
            let bonus = 0;
            if (pendingSub.plan_type === 'ad_free_premium' || pendingSub.plan_type === 'pro_bundle') bonus = 1200;
            else if (pendingSub.plan_type === 'ad_free_plus') bonus = 500;

            console.log('✅ Activating Square subscription from payment event', {
              userId: pendingSub.user_id,
              planType: pendingSub.plan_type,
              billingPeriod: pendingSub.billing_period,
              orderId,
              paymentId,
              status,
            });

            let resolvedSubscriptionId = pendingSub.square_subscription_id || null;
            let resolvedSquareSubscriptionStatus = null;
            if (!resolvedSubscriptionId && paymentCustomerId && pendingSub.square_plan_variation_id) {
              for (let attempt = 1; attempt <= 3; attempt++) {
                const sub = await findSquareSubscriptionForCustomer({
                  customerId: paymentCustomerId,
                  planVariationId: pendingSub.square_plan_variation_id,
                }).catch((e) => {
                  console.error('❌ Square subscription search failed after payment', {
                    orderId,
                    paymentId,
                    attempt,
                    message: e?.message || String(e),
                  });
                  return null;
                });

                resolvedSubscriptionId = sub?.id || null;
                resolvedSquareSubscriptionStatus = sub?.status || null;

                console.log('🔎 Square subscription resolve after payment', {
                  orderId,
                  paymentId,
                  attempt,
                  hasCustomerId: Boolean(paymentCustomerId),
                  planVariationId: pendingSub.square_plan_variation_id,
                  found: Boolean(resolvedSubscriptionId),
                });

                if (resolvedSubscriptionId) break;
                if (attempt < 3) await sleep(750);
              }
            }

            let existingSquareSubscriptionId = null;
            let existingSquareSubscriptionStatus = null;
            const { data: existingUserSubForUser } = await supabase
              .from('user_subscriptions')
              .select('square_subscription_id, square_subscription_status')
              .eq('user_id', pendingSub.user_id)
              .maybeSingle();

            if (existingUserSubForUser?.square_subscription_id) {
              existingSquareSubscriptionId = existingUserSubForUser.square_subscription_id;
            }
            if (existingUserSubForUser?.square_subscription_status) {
              existingSquareSubscriptionStatus = existingUserSubForUser.square_subscription_status;
            }

            const finalSquareSubscriptionId = resolvedSubscriptionId || existingSquareSubscriptionId;
            const finalSquareSubscriptionStatus = resolvedSquareSubscriptionStatus || existingSquareSubscriptionStatus;

            if (!finalSquareSubscriptionId) {
              console.log('⚠️ Square subscription checkout payment completed but no subscription id was found; not activating user subscription', {
                userId: pendingSub.user_id,
                orderId,
                paymentId,
                hasCustomerId: Boolean(paymentCustomerId),
                planVariationId: pendingSub.square_plan_variation_id,
                status,
              });
              return;
            }

            const { error: subUpsertErr } = await supabase
              .from('user_subscriptions')
              .upsert({
                user_id: pendingSub.user_id,
                square_customer_id: paymentCustomerId || null,
                square_subscription_id: finalSquareSubscriptionId,
                square_plan_variation_id: pendingSub.square_plan_variation_id,
                square_subscription_status: finalSquareSubscriptionStatus,
                plan_type: pendingSub.plan_type,
                billing_period: pendingSub.billing_period,
                status: 'active',
                updated_at: nowIso,
              }, { onConflict: 'user_id' });

            if (subUpsertErr) throw subUpsertErr;

            await supabase
              .from('square_pending_subscriptions')
              .update({
                status: 'activated',
                square_subscription_id: resolvedSubscriptionId,
                activated_at: nowIso,
              })
              .eq('id', pendingSub.id);

            if (status === 'COMPLETED' && !existingTx) {
              if (bonus > 0) {
                await addSubscriptionBonusGemsFromPayment({
                  userId: pendingSub.user_id,
                  amount: bonus,
                  squarePaymentId: paymentId,
                  squareOrderId: orderId,
                });

                console.log('✅ Granted subscription bonus gems from payment', {
                  userId: pendingSub.user_id,
                  orderId,
                  amount: bonus,
                });
              }

              await vestReferralGemsOnPurchase(pendingSub.user_id, 'subscription');
            }
          }
        }
      }
    }

    if (eventType === 'subscription.created' || eventType === 'subscription.updated') {
      const subscription = squareEvent?.data?.object?.subscription;
      const subscriptionId = subscription?.id;
      const customerId = subscription?.customer_id;
      const squareStatus = subscription?.status;
      const planVariationId = subscription?.plan_variation_id;
      const status = mapSquareSubscriptionStatus(squareStatus);

      if (!subscriptionId) {
        console.log('Square subscription event missing subscription id');
      } else {
        const update = {
          square_customer_id: customerId || null,
          square_subscription_id: subscriptionId,
          square_plan_variation_id: planVariationId || null,
          square_subscription_status: squareStatus || null,
          status,
          updated_at: new Date().toISOString(),
        };

        const chargedThroughIso = parseSquareDateToIso(subscription?.charged_through_date);
        if (chargedThroughIso) {
          update.current_period_end = chargedThroughIso;
        }

        const canceledIso = parseSquareDateToIso(subscription?.canceled_date);
        if (canceledIso) {
          update.canceled_at = canceledIso;
        }

        let targetUserId = null;
        const { data: existingUserSub } = await supabase
          .from('user_subscriptions')
          .select('user_id')
          .eq('square_subscription_id', subscriptionId)
          .maybeSingle();

        if (existingUserSub?.user_id) {
          targetUserId = existingUserSub.user_id;
        }

        if (!targetUserId && customerId) {
          const { data: byCustomer, error: byCustomerErr } = await supabase
            .from('user_subscriptions')
            .select('user_id')
            .eq('square_customer_id', customerId)
            .limit(2);

          if (byCustomerErr) throw byCustomerErr;
          if (Array.isArray(byCustomer) && byCustomer.length === 1) {
            targetUserId = byCustomer[0].user_id;
          } else if (Array.isArray(byCustomer) && byCustomer.length > 1) {
            console.log(`Multiple user_subscriptions rows found for square_customer_id=${customerId}; not linking subscription_id=${subscriptionId}`);
          }
        }

        if (!targetUserId && planVariationId) {
          const cutoffIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
          const { data: candidates, error: candidatesErr } = await supabase
            .from('user_subscriptions')
            .select('user_id')
            .is('square_subscription_id', null)
            .eq('square_plan_variation_id', planVariationId)
            .neq('plan_type', 'free')
            .gte('updated_at', cutoffIso)
            .limit(2);

          if (candidatesErr) throw candidatesErr;
          if (Array.isArray(candidates) && candidates.length === 1) {
            targetUserId = candidates[0].user_id;
          } else if (Array.isArray(candidates) && candidates.length > 1) {
            console.log(`Multiple candidate user_subscriptions rows found for plan_variation_id=${planVariationId}; not linking subscription_id=${subscriptionId}`);
          }
        }

        let pendingMatch = null;
        if (!targetUserId && planVariationId) {
          const cutoffIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
          const { data: pendingCandidates, error: pendingCandidatesErr } = await supabase
            .from('square_pending_subscriptions')
            .select('id, user_id, plan_type, billing_period, created_at')
            .eq('square_plan_variation_id', planVariationId)
            .in('status', ['pending', 'activated'])
            .gte('created_at', cutoffIso)
            .order('created_at', { ascending: false })
            .limit(2);

          if (pendingCandidatesErr) throw pendingCandidatesErr;

          if (Array.isArray(pendingCandidates) && pendingCandidates.length === 1) {
            pendingMatch = pendingCandidates[0];
            targetUserId = pendingMatch.user_id;
          } else if (Array.isArray(pendingCandidates) && pendingCandidates.length > 1) {
            console.log(`Multiple pending Square subscriptions found for plan_variation_id=${planVariationId}; not linking subscription_id=${subscriptionId}`);
          }
        }

        if (!targetUserId) {
          console.log(`No user_subscriptions row found yet for square_subscription_id=${subscriptionId}; will link on invoice.payment_made`);
        } else {
          if (pendingMatch?.plan_type) update.plan_type = pendingMatch.plan_type;
          if (pendingMatch?.billing_period) update.billing_period = pendingMatch.billing_period;
          const { error: upErr } = await supabase
            .from('user_subscriptions')
            .upsert({
              user_id: targetUserId,
              ...update,
            }, { onConflict: 'user_id' });

          if (upErr) throw upErr;

          if (pendingMatch?.id) {
            await supabase
              .from('square_pending_subscriptions')
              .update({
                status: 'activated',
                square_subscription_id: subscriptionId,
                activated_at: new Date().toISOString(),
              })
              .eq('id', pendingMatch.id);
          }
        }
      }
    }

    if (eventType === 'invoice.payment_made') {
      const invoice = squareEvent?.data?.object?.invoice;
      const invoiceId = invoice?.id;
      const orderId = invoice?.order_id;
      const subscriptionId = invoice?.subscription_id;
      const customerId = invoice?.primary_recipient?.customer_id;
      const invoiceStatus = invoice?.status;

      if (!invoiceId) {
        console.log('Square invoice.payment_made missing invoice id');
      } else if (invoiceStatus && String(invoiceStatus).toUpperCase() !== 'PAID') {
        console.log(`Square invoice ${invoiceId} status=${invoiceStatus}; skipping`);
      } else if (!subscriptionId) {
        console.log(`Square invoice ${invoiceId} has no subscription_id; skipping`);
      } else {
        const { data: existingTx, error: existingTxErr } = await supabase
          .from('gem_transactions')
          .select('id')
          .eq('square_invoice_id', invoiceId)
          .maybeSingle();

        if (existingTxErr) throw existingTxErr;

        let alreadyBonused = Boolean(existingTx);
        if (!alreadyBonused && orderId) {
          const { data: existingOrderBonus, error: existingOrderBonusErr } = await supabase
            .from('gem_transactions')
            .select('id')
            .eq('transaction_type', 'subscription_bonus')
            .eq('square_order_id', orderId)
            .limit(1)
            .maybeSingle();

          if (existingOrderBonusErr) throw existingOrderBonusErr;
          if (existingOrderBonus) alreadyBonused = true;
        }

        let userId = null;
        let planType = null;
        let billingPeriod = null;
        let squarePlanVariationId = null;

        const { data: userSubBySub } = await supabase
          .from('user_subscriptions')
          .select('user_id, plan_type, billing_period')
          .eq('square_subscription_id', subscriptionId)
          .maybeSingle();

        if (userSubBySub?.user_id) {
          userId = userSubBySub.user_id;
          planType = userSubBySub.plan_type;
          billingPeriod = userSubBySub.billing_period;
        } else if (orderId) {
          const { data: pending } = await supabase
            .from('square_pending_subscriptions')
            .select('*')
            .eq('square_order_id', orderId)
            .maybeSingle();

          if (pending?.user_id) {
            userId = pending.user_id;
            planType = pending.plan_type;
            billingPeriod = pending.billing_period;
            squarePlanVariationId = pending.square_plan_variation_id;

            await supabase
              .from('square_pending_subscriptions')
              .update({
                status: 'activated',
                square_subscription_id: subscriptionId || pending.square_subscription_id || null,
                activated_at: new Date().toISOString(),
              })
              .eq('id', pending.id);
          }
        } else if (subscriptionId) {
          const { data: pendingBySub, error: pendingBySubErr } = await supabase
            .from('square_pending_subscriptions')
            .select('*')
            .eq('square_subscription_id', subscriptionId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (pendingBySubErr) throw pendingBySubErr;

          if (pendingBySub?.user_id) {
            userId = pendingBySub.user_id;
            planType = pendingBySub.plan_type;
            billingPeriod = pendingBySub.billing_period;
            squarePlanVariationId = pendingBySub.square_plan_variation_id;
          } else {
            let subPlanVarId = null;
            try {
              const subResp = await squareRequest({
                path: `/v2/subscriptions/${encodeURIComponent(subscriptionId)}`,
                method: 'GET',
              });
              subPlanVarId = subResp?.subscription?.plan_variation_id || null;
            } catch (e) {
              console.error('❌ Failed to retrieve Square subscription during invoice link', {
                invoiceId,
                subscriptionId,
                message: e?.message || String(e),
              });
            }

            if (subPlanVarId) {
              const cutoffIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
              const { data: pendingByPlanVar, error: pendingByPlanVarErr } = await supabase
                .from('square_pending_subscriptions')
                .select('*')
                .eq('square_plan_variation_id', subPlanVarId)
                .in('status', ['pending', 'activated'])
                .is('square_subscription_id', null)
                .gte('created_at', cutoffIso)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

              if (pendingByPlanVarErr) throw pendingByPlanVarErr;
              if (pendingByPlanVar?.user_id) {
                userId = pendingByPlanVar.user_id;
                planType = pendingByPlanVar.plan_type;
                billingPeriod = pendingByPlanVar.billing_period;
                squarePlanVariationId = pendingByPlanVar.square_plan_variation_id;

                await supabase
                  .from('square_pending_subscriptions')
                  .update({
                    status: 'activated',
                    square_subscription_id: subscriptionId,
                    activated_at: new Date().toISOString(),
                  })
                  .eq('id', pendingByPlanVar.id);
              }
            }
          }
        }

        if (!userId) {
          console.log(`Could not link invoice ${invoiceId} to a user (order_id=${orderId}, subscription_id=${subscriptionId})`);
        } else {
          const nowIso = new Date().toISOString();

          if (!squarePlanVariationId && subscriptionId) {
            const { data: subResp } = await supabase
              .from('user_subscriptions')
              .select('square_plan_variation_id')
              .eq('user_id', userId)
              .maybeSingle();
            squarePlanVariationId = subResp?.square_plan_variation_id || null;
          }

          const { error: subUpsertErr } = await supabase
            .from('user_subscriptions')
            .upsert({
              user_id: userId,
              square_customer_id: customerId || null,
              square_subscription_id: subscriptionId || null,
              square_plan_variation_id: squarePlanVariationId,
              plan_type: planType || 'free',
              billing_period: billingPeriod,
              status: 'active',
              updated_at: nowIso,
            }, { onConflict: 'user_id' });

          if (subUpsertErr) throw subUpsertErr;

          if (!alreadyBonused) {
            let bonus = 0;
            if (planType === 'ad_free_premium' || planType === 'pro_bundle') bonus = 1200;
            else if (planType === 'ad_free_plus') bonus = 500;

            if (bonus > 0) {
              await addSubscriptionBonusGems({
                userId,
                amount: bonus,
                squareInvoiceId: invoiceId,
                squareSubscriptionId: subscriptionId,
              });
            }

            await vestReferralGemsOnPurchase(userId, 'subscription');
          }
        }
      }
    }

    await supabase.from('square_events').insert({ id: eventId, event_type: eventType });

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (error) {
    console.error(`❌ Error processing Square event ${eventType}:`, error);
    return { statusCode: 500, body: 'Webhook handler error' };
  }
};
