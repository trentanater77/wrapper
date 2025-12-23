'use strict';

/**
 * Get User Subscription
 * 
 * Returns the current user's subscription status and gem balance.
 * Requires user to be authenticated.
 */

const { createClient } = require('@supabase/supabase-js');

const SQUARE_ENVIRONMENT = (process.env.SQUARE_ENVIRONMENT || 'production').toLowerCase();
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID;

let cachedSquareLocationIds = null;
let cachedSquareLocationIdsAtMs = 0;

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// CORS headers
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

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

    if (typeof fetch !== 'function') {
      reject(new Error('fetch not available'));
      return;
    }

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
  });
}

async function getSquareLocationIds() {
  const now = Date.now();
  if (Array.isArray(cachedSquareLocationIds) && now - cachedSquareLocationIdsAtMs < 5 * 60 * 1000) {
    return cachedSquareLocationIds;
  }

  const ids = [];
  if (SQUARE_LOCATION_ID) ids.push(SQUARE_LOCATION_ID);

  try {
    const resp = await squareRequest({ path: '/v2/locations', method: 'GET' });
    const fromApi = Array.isArray(resp?.locations) ? resp.locations.map((l) => l?.id).filter(Boolean) : [];
    for (const id of fromApi) {
      if (!ids.includes(id)) ids.push(id);
    }
  } catch (e) {
    // Keep fallback behavior if token cannot list locations.
  }

  cachedSquareLocationIds = ids;
  cachedSquareLocationIdsAtMs = now;
  return ids;
}

async function getSquareCustomer(customerId) {
  if (!customerId) return null;
  const resp = await squareRequest({
    path: `/v2/customers/${encodeURIComponent(customerId)}`,
    method: 'GET',
  });
  return resp?.customer || null;
}

