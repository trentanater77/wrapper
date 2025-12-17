'use strict';

const https = require('https');

const { createClient } = require('@supabase/supabase-js');
const { sanitizeEmail, sanitizeText, sanitizeTextarea } = require('./utils/sanitize');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ADMIN_SECRET = process.env.ADMIN_SECRET;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function resendRequest(payload) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return reject(new Error('Missing RESEND_API_KEY'));

    if (typeof fetch === 'function') {
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
        .then(async (resp) => {
          const data = await resp.json().catch(() => null);
          if (!resp.ok) {
            const message = data?.message || data?.error || `Resend error (${resp.status})`;
            throw new Error(message);
          }
          return data;
        })
        .then(resolve)
        .catch(reject);
      return;
    }

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

async function sendResendEmail({ from, to, subject, html, text, extraHeaders }) {
  const payload = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    ...(html ? { html } : {}),
    ...(text ? { text } : {}),
    ...(extraHeaders ? { headers: extraHeaders } : {}),
  };

  return resendRequest(payload);
}

function appendUnsubscribeHtml(html, unsubscribeUrl) {
  if (!unsubscribeUrl) return html;
  return `${html}
<div style="margin-top: 18px; color: #6b7280; font-size: 12px; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">
  <div>If you no longer want these emails, you can <a href="${unsubscribeUrl}">unsubscribe</a>.</div>
</div>`;
}

function appendUnsubscribeText(text, unsubscribeUrl) {
  if (!unsubscribeUrl) return text;
  return `${text}\n\nUnsubscribe: ${unsubscribeUrl}`;
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

    const from = process.env.RESEND_FROM_EMAIL;
    if (!from) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Missing RESEND_FROM_EMAIL' }),
      };
    }

    const baseUrl = process.env.APP_BASE_URL || '';

    const subject = sanitizeText(body.subject || '', 160);
    let html = typeof body.html === 'string' ? body.html : '';
    let text = sanitizeTextarea(body.text || '', 20000);

    if (!subject) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'subject is required' }),
      };
    }

    if (!html && !text) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'html or text is required' }),
      };
    }

    const testTo = sanitizeEmail(body.to || '');
    const max = Number.isFinite(body.max) ? Number(body.max) : 100;

    let recipients = [];

    if (testTo) {
      recipients = [{ email: testTo, unsubscribe_token: null }];
    } else {
      const { data, error } = await supabase
        .from('marketing_subscribers')
        .select('email, unsubscribe_token')
        .eq('status', 'subscribed')
        .limit(Math.max(1, Math.min(500, max)));

      if (error) throw error;
      recipients = (data || []).map((r) => ({
        email: sanitizeEmail(r.email),
        unsubscribe_token: r.unsubscribe_token,
      })).filter(r => !!r.email);
    }

    const results = {
      attempted: recipients.length,
      sent: 0,
      failed: 0,
      failures: [],
    };

    for (const r of recipients) {
      const unsubscribeUrl = r.unsubscribe_token
        ? (baseUrl
          ? `${baseUrl}/.netlify/functions/marketing-unsubscribe?token=${encodeURIComponent(r.unsubscribe_token)}`
          : `/.netlify/functions/marketing-unsubscribe?token=${encodeURIComponent(r.unsubscribe_token)}`)
        : '';

      const emailHtml = html ? appendUnsubscribeHtml(html, unsubscribeUrl) : '';
      const emailText = text ? appendUnsubscribeText(text, unsubscribeUrl) : '';

      try {
        await sendResendEmail({
          from,
          to: r.email,
          subject,
          html: emailHtml || undefined,
          text: emailText || undefined,
          extraHeaders: unsubscribeUrl ? { 'List-Unsubscribe': `<${unsubscribeUrl}>` } : undefined,
        });
        results.sent++;
      } catch (e) {
        results.failed++;
        results.failures.push({ email: r.email, error: e.message });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, results }),
    };
  } catch (error) {
    console.error('❌ send-branded-email error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to send branded email', message: error.message }),
    };
  }
};
