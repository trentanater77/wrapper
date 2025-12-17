'use strict';

const https = require('https');

const ADMIN_SECRET = process.env.ADMIN_SECRET;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

async function sendResendEmail({ from, to, subject, html, text, headers: extraHeaders }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('Missing RESEND_API_KEY');
  }

  const payload = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    ...(html ? { html } : {}),
    ...(text ? { text } : {}),
    ...(extraHeaders ? { headers: extraHeaders } : {}),
  };

  if (typeof fetch === 'function') {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      const message = data?.message || data?.error || `Resend error (${resp.status})`;
      throw new Error(message);
    }

    return data;
  }

  return await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.resend.com',
        path: '/emails',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            const data = raw ? JSON.parse(raw) : null;
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data);
            } else {
              const message = data?.message || data?.error || `Resend error (${res.statusCode})`;
              reject(new Error(message));
            }
          } catch (e) {
            reject(e);
          }
        });
      }
    );

    req.on('error', reject);
    req.write(JSON.stringify(payload));
    req.end();
  });
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

  const adminSecret = event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'];
  if (!ADMIN_SECRET) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server configuration error - admin secret not set' }),
    };
  }
  if (adminSecret !== ADMIN_SECRET) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Unauthorized - Invalid admin secret' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const to = (body.to || '').trim();

    if (!to) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'to is required' }),
      };
    }

    const from = process.env.RESEND_FROM_EMAIL;
    if (!from) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Missing RESEND_FROM_EMAIL' }),
      };
    }

    const subject = body.subject || 'ChatSpheres Test Email';
    const now = new Date();

    const html = `
      <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; padding: 24px;">
        <h2 style="margin: 0 0 12px;">ChatSpheres</h2>
        <p style="margin: 0 0 12px;">This is a test email from Resend.</p>
        <p style="margin: 0; color: #666; font-size: 12px;">Sent at ${now.toISOString()}</p>
      </div>
    `;

    const result = await sendResendEmail({
      from,
      to,
      subject,
      html,
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, result }),
    };
  } catch (error) {
    console.error('❌ send-test-email error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to send test email', message: error.message }),
    };
  }
};
