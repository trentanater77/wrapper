'use strict';

const ADMIN_SECRET = process.env.ADMIN_SECRET;

const { buildCreatorWelcomeEmailHtml, getAppBaseUrl } = require('./redeem-creator-invite.js');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const headerSecret = event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'] || '';
  const querySecret = event.queryStringParameters?.secret || '';
  const adminSecret = headerSecret || querySecret;

  if (!ADMIN_SECRET) {
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
      body: 'Server configuration error - admin secret not set',
    };
  }

  if (adminSecret !== ADMIN_SECRET) {
    return {
      statusCode: 401,
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
      body: 'Unauthorized - Invalid admin secret',
    };
  }

  const qp = event.queryStringParameters || {};
  const creatorName = String(qp.name || qp.creatorName || 'Creator');
  const supportEmail = String(qp.supportEmail || process.env.RESEND_REPLY_TO_EMAIL || 'support@tivoq.com');
  const baseUrl = String(qp.baseUrl || getAppBaseUrl() || '');

  const html = buildCreatorWelcomeEmailHtml({ baseUrl, creatorName, supportEmail });

  return {
    statusCode: 200,
    headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
    body: html,
  };
};
