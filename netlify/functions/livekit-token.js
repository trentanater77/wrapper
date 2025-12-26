
'use strict';

const BASE_JSON_ENV = 'CHATSPHERES_CONFIG_JSON';

const baseHeaders = {
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};

function getAllowedOrigins() {
  const raw = (process.env.LIVEKIT_ALLOWED_ORIGINS || process.env.APP_BASE_URL || 'https://tivoq.com')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return raw.length ? raw : ['https://tivoq.com'];
}

function buildCorsHeaders(origin) {
  const allowed = getAllowedOrigins();
  const headers = { ...baseHeaders };
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return headers;
}

function safeParse(json) {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed;
    }
    return {};
  } catch (error) {
    console.warn('⚠️ Unable to parse CHATSPHERES_CONFIG_JSON:', error.message);
    return {};
  }
}

function deriveBaseUrlFromConfig(config) {
  if (!config || typeof config !== 'object') return '';

  const rawControl = config.controlApiBaseUrl;
  if (typeof rawControl === 'string' && rawControl.trim()) {
    return rawControl.trim().replace(/\/$/, '');
  }

  const rawEndpoint = config.tokenEndpoint || config.recordingsEndpoint;
  if (typeof rawEndpoint === 'string' && rawEndpoint.trim()) {
    try {
      const url = new URL(rawEndpoint.trim());
      return url.origin;
    } catch {
      return '';
    }
  }

  return '';
}

function getControlApiBaseUrl() {
  const envBase = (process.env.CONTROL_API_BASE_URL || process.env.LIVEKIT_CONTROL_API_BASE_URL || '').trim();
  if (envBase) return envBase.replace(/\/$/, '');

  const baseConfig = safeParse(process.env[BASE_JSON_ENV]);
  const derived = deriveBaseUrlFromConfig(baseConfig);
  return derived.replace(/\/$/, '');
}

exports.handler = async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  const corsHeaders = buildCorsHeaders(origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const baseUrl = getControlApiBaseUrl();
  if (!baseUrl) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server configuration error - missing CONTROL_API_BASE_URL' }),
    };
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  try {
    const apiKey = event?.headers?.['x-api-key'] || event?.headers?.['X-Api-Key'] || '';
    const resp = await fetch(`${baseUrl}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
      },
      body: JSON.stringify(payload),
    });

    const contentType = resp.headers.get('content-type') || '';
    const bodyText = await resp.text().catch(() => '');

    return {
      statusCode: resp.status,
      headers: {
        ...corsHeaders,
        'Content-Type': contentType.includes('application/json')
          ? 'application/json'
          : 'text/plain; charset=utf-8',
      },
      body: bodyText,
    };
  } catch (error) {
    console.error('❌ livekit-token proxy error:', error);
    return {
      statusCode: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to reach token service', message: error.message }),
    };
  }
};