async function getSquareCustomerIdFromPayment(paymentId) {
  if (!paymentId) return null;
  const resp = await squareRequest({
    path: `/v2/payments/${encodeURIComponent(paymentId)}`,
    method: 'GET',
  });
  return resp?.payment?.customer_id || null;
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

async function listSquareSubscriptions({ includeLocationFilter, cursor, limit }) {
  const locationIds = includeLocationFilter ? await getSquareLocationIds().catch(() => []) : [];
  const query = {};

  if (includeLocationFilter && Array.isArray(locationIds) && locationIds.length) {
    query.filter = { location_ids: locationIds };
  }

  let resp;
  try {
    resp = await squareRequest({
      path: '/v2/subscriptions/search',
      method: 'POST',
      body: {
        ...(query.filter ? { query } : { query }),
        limit: Number(limit || 50),
        ...(cursor ? { cursor } : {}),
      },
    });
  } catch (e) {
    console.error('❌ Square subscriptions.search failed', {
      includeLocationFilter,
      locationIdsCount: Array.isArray(locationIds) ? locationIds.length : 0,
      cursor: cursor || null,
      message: e?.message || String(e),
    });
    throw e;
  }

  const subscriptions = Array.isArray(resp?.subscriptions) ? resp.subscriptions : [];
  subscriptions.sort((a, b) => {
    const aMs = a?.created_at ? new Date(a.created_at).getTime() : 0;
    const bMs = b?.created_at ? new Date(b.created_at).getTime() : 0;
    return bMs - aMs;
  });

  return {
    subscriptions,
    cursor: resp?.cursor || null,
  };
}

async function findSquareSubscriptionByPlanAndEmail({ planVariationId, userEmail, createdAfterIso }) {
  if (!planVariationId || !userEmail) return null;

  const createdAfterMs = createdAfterIso ? new Date(createdAfterIso).getTime() : 0;
  const emailLower = String(userEmail).toLowerCase();

  const scan = async (includeLocationFilter) => {
    let cursor = null;
    for (let page = 0; page < 5; page++) {
      const resp = await listSquareSubscriptions({ includeLocationFilter, cursor, limit: 50 });
      const subs = resp.subscriptions;
      cursor = resp.cursor;

      const candidates = subs
        .filter((s) => {
          if (!s?.id) return false;
          if (String(s?.plan_variation_id || '') !== String(planVariationId)) return false;
          const st = String(s?.status || '').toUpperCase();
          if (st === 'CANCELED' || st === 'DEACTIVATED') return false;
          const createdMs = s?.created_at ? new Date(s.created_at).getTime() : 0;
          if (createdAfterMs && createdMs && createdMs < createdAfterMs) return false;
          return true;
        })
        .slice(0, 20);

      for (const sub of candidates) {
        const custId = sub?.customer_id || null;
        if (!custId) continue;
        const cust = await getSquareCustomer(custId).catch(() => null);
        const custEmail = String(cust?.email_address || '').toLowerCase();
        if (custEmail && custEmail === emailLower) {
          return sub;
        }
      }

      if (!cursor) break;
    }

    return null;
  };

  return (await scan(true)) || (await scan(false));
}

async function findSquareSubscriptionByPlanVariationRecent({ planVariationId, createdAfterIso }) {
  if (!planVariationId) return null;

  const createdAfterMs = createdAfterIso ? new Date(createdAfterIso).getTime() : 0;

  const scan = async (includeLocationFilter) => {
    let cursor = null;
    const matches = [];

    for (let page = 0; page < 6; page++) {
      const resp = await listSquareSubscriptions({ includeLocationFilter, cursor, limit: 50 });
      const subs = resp.subscriptions;
      cursor = resp.cursor;

      for (const s of subs) {
        if (!s?.id) continue;
        if (String(s?.plan_variation_id || '') !== String(planVariationId)) continue;
        const st = String(s?.status || '').toUpperCase();
        if (st === 'CANCELED' || st === 'DEACTIVATED') continue;
        const createdMs = s?.created_at ? new Date(s.created_at).getTime() : 0;
        if (createdAfterMs && createdMs && createdMs < createdAfterMs) continue;
        matches.push(s);
      }

      if (!cursor) break;
    }

    if (!matches.length) return null;

    matches.sort((a, b) => {
      const aMs = a?.created_at ? new Date(a.created_at).getTime() : 0;
      const bMs = b?.created_at ? new Date(b.created_at).getTime() : 0;
      return bMs - aMs;
    });

    if (matches.length > 1) {
      console.log('⚠️ Multiple Square subscriptions match plan variation; choosing newest', {
        planVariationId,
        createdAfterIso,
        count: matches.length,
        chosen: {
          id: matches[0]?.id || null,
          status: matches[0]?.status || null,
          customer_id: matches[0]?.customer_id || null,
          created_at: matches[0]?.created_at || null,
        },
      });
    }

    return matches[0] || null;
  };

  return (await scan(true)) || (await scan(false));
}

async function findSquareSubscriptionByEmail({ userEmail, createdAfterIso }) {
  if (!userEmail) return null;

  const createdAfterMs = createdAfterIso ? new Date(createdAfterIso).getTime() : 0;
  const emailLower = String(userEmail).toLowerCase();

  const scan = async (includeLocationFilter) => {
    let cursor = null;
    for (let page = 0; page < 6; page++) {
      const resp = await listSquareSubscriptions({ includeLocationFilter, cursor, limit: 50 });
      const subs = resp.subscriptions;
      cursor = resp.cursor;

      const candidates = subs.filter((s) => {
        if (!s?.id) return false;
        const st = String(s?.status || '').toUpperCase();
        if (st === 'CANCELED' || st === 'DEACTIVATED') return false;
        const createdMs = s?.created_at ? new Date(s.created_at).getTime() : 0;
        if (createdAfterMs && createdMs && createdMs < createdAfterMs) return false;
        return true;
      }).slice(0, 30);

      for (const sub of candidates) {
        const custId = sub?.customer_id || null;
        if (!custId) continue;
        const cust = await getSquareCustomer(custId).catch(() => null);
        const custEmail = String(cust?.email_address || '').toLowerCase();
        if (custEmail && custEmail === emailLower) {
          return sub;
        }
      }

      if (!cursor) break;
    }

    return null;
  };

  return (await scan(true)) || (await scan(false));
}

async function lookupSquareCustomerIdByEmail(email) {
  if (!email) return null;
  const resp = await squareRequest({
    path: '/v2/customers/search',
    method: 'POST',
    body: {
      query: {
        filter: {
          email_address: { fuzzy: String(email) },
        },
        sort: {
          field: 'CREATED_AT',
          order: 'DESC',
        },
      },
      limit: 10,
    },
  });

  const customers = Array.isArray(resp?.customers) ? resp.customers : [];
  const exact = customers.find((c) => String(c?.email_address || '').toLowerCase() === String(email).toLowerCase());
  return (exact || customers[0])?.id || null;
}

async function findSquareSubscriptionForCustomer({ customerId, planVariationId, createdAfterIso }) {
  if (!customerId || !planVariationId) return null;

  const locationIds = await getSquareLocationIds().catch(() => []);

  const listSubs = async ({ includeLocationFilter }) => {
    const filter = { customer_ids: [customerId] };
    if (includeLocationFilter && Array.isArray(locationIds) && locationIds.length) {
      filter.location_ids = locationIds;
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

    return Array.isArray(resp?.subscriptions) ? resp.subscriptions : [];
  };

  let subs = [];
  try {
    subs = await listSubs({ includeLocationFilter: true });
  } catch (e) {
    console.error('❌ Square subscription search failed (with locations)', {
      customerId,
      planVariationId,
      locationIdsCount: Array.isArray(locationIds) ? locationIds.length : 0,
      message: e?.message || String(e),
    });
    subs = [];
  }

  if (!subs.length) {
    try {
      subs = await listSubs({ includeLocationFilter: false });
    } catch (e) {
      console.error('❌ Square subscription search failed (without locations)', {
        customerId,
        planVariationId,
        message: e?.message || String(e),
      });
      subs = [];
    }
  }

  subs.sort((a, b) => {
    const aMs = a?.created_at ? new Date(a.created_at).getTime() : 0;
    const bMs = b?.created_at ? new Date(b.created_at).getTime() : 0;
    return bMs - aMs;
  });

  const summarized = subs.slice(0, 10).map((s) => ({
    id: s?.id || null,
    status: s?.status || null,
    plan_variation_id: s?.plan_variation_id || null,
    created_at: s?.created_at || null,
  }));

  const candidates = subs.filter((s) => {
    if (!s?.id) return false;
    if (String(s?.plan_variation_id || '') !== String(planVariationId)) return false;
    const st = String(s?.status || '').toUpperCase();
    return st !== 'CANCELED' && st !== 'DEACTIVATED';
  });

  if (candidates[0]) return candidates[0];

  console.log('⚠️ Square subscription search returned no match for plan variation', {
    customerId,
    planVariationId,
    subscriptionCount: subs.length,
    subscriptions: summarized,
  });

  if (createdAfterIso) {
    const createdAfterMs = new Date(createdAfterIso).getTime();
    const fallback = subs.find((s) => {
      if (!s?.id) return false;
      const st = String(s?.status || '').toUpperCase();
      if (st === 'CANCELED' || st === 'DEACTIVATED') return false;
      const createdMs = s?.created_at ? new Date(s.created_at).getTime() : 0;
      return createdMs && createdMs >= createdAfterMs;
    });

    if (fallback) {
      console.log('⚠️ Using fallback Square subscription selection (created after pending checkout)', {
        customerId,
        planVariationId,
        createdAfterIso,
        chosen: {
          id: fallback?.id || null,
          status: fallback?.status || null,
          plan_variation_id: fallback?.plan_variation_id || null,
          created_at: fallback?.created_at || null,
        },
      });
      return fallback;
    }
  }

  return null;
}

exports.handler = async function(event) {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  try {
    console.log('🔧 get-subscription', {
      hasSquareAccessToken: Boolean(SQUARE_ACCESS_TOKEN),
      context: process.env.CONTEXT,
      commitRef: process.env.COMMIT_REF || null,
    });

    // Get user ID from query params or body
    let userId;
    
    if (event.httpMethod === 'GET') {
      userId = event.queryStringParameters?.userId;
    } else if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      userId = body.userId;
    }

    if (!userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'userId is required' }),
      };
    }

    // Get subscription
    let { data: subscription, error: subError } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (subError) {
      if (subError.code !== 'PGRST116') throw subError;
    }

    let pending = null;
    try {
      const pendingResp = await supabase
        .from('square_pending_subscriptions')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['pending', 'activated'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      pending = pendingResp?.data || null;
    } catch (e) {
      pending = null;
    }

    const pendingCreatedMs = pending?.created_at ? new Date(pending.created_at).getTime() : 0;
    const pendingIsRecent = pendingCreatedMs && (Date.now() - pendingCreatedMs) < (24 * 60 * 60 * 1000);
    const pendingPlanVarId = pending?.square_plan_variation_id || null;

    const shouldSquareReconcile = Boolean(SQUARE_ACCESS_TOKEN)
      && pendingIsRecent
      && Boolean(pendingPlanVarId)
      && (
        !subscription
        || subscription.plan_type === 'free'
        || !subscription.square_subscription_id
        || String(subscription.square_plan_variation_id || '') !== String(pendingPlanVarId)
        || String(subscription.plan_type || '') !== String(pending?.plan_type || '')
      );

    if (shouldSquareReconcile) {
      try {
        const planVariationId = pendingPlanVarId;
        if (planVariationId) {
          const { data: authUser } = await supabase.auth.admin.getUserById(userId).catch(() => ({ data: null }));
          const email = authUser?.user?.email || null;

          let customerId = (pending?.square_customer_id || null) || null;
          if (!customerId && pending?.square_order_id) {
            customerId = await getSquareCustomerIdFromOrder(pending.square_order_id).catch(() => null);
          }
          if (!customerId) {
            customerId = await lookupSquareCustomerIdByEmail(email).catch(() => null);
          }

          console.log('🔎 Square subscription reconcile lookup', {
            userId,
            hasPending: Boolean(pending?.id),
            pendingStatus: pending?.status || null,
            pendingPlanType: pending?.plan_type || null,
            hasPlanVariationId: Boolean(planVariationId),
            hasOrderId: Boolean(pending?.square_order_id),
            hasEmail: Boolean(email),
            hasCustomerId: Boolean(customerId),
            currentPlanType: subscription?.plan_type || null,
            currentPlanVariationId: subscription?.square_plan_variation_id || null,
            currentSquareSubscriptionId: subscription?.square_subscription_id || null,
          });

          const pendingCreatedAt = pending?.created_at ? new Date(pending.created_at) : null;
          const createdAfterIso = pendingCreatedAt
            ? new Date(pendingCreatedAt.getTime() - 10 * 60 * 1000).toISOString()
            : null;

          let squareSub = customerId
            ? await findSquareSubscriptionForCustomer({ customerId, planVariationId, createdAfterIso }).catch(() => null)
            : null;

          if (!squareSub?.id) {
            await new Promise((r) => setTimeout(r, 600));
            squareSub = customerId
              ? await findSquareSubscriptionForCustomer({ customerId, planVariationId, createdAfterIso }).catch(() => null)
              : null;
          }

          if (!squareSub?.id && email) {
            console.log('🔎 Square subscription reconcile: scanning subscriptions by plan variation + customer email', {
              userId,
              planVariationId,
              createdAfterIso,
            });
            squareSub = await findSquareSubscriptionByPlanAndEmail({
              planVariationId,
              userEmail: email,
              createdAfterIso,
            }).catch(() => null);
          }

          if (!squareSub?.id && email) {
            console.log('🔎 Square subscription reconcile: scanning subscriptions by customer email (no plan filter)', {
              userId,
              createdAfterIso,
            });
            squareSub = await findSquareSubscriptionByEmail({
              userEmail: email,
              createdAfterIso,
            }).catch(() => null);
          }

          if (!squareSub?.id) {
            console.log('🔎 Square subscription reconcile: scanning subscriptions by plan variation only (no customer/email match)', {
              userId,
              planVariationId,
              createdAfterIso,
            });
            squareSub = await findSquareSubscriptionByPlanVariationRecent({
              planVariationId,
              createdAfterIso,
            }).catch(() => null);
          }

          if (!squareSub?.id) {
            console.log('⚠️ Square subscription reconcile did not find a subscription to link', {
              userId,
              customerId,
              planVariationId,
              createdAfterIso,
            });
          }

          if (squareSub?.id) {
            const nowIso = new Date().toISOString();
            console.log('✅ Square subscription reconciled', {
              userId,
              subscriptionId: squareSub.id,
              planVariationId,
            });
            await supabase
              .from('user_subscriptions')
              .upsert({
                user_id: userId,
                square_customer_id: customerId,
                square_subscription_id: squareSub.id,
                square_plan_variation_id: planVariationId,
                square_subscription_status: squareSub.status || null,
                plan_type: pending.plan_type,
                billing_period: pending.billing_period,
                status: 'active',
                updated_at: nowIso,
              }, { onConflict: 'user_id' });

            await supabase
              .from('square_pending_subscriptions')
              .update({
                status: 'activated',
                square_subscription_id: squareSub.id,
                activated_at: nowIso,
              })
              .eq('id', pending.id);

            const refreshed = await supabase
              .from('user_subscriptions')
              .select('*')
              .eq('user_id', userId)
              .maybeSingle();
            subscription = refreshed?.data || subscription;
          }
        }
      } catch (e) {
        console.error('❌ Square subscription reconcile failed:', e);
      }
    }

    // Get gem balance
    const { data: gemBalance, error: gemError } = await supabase
      .from('gem_balances')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (gemError) {
      if (gemError.code !== 'PGRST116') throw gemError;
    }

    // Get user profile (badge & branding)
    const { data: userProfile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    // Get main profile (display_name, bio, avatar)
    const { data: mainProfile } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    // Get pending payout requests
    const { data: pendingPayouts } = await supabase
      .from('payout_requests')
      .select('id, gems_amount, usd_amount, status, requested_at')
      .eq('user_id', userId)
      .in('status', ['pending', 'processing'])
      .order('requested_at', { ascending: false });

    // Calculate cashable balance and payout eligibility
    const cashableGems = gemBalance?.cashable_gems || 0;
    const minPayoutGems = 500; // 500 gems = $4.95 minimum
    const canRequestPayout = cashableGems >= minPayoutGems && (!pendingPayouts || pendingPayouts.length === 0);
    const cashableUsd = Math.round((cashableGems / 100) * 0.99 * 100) / 100;

    // Determine badge based on plan (auto-assign if not set or set to 'none')
    const planType = getEffectivePlanType(subscription);
    const autoBadge = getBadgeForPlan(planType);
    // Use auto-badge if user profile badge is not set or is 'none'
    const profileBadge = userProfile?.badge_type;
    const badgeType = (profileBadge && profileBadge !== 'none') ? profileBadge : autoBadge;
    const badgeVisible = userProfile?.badge_visible !== false;

    // Build response
    const response = {
      subscription: subscription || {
        plan_type: 'free',
        status: 'active',
        billing_period: null,
        current_period_end: null,
      },
      gems: gemBalance || {
        spendable_gems: 0,
        cashable_gems: 0,
        promo_gems: 0,
        pending_referral_gems: 0,
      },
      // Main Profile (from profiles table)
      mainProfile: {
        username: mainProfile?.username || null,
        displayName: mainProfile?.display_name || null,
        bio: mainProfile?.bio || null,
        avatarUrl: mainProfile?.avatar_url || null,
      },
      // Branding Profile (from user_profiles table)
      profile: {
        displayName: userProfile?.display_name || mainProfile?.display_name || null,
        bio: userProfile?.bio || mainProfile?.bio || null,
        customLogoUrl: userProfile?.custom_logo_url || null,
        logoUpdatedAt: userProfile?.logo_updated_at || null,
      },
      // Badge info
      badge: {
        type: badgeVisible ? badgeType : 'none',
        visible: badgeVisible,
        emoji: getBadgeEmoji(badgeType),
        label: getBadgeLabel(badgeType),
        color: getBadgeColor(badgeType),
      },
      // Payout info
      payout: {
        cashableGems,
        cashableUsd,
        minPayoutGems,
        minPayoutUsd: 4.95,
        canRequestPayout,
        pendingRequests: pendingPayouts || [],
        payoutEmail: gemBalance?.payout_email || null,
        payoutMethod: gemBalance?.payout_method || 'paypal',
      },
      // Convenience fields
      plan: planType,
      isActive: (subscription?.status === 'active' || !subscription) && planType !== 'free',
      isPro: planType === 'host_pro' || planType === 'pro_bundle',
      isAdFree: ['ad_free_plus', 'ad_free_premium', 'pro_bundle'].includes(planType),
      isBundle: planType === 'pro_bundle',
      totalGems: (gemBalance?.spendable_gems || 0) + (gemBalance?.cashable_gems || 0),
      // Limits based on plan
      limits: getPlanLimits(planType),
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response),
    };

  } catch (error) {
    console.error('❌ Error getting subscription:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to get subscription',
        message: error.message 
      }),
    };
  }
};

