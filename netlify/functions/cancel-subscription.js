'use strict';

const https = require('https');
const stripeFactory = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const SQUARE_ENVIRONMENT = (process.env.SQUARE_ENVIRONMENT || 'production').toLowerCase();
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID;

function getSquareApiBaseUrl() {
  return SQUARE_ENVIRONMENT === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';
}

async function lookupSquareCustomerIdsByEmail(email) {
  if (!email) return [];
  const needle = String(email).trim();

  const doSearch = async (mode) => {
    const resp = await squareRequest({
      path: '/v2/customers/search',
      method: 'POST',
      body: {
        query: {
          filter: {
            email_address: {
              [mode]: needle,
            },
          },
        },
        limit: 20,
      },
    });
    const customers = Array.isArray(resp?.customers) ? resp.customers : [];
    return customers.map((c) => c?.id).filter(Boolean);
  };

  let ids = [];
  try {
    ids = await doSearch('exact');
  } catch (_) {
    ids = [];
  }

  if (!ids.length) {
    try {
      ids = await doSearch('fuzzy');
    } catch (_) {
      ids = [];
    }
  }

  return Array.from(new Set(ids));
}

async function listSquareSubscriptionsForCustomer({ customerId }) {
  if (!customerId) return [];
  const doSearch = async (includeLocation) => {
    const body = {
      query: {
        filter: {
          customer_ids: [String(customerId)],
          ...(includeLocation && SQUARE_LOCATION_ID ? { location_ids: [String(SQUARE_LOCATION_ID)] } : {}),
        },
      },
      limit: 100,
    };

    const resp = await squareRequest({
      path: '/v2/subscriptions/search',
      method: 'POST',
      body,
    });

    return Array.isArray(resp?.subscriptions) ? resp.subscriptions : [];
  };

  const primary = await doSearch(true);
  if (primary.length) return primary;
  if (SQUARE_LOCATION_ID) return await doSearch(false);
  return primary;
}

function pickBestSquareSubscription({ subs, planVariationId }) {
  const list = Array.isArray(subs) ? subs : [];
  if (!list.length) return null;
  const withPlan = planVariationId
    ? list.filter((s) => String(s?.plan_variation_id || '') === String(planVariationId))
    : list;
  const candidates = withPlan.length ? withPlan : list;
  const active = candidates.find((s) => String(s?.status || '').toUpperCase() === 'ACTIVE');
  if (active) return active;
  const paused = candidates.find((s) => String(s?.status || '').toUpperCase() === 'PAUSED');
  return paused || null;
}

async function getSquareCustomerIdFromOrder(orderId) {
  if (!orderId) return null;
  const resp = await squareRequest({
    path: `/v2/orders/${encodeURIComponent(orderId)}`,
    method: 'GET',
  });

  const direct = resp?.order?.customer_id || null;
  if (direct) return direct;

  const tenders = Array.isArray(resp?.order?.tenders) ? resp.order.tenders : [];
  const tenderPaymentId = tenders.find((t) => t?.payment_id)?.payment_id || null;
  if (!tenderPaymentId) return null;

  const fromPayment = await getSquareCustomerIdFromPayment(tenderPaymentId).catch(() => null);
  return fromPayment || null;
}

async function getSquareCustomerIdFromPayment(paymentId) {
  if (!paymentId) return null;
  const resp = await squareRequest({
    path: `/v2/payments/${encodeURIComponent(paymentId)}`,
    method: 'GET',
  });
  return resp?.payment?.customer_id || null;
}

async function retrieveSquareCustomer(customerId) {
  if (!customerId) return null;
  const resp = await squareRequest({
    path: `/v2/customers/${encodeURIComponent(customerId)}`,
    method: 'GET',
  });
  return resp?.customer || null;
}

