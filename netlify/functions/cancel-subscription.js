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
  const resp = await squareRequest({
    path: '/v2/customers/search',
    method: 'POST',
    body: {
      query: {
        filter: {
          email_address: {
            exact: String(email).trim(),
          },
        },
      },
      limit: 5,
    },
  });

  const customers = Array.isArray(resp?.customers) ? resp.customers : [];
  const ids = customers.map((c) => c?.id).filter(Boolean);
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
      limit: 10,
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
  return active || candidates[0] || null;
}

async function getSquareCustomerIdFromOrder(orderId) {
  if (!orderId) return null;
  const resp = await squareRequest({
    path: `/v2/orders/${encodeURIComponent(orderId)}`,
    method: 'GET',
  });
  return resp?.order?.customer_id || null;
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

      const candidateCustomerIds = [];
      if (squareCustomerId) candidateCustomerIds.push(squareCustomerId);

      if (!squareCustomerId && authData?.user?.email) {
        try {
          const emailCustomerIds = await lookupSquareCustomerIdsByEmail(authData.user.email);
          for (const cid of emailCustomerIds) candidateCustomerIds.push(cid);
        } catch (e) {
          console.error('❌ Failed to lookup Square customer by email', e);
        }
      }

      if (!squareCustomerId && !squareSubId) {
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
            const fromOrder = await getSquareCustomerIdFromOrder(pending.square_order_id);
            if (fromOrder) candidateCustomerIds.push(fromOrder);
          }
        } catch (e) {
          console.error('❌ Failed to resolve Square customer/sub from pending subscription', e);
        }
      }

      const uniqueCustomerIds = Array.from(new Set(candidateCustomerIds.filter(Boolean)));
      for (const cid of uniqueCustomerIds) {
        if (squareSubId) break;
        try {
          const subs = await listSquareSubscriptionsForCustomer({ customerId: cid });
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
            message: 'Your Square subscription is still activating. Please wait a moment and try again.',
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
