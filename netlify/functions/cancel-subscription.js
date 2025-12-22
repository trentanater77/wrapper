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

    if (subscription.square_subscription_id) {
      const squareSubId = subscription.square_subscription_id;

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