async function searchSquareSubscriptionsPage({ cursor, includeLocation }) {
  const body = {
    ...(cursor ? { cursor } : {}),
    limit: 100,
    query: {
      filter: {
        ...(includeLocation && SQUARE_LOCATION_ID ? { location_ids: [String(SQUARE_LOCATION_ID)] } : {}),
      },
    },
  };

  return await squareRequest({
    path: '/v2/subscriptions/search',
    method: 'POST',
    body,
  });
}

async function findSquareSubscriptionByCustomerEmail({ email, planVariationId }) {
  if (!email) return null;
  const needle = String(email).trim().toLowerCase();

  const matches = [];
  let cursor = null;

  const trySearch = async (includeLocation) => {
    cursor = null;
    for (let i = 0; i < 10; i++) {
      const resp = await searchSquareSubscriptionsPage({ cursor, includeLocation });
      const subs = Array.isArray(resp?.subscriptions) ? resp.subscriptions : [];

      for (const sub of subs) {
        if (!sub?.id || !sub?.customer_id) continue;
        const st = String(sub?.status || '').toUpperCase();
        if (st !== 'ACTIVE' && st !== 'PAUSED') continue;
        if (planVariationId && String(sub?.plan_variation_id || '') !== String(planVariationId)) continue;

        const customer = await retrieveSquareCustomer(sub.customer_id).catch(() => null);
        const customerEmail = String(customer?.email_address || '').trim().toLowerCase();
        if (customerEmail && customerEmail === needle) {
          matches.push({ subscriptionId: sub.id, customerId: sub.customer_id });
          if (matches.length > 1) return;
        }
      }

      cursor = resp?.cursor || null;
      if (!cursor) break;
    }
  };

  await trySearch(true);
  if (!matches.length && SQUARE_LOCATION_ID) {
    await trySearch(false);
  }

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error('Multiple active Square subscriptions matched your email. Please contact support.');
  }
  return null;
}

async function findSquareSubscriptionIdFromLatestInvoiceByCustomerId({ customerId }) {
  if (!customerId) return null;
  if (!SQUARE_LOCATION_ID) return null;

  let cursor = null;
  for (let i = 0; i < 5; i++) {
    const resp = await squareRequest({
      path: '/v2/invoices/search',
      method: 'POST',
      body: {
        query: {
          filter: {
            location_ids: [String(SQUARE_LOCATION_ID)],
            customer_ids: [String(customerId)],
          },
          sort: {
            field: 'INVOICE_SORT_DATE',
            order: 'DESC',
          },
        },
        limit: 200,
        ...(cursor ? { cursor } : {}),
      },
    });

    const invoices = Array.isArray(resp?.invoices) ? resp.invoices : [];
    const hit = invoices.find((inv) => Boolean(inv?.subscription_id));
    const subId = hit?.subscription_id || null;
    if (subId) {
      return {
        subscriptionId: subId,
        customerId: hit?.primary_recipient?.customer_id || String(customerId),
      };
    }

    cursor = resp?.cursor || null;
    if (!cursor) break;
  }

  return null;
}

async function findSquareSubscriptionIdFromInvoiceByOrderId({ orderId }) {
  if (!orderId) return null;
  if (!SQUARE_LOCATION_ID) return null;

  let cursor = null;
  for (let i = 0; i < 5; i++) {
    const resp = await squareRequest({
      path: '/v2/invoices/search',
      method: 'POST',
      body: {
        query: {
          filter: {
            location_ids: [String(SQUARE_LOCATION_ID)],
          },
          sort: {
            field: 'INVOICE_SORT_DATE',
            order: 'DESC',
          },
        },
        limit: 200,
        ...(cursor ? { cursor } : {}),
      },
    });

    const invoices = Array.isArray(resp?.invoices) ? resp.invoices : [];
    const hit = invoices.find((inv) => String(inv?.order_id || '') === String(orderId));
    const subId = hit?.subscription_id || null;
    if (subId) {
      return {
        subscriptionId: subId,
        customerId: hit?.primary_recipient?.customer_id || null,
      };
    }

    cursor = resp?.cursor || null;
    if (!cursor) break;
  }

  return null;
}

