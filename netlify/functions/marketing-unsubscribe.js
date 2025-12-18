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
      .eq('unsubscribe_token', token)
      .maybeSingle();

    if (findErr) throw findErr;

    if (!row) {
      const accept = (event.headers?.accept || '').toLowerCase();
      if (accept.includes('text/html')) {
        return htmlResponse('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Unsubscribe</title></head><body style="font-family: ui-sans-serif, system-ui; padding: 24px;"><h2>Unsubscribe</h2><p>This unsubscribe link is invalid or expired.</p></body></html>');
      }
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Invalid token' }),
      };
    }

    if (row.status !== 'unsubscribed') {
      const { error: updErr } = await supabase
        .from('marketing_subscribers')
        .update({
          status: 'unsubscribed',
          confirm_token: null,
          confirmed_at: null,
          unsubscribed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      if (updErr) throw updErr;
    }

    const accept = (event.headers?.accept || '').toLowerCase();
    if (accept.includes('text/html')) {
      return htmlResponse(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Unsubscribed</title></head><body style="font-family: ui-sans-serif, system-ui; padding: 24px;"><h2>Unsubscribed</h2><p>${row.email} has been unsubscribed.</p></body></html>`);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, email: row.email, status: 'unsubscribed' }),
    };
  } catch (error) {
    console.error('❌ marketing-unsubscribe error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to unsubscribe', message: error.message }),
    };
  }
};
