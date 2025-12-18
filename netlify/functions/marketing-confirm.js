'use strict';

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

function htmlResponse(html) {
  return {
    statusCode: 200,
    headers: {
      ...headers,
      'Content-Type': 'text/html; charset=utf-8',
    },
    body: html,
  };
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const params = event.queryStringParameters || {};
    const body = event.httpMethod === 'POST' ? JSON.parse(event.body || '{}') : {};

    const token = (params.token || body.token || '').trim();

    if (!token) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'token is required' }),
      };
    }

    const { data: row, error: findErr } = await supabase
      .from('marketing_subscribers')
      .select('id, email, status')
      .eq('confirm_token', token)
      .maybeSingle();

    if (findErr) throw findErr;

    const accept = (event.headers?.accept || '').toLowerCase();

    if (!row) {
      if (accept.includes('text/html')) {
        return htmlResponse('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Confirm subscription</title></head><body style="font-family: ui-sans-serif, system-ui; padding: 24px;"><h2>Confirm subscription</h2><p>This confirmation link is invalid or expired.</p></body></html>');
      }
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Invalid token' }),
      };
    }

    if (row.status === 'unsubscribed') {
      if (accept.includes('text/html')) {
        const baseUrl = process.env.APP_BASE_URL || '';
        const backLink = baseUrl ? `<p><a href="${baseUrl}">Return to ChatSpheres</a></p>` : '';
        return htmlResponse(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Unsubscribed</title></head><body style="font-family: ui-sans-serif, system-ui; padding: 24px;"><h2>Unsubscribed</h2><p>${row.email} is currently unsubscribed.</p>${backLink}</body></html>`);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, email: row.email, status: 'unsubscribed' }),
      };
    }

    if (row.status !== 'subscribed') {
      const nowIso = new Date().toISOString();
      const { error: updErr } = await supabase
        .from('marketing_subscribers')
        .update({
          status: 'subscribed',
          confirmed_at: nowIso,
          confirm_token: null,
          unsubscribed_at: null,
          updated_at: nowIso,
        })
        .eq('id', row.id);

      if (updErr) throw updErr;
    }

    if (accept.includes('text/html')) {
      const baseUrl = process.env.APP_BASE_URL || '';
      const backLink = baseUrl ? `<p><a href="${baseUrl}">Return to ChatSpheres</a></p>` : '';
      return htmlResponse(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Confirmed</title></head><body style="font-family: ui-sans-serif, system-ui; padding: 24px;"><h2>Subscribed</h2><p>${row.email} is confirmed and subscribed.</p>${backLink}</body></html>`);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, email: row.email, status: 'subscribed' }),
    };
  } catch (error) {
    console.error('❌ marketing-confirm error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to confirm', message: error.message }),
    };
  }
};