async function getSquareCustomerIdFromLatestSubscriptionBonusPayment({ userId }) {
  const q = supabaseAdmin
    .from('gem_transactions')
    .select('square_payment_id, created_at')
    .eq('user_id', userId)
    .eq('transaction_type', 'subscription_bonus')
    .not('square_payment_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5);

  const { data, error } = await q;
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  for (const row of rows) {
    if (!row?.square_payment_id) continue;
    const cid = await getSquareCustomerIdFromPayment(row.square_payment_id).catch(() => null);
    if (cid) return cid;
  }
  return null;
}

async function getSquareCustomerIdFromLatestSubscriptionBonusOrder({ userId, planVariationId }) {
  const q = supabaseAdmin
    .from('gem_transactions')
    .select('square_order_id, created_at')
    .eq('user_id', userId)
    .eq('transaction_type', 'subscription_bonus')
    .not('square_order_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5);

  const { data, error } = await q;
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  for (const row of rows) {
    if (!row?.square_order_id) continue;
    const cid = await getSquareCustomerIdFromOrder(row.square_order_id).catch(() => null);
    if (cid) return cid;
  }
  return null;
}

function squareRequest({ path, method, body }) {
  return new Promise((resolve, reject) => {
    const baseUrl = getSquareApiBaseUrl();
    const url = `${baseUrl}${path}`;

    if (!SQUARE_ACCESS_TOKEN) {
      reject(new Error('SQUARE_ACCESS_TOKEN not configured'));
      return;
    }

    const payload = body ? JSON.stringify(body) : '';

    if (typeof fetch === 'function') {
      fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'Square-Version': '2025-10-16',
        },
        body: payload || undefined,
      })
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
        method,
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

function parseSquareDateToIso(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function getBearerToken(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization;
  if (!auth) return null;
  const parts = String(auth).split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') return parts[1];
  return null;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const token = getBearerToken(event);
    if (!token) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Authentication required' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const { userId, cancelAtPeriodEnd = true } = body;

    if (!userId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'userId is required' }) };
    }

    const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !authData?.user) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };
    }

    if (authData.user.id !== userId) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };
    }

    const { data: subscription, error: subErr } = await supabaseAdmin
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (subErr) throw subErr;
    if (!subscription) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'No subscription found' }) };
    }

    const nowIso = new Date().toISOString();

    if (subscription.stripe_subscription_id) {
      const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
      if (!STRIPE_SECRET_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Stripe not configured' }) };
      }

      const stripe = stripeFactory(STRIPE_SECRET_KEY);

      let stripeSub;
      if (cancelAtPeriodEnd) {
        stripeSub = await stripe.subscriptions.update(subscription.stripe_subscription_id, {
          cancel_at_period_end: true,
        });
      } else {
        stripeSub = await stripe.subscriptions.del(subscription.stripe_subscription_id);
      }

      const cancelAtIso = stripeSub?.cancel_at ? new Date(stripeSub.cancel_at * 1000).toISOString() : null;
      const canceledAtIso = stripeSub?.canceled_at ? new Date(stripeSub.canceled_at * 1000).toISOString() : null;

      const newCurrentPeriodEnd = stripeSub?.current_period_end
        ? new Date(stripeSub.current_period_end * 1000).toISOString()
        : subscription.current_period_end || null;

      const newStatus = String(stripeSub?.status || subscription.status || 'active');
      const plannedCancelIso = cancelAtIso || canceledAtIso || nowIso;

      const update = {
        status: newStatus,
        canceled_at: plannedCancelIso,
        current_period_end: newCurrentPeriodEnd,
        updated_at: nowIso,
      };

      if (!cancelAtPeriodEnd && (newStatus === 'canceled' || newStatus === 'cancelled')) {
        update.plan_type = 'free';
      }

      const { error: updateErr } = await supabaseAdmin
        .from('user_subscriptions')
        .update(update)
        .eq('user_id', userId);

      if (updateErr) throw updateErr;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          provider: 'stripe',
          status: newStatus,
          canceledAt: plannedCancelIso,
        }),
      };
    }

    if (subscription.square_subscription_id || subscription.square_customer_id || authData?.user?.email) {
      let squareCustomerId = subscription.square_customer_id || null;
      let squareSubId = subscription.square_subscription_id || null;
      let pendingOrderId = null;

      const candidateCustomerIds = [];
      if (squareCustomerId) candidateCustomerIds.push(squareCustomerId);

      if (authData?.user?.email) {
        try {
          const emailCustomerIds = await lookupSquareCustomerIdsByEmail(authData.user.email);
          console.log('🔎 Square email customer lookup', {
            userId,
            foundCustomerIds: emailCustomerIds.length,
          });
          for (const cid of emailCustomerIds) candidateCustomerIds.push(cid);
        } catch (e) {
          console.error('❌ Failed to lookup Square customer by email', e);
        }
      }

      if (!squareSubId) {
        try {
          let pendingQuery = supabaseAdmin
            .from('square_pending_subscriptions')
            .select('square_order_id, square_subscription_id, square_plan_variation_id, status, created_at')
            .eq('user_id', userId);

          if (subscription.square_plan_variation_id) {
            pendingQuery = pendingQuery.eq('square_plan_variation_id', subscription.square_plan_variation_id);
          }

          pendingQuery = pendingQuery
            .in('status', ['pending', 'activated'])
            .order('created_at', { ascending: false })
            .limit(1);

          const { data: pending, error: pendingErr } = await pendingQuery.maybeSingle();

          if (pendingErr) throw pendingErr;

          console.log('🔎 Square pending subscription lookup', {
            userId,
            found: Boolean(pending?.square_order_id || pending?.square_subscription_id),
            status: pending?.status || null,
            hasOrderId: Boolean(pending?.square_order_id),
            hasSubscriptionId: Boolean(pending?.square_subscription_id),
            matchesPlanVariation: subscription.square_plan_variation_id
              ? String(pending?.square_plan_variation_id || '') === String(subscription.square_plan_variation_id)
              : null,
          });

          if (pending?.square_subscription_id) {
            squareSubId = pending.square_subscription_id;
          } else if (pending?.square_order_id) {
            pendingOrderId = pending.square_order_id;
            const fromOrder = await getSquareCustomerIdFromOrder(pending.square_order_id);
            console.log('🔎 Square pending order customer resolve', {
              userId,
              hasCustomerId: Boolean(fromOrder),
            });
            if (fromOrder) candidateCustomerIds.push(fromOrder);
          }
        } catch (e) {
          console.error('❌ Failed to resolve Square customer/sub from pending subscription', e);
        }
      }

      if (!squareSubId && pendingOrderId) {
        try {
          const match = await findSquareSubscriptionIdFromInvoiceByOrderId({ orderId: pendingOrderId });
          console.log('🔎 Square invoice lookup', {
            userId,
            hasPendingOrderId: true,
            foundSubscriptionId: Boolean(match?.subscriptionId),
          });
          if (match?.subscriptionId) {
            squareSubId = match.subscriptionId;
            if (match.customerId) squareCustomerId = match.customerId;
          }
        } catch (e) {
          console.error('❌ Failed to resolve Square subscription from invoice search', e);
        }
      }

      if (!squareSubId) {
        try {
          const fromBonus = await getSquareCustomerIdFromLatestSubscriptionBonusOrder({
            userId,
            planVariationId: subscription.square_plan_variation_id,
          });
          if (fromBonus) candidateCustomerIds.push(fromBonus);
        } catch (e) {
          console.error('❌ Failed to resolve Square customer from subscription bonus order', e);
        }
      }

      if (!squareSubId) {
        try {
          const fromPayment = await getSquareCustomerIdFromLatestSubscriptionBonusPayment({ userId });
          if (fromPayment) candidateCustomerIds.push(fromPayment);
        } catch (e) {
          console.error('❌ Failed to resolve Square customer from subscription bonus payment', e);
        }
      }

      const uniqueCustomerIds = Array.from(new Set(candidateCustomerIds.filter(Boolean)));

      if (!squareSubId) {
        for (const cid of uniqueCustomerIds) {
          if (squareSubId) break;
          try {
            const match = await findSquareSubscriptionIdFromLatestInvoiceByCustomerId({ customerId: cid });
            console.log('🔎 Square invoice-by-customer lookup', {
              userId,
              foundSubscriptionId: Boolean(match?.subscriptionId),
            });
            if (match?.subscriptionId) {
              squareSubId = match.subscriptionId;
              squareCustomerId = match.customerId || cid;
              break;
            }
          } catch (e) {
            console.error('❌ Failed to resolve Square subscription from invoice-by-customer search', e);
          }
        }
      }

      for (const cid of uniqueCustomerIds) {
        if (squareSubId) break;
        try {
          const subs = await listSquareSubscriptionsForCustomer({ customerId: cid });
          if (subs.length) {
            console.log('🔎 Square subscriptions for customer', {
              userId,
              subsFound: subs.length,
            });
          }
          const best = pickBestSquareSubscription({
            subs,
            planVariationId: subscription.square_plan_variation_id,
          });
          if (best?.id) {
            squareSubId = best.id;
            squareCustomerId = cid;
            break;
          }
        } catch (e) {
          console.error('❌ Failed to list Square subscriptions', e);
        }
      }

      if (!squareSubId && authData?.user?.email) {
        try {
          let match = await findSquareSubscriptionByCustomerEmail({
            email: authData.user.email,
            planVariationId: subscription.square_plan_variation_id,
          });

          if (!match) {
            match = await findSquareSubscriptionByCustomerEmail({
              email: authData.user.email,
              planVariationId: null,
            });
          }

          if (match?.subscriptionId) {
            squareSubId = match.subscriptionId;
            squareCustomerId = match.customerId;
          }
        } catch (e) {
          console.error('❌ Failed to match Square subscription by customer email', e);
        }
      }

      console.log('🔎 Square cancel lookup', {
        userId,
        hasSquareCustomerId: Boolean(squareCustomerId),
        hasSquareSubscriptionId: Boolean(squareSubId),
        candidateCustomerIds: uniqueCustomerIds.length,
      });

      if (!squareSubId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: 'No cancelable subscription found',
            message: 'Unable to locate your Square subscription. Please wait a moment and try again.',
          }),
        };
      }

      const resp = await squareRequest({
        path: `/v2/subscriptions/${squareSubId}/cancel`,
        method: 'POST',
      });

      const squareSub = resp?.subscription;
      const canceledIso = parseSquareDateToIso(squareSub?.canceled_date) || nowIso;
      const chargedThroughIso = parseSquareDateToIso(squareSub?.charged_through_date) || subscription.current_period_end || null;

      const { error: updateErr } = await supabaseAdmin
        .from('user_subscriptions')
        .update({
          canceled_at: canceledIso,
          current_period_end: chargedThroughIso,
          square_customer_id: squareCustomerId || subscription.square_customer_id || null,
          square_subscription_id: squareSubId,
          square_subscription_status: squareSub?.status || subscription.square_subscription_status || null,
          updated_at: nowIso,
        })
        .eq('user_id', userId);

      if (updateErr) throw updateErr;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          provider: 'square',
          status: subscription.status || 'active',
          canceledAt: canceledIso,
        }),
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: 'No cancelable subscription found',
        message: 'Your subscription is missing billing IDs. Please contact support.',
      }),
    };
  } catch (error) {
    console.error('❌ cancel-subscription error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to cancel subscription',
        message: error.message,
      }),
    };
  }
};
