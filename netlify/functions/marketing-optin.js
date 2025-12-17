'use strict';

const crypto = require('crypto');

const { createClient } = require('@supabase/supabase-js');
const { sanitizeEmail, sanitizeText } = require('./utils/sanitize');

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

async function getEmailForUserId(userId) {
  if (!userId) return '';
  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (error) return '';
    return data?.user?.email || '';
  } catch {
    return '';
  }
}

async function upsertMarketingSubscriber({ userId, email, source }) {
  const normalizedEmail = sanitizeEmail(email);
  if (!normalizedEmail) {
    throw new Error('Invalid email format');
  }

  const cleanSource = source ? sanitizeText(source, 120) : null;

  const { data: existing, error: existingErr } = await supabase
    .from('marketing_subscribers')
    .select('id, email, status, unsubscribe_token')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (existingErr) throw existingErr;

  if (existing) {
    const { error: updateErr } = await supabase
      .from('marketing_subscribers')
      .update({
        user_id: userId || existing.user_id || null,
        status: 'subscribed',
        unsubscribed_at: null,
        updated_at: new Date().toISOString(),
        ...(cleanSource ? { source: cleanSource } : {}),
      })
      .eq('id', existing.id);

    if (updateErr) throw updateErr;

    return {
      email: normalizedEmail,
      status: 'subscribed',
      unsubscribe_token: existing.unsubscribe_token,
    };
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const unsubscribeToken = crypto.randomBytes(24).toString('hex');

    const { data: inserted, error: insertErr } = await supabase
      .from('marketing_subscribers')
      .insert({
        user_id: userId || null,
        email: normalizedEmail,
        status: 'subscribed',
        unsubscribe_token: unsubscribeToken,
        ...(cleanSource ? { source: cleanSource } : {}),
        subscribed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select('email, status, unsubscribe_token')
      .single();

    if (!insertErr) return inserted;

    if (insertErr.code === '23505') {
      continue;
    }

    throw insertErr;
  }

  throw new Error('Failed to create subscriber');
}

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
    const userId = body.userId || null;
    const source = body.source || null;

    let email = (body.email || '').trim();

    if (!email && userId) {
      email = await getEmailForUserId(userId);
    }

    const result = await upsertMarketingSubscriber({
      userId,
      email,
      source,
    });

    const baseUrl = process.env.APP_BASE_URL || '';
    const unsubscribeUrl = baseUrl
      ? `${baseUrl}/.netlify/functions/marketing-unsubscribe?token=${encodeURIComponent(result.unsubscribe_token)}`
      : `/.netlify/functions/marketing-unsubscribe?token=${encodeURIComponent(result.unsubscribe_token)}`;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        email: result.email,
        status: result.status,
        unsubscribeUrl,
      }),
    };
  } catch (error) {
    console.error('❌ marketing-optin error:', error);
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Failed to opt-in', message: error.message }),
    };
  }
};