/**
 * Get badge type based on plan
 */
function getBadgeForPlan(planType) {
  switch (planType) {
    case 'pro_bundle': return 'bundle';
    case 'host_pro': return 'pro';
    case 'ad_free_premium': return 'premium';
    case 'ad_free_plus': return 'premium';
    default: return 'none';
  }
}

function getEffectivePlanType(subscription) {
  const rawPlan = subscription?.plan_type || 'free';
  if (rawPlan === 'free') return 'free';

  const status = subscription?.status || 'active';
  const end = subscription?.current_period_end ? new Date(subscription.current_period_end) : null;

  if (status === 'canceled' && end && end.getTime() <= Date.now()) {
    return 'free';
  }

  return rawPlan;
}

/**
 * Get badge emoji
 */
function getBadgeEmoji(badgeType) {
  switch (badgeType) {
    case 'bundle': return '👑';
    case 'pro': return '⭐';
    case 'premium': return '💎';
    case 'verified': return '✓';
    case 'og': return '🏆';
    default: return '';
  }
}

/**
 * Get badge label
 */
function getBadgeLabel(badgeType) {
  switch (badgeType) {
    case 'bundle': return 'Pro Bundle';
    case 'pro': return 'Host Pro';
    case 'premium': return 'Premium';
    case 'verified': return 'Verified';
    case 'og': return 'OG';
    default: return '';
  }
}

/**
 * Get badge color (CSS color value)
 */
function getBadgeColor(badgeType) {
  switch (badgeType) {
    case 'bundle': return '#FFD166';   // Gold crown
    case 'pro': return '#FFD166';      // Gold star  
    case 'premium': return '#a855f7';  // Purple diamond
    case 'verified': return '#22c55e'; // Green check
    case 'og': return '#e63946';       // Red trophy
    default: return '#6b7280';         // Gray
  }
}

/**
 * Get plan limits based on subscription type
 */
function getPlanLimits(planType) {
  switch (planType) {
    case 'pro_bundle':
      return {
        roomTimeMinutes: 180, // 3 hours
        canRecord: true,
        canCustomBrand: true,
        canChargeEntry: true, // Green Room
        showAds: false, // No ads (has Ad-Free)
        watermark: 'custom', // Can upload own logo
        monthlyGems: 1200, // From Ad-Free Premium
        // Forum limits
        canCreatePrivateForums: true,
        canCustomizeForumBranding: true,
        forumCreatorRevenueShare: 0.10, // 10% of tips in their forum
      };

    case 'host_pro':
      return {
        roomTimeMinutes: 180, // 3 hours
        canRecord: true,
        canCustomBrand: true,
        canChargeEntry: true, // Green Room
        showAds: true, // Still shows ads to non-paying viewers
        watermark: 'custom', // Can upload own logo
        monthlyGems: 0,
        // Forum limits
        canCreatePrivateForums: true,
        canCustomizeForumBranding: true,
        forumCreatorRevenueShare: 0.10, // 10% of tips in their forum
      };

    case 'ad_free_plus':
    case 'ad_free_premium':
      return {
        roomTimeMinutes: 60, // Same as free for hosting
        canRecord: false,
        canCustomBrand: false,
        canChargeEntry: false,
        showAds: false, // No ads for this user
        watermark: 'chatspheres',
        monthlyGems: planType === 'ad_free_premium' ? 1200 : 500,
        // Forum limits
        canCreatePrivateForums: false,
        canCustomizeForumBranding: false,
        forumCreatorRevenueShare: 0.10, // 10% of tips in their forum
      };

    case 'free':
    default:
      return {
        roomTimeMinutes: 60, // 60 minutes
        canRecord: false,
        canCustomBrand: false,
        canChargeEntry: false,
        showAds: true,
        watermark: 'chatspheres',
        monthlyGems: 0,
        // Forum limits
        canCreatePrivateForums: false,
        canCustomizeForumBranding: false,
        forumCreatorRevenueShare: 0.10, // 10% of tips in their forum
      };
  }
}
