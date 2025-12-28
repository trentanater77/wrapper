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

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlToText(html) {
  const raw = String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/p\s*>/gi, '\n\n')
    .replace(/<\s*p\b[^>]*>/gi, '')
    .replace(/<\s*li\b[^>]*>/gi, '• ')
    .replace(/<\s*\/li\s*>/gi, '\n')
    .replace(/<\s*\/ul\s*>/gi, '\n')
    .replace(/<\s*\/ol\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  return raw.replace(/\n{3,}/g, '\n\n').trim();
}

function textToHtml(text) {
  const safe = escapeHtml(text);
  const withBreaks = safe.replace(/\n/g, '<br/>');
  return `<div style="font-size:16px;line-height:1.6;">${withBreaks}</div>`;
}

function wrapMarketingHtml(innerHtml, subject, logoUrl) {
  const safeSubject = sanitizeText(subject || '', 160);
  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="Tivoq" width="28" height="28" style="display:block;width:28px;height:28px;border-radius:6px;" />`
    : '<div style="font-size: 18px; font-weight: 900; letter-spacing: 0.2px;">Tivoq</div>';
  return `
  <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; padding: 24px 12px; background: #ffffff;">
    <div style="max-width: 680px; margin: 0 auto; border: 1px solid #f1f1f1; border-radius: 16px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #e63946 0%, #ff7a86 100%); color: #fff; padding: 18px 20px; display:flex; align-items:center; gap:10px;">
        ${logoHtml}
        <div style="flex:1;">
          <div style="opacity: 0.92; font-weight: 800;">${escapeHtml(safeSubject)}</div>
        </div>
      </div>
      <div style="padding: 18px 20px; color: #111827;">
        ${innerHtml}
      </div>
    </div>
    <div style="max-width:680px;margin:12px auto 0;color:#9ca3af;font-size:12px;text-align:center;">
      © 2026 Tivoq
    </div>
  </div>`;
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
    const wrap = body.wrap !== false;

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

    if (!html && text) {
      html = textToHtml(text);
    }
    if (!text && html) {
      text = htmlToText(html);
    }

    const testTo = sanitizeEmail(body.to || '');
    const max = Number.isFinite(body.max) ? Number(body.max) : 100;

    let recipients = [];

    if (testTo) {
      recipients = [{ email: testTo, unsubscribe_token: null }];
    } else {
      const { data, error } = await supabase
        .from('marketing_subscribers')
        .select('email, unsubscribe_token, confirmed_at, unsubscribed_at')
        .eq('status', 'subscribed')
        .not('confirmed_at', 'is', null)
        .is('unsubscribed_at', null)
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

      const logoUrl = baseUrl ? `${baseUrl}/assets/icons/icon.svg` : '';

      const baseHtml = html ? (wrap ? wrapMarketingHtml(html, subject, logoUrl) : html) : '';
      const emailHtml = baseHtml ? appendUnsubscribeHtml(baseHtml, unsubscribeUrl) : '';
      const emailText = text ? appendUnsubscribeText(text, unsubscribeUrl) : '';

      try {
        await sendResendEmail({
          from,
          to: r.email,
          subject,
          html: emailHtml || undefined,
          text: emailText || undefined,
          extraHeaders: unsubscribeUrl
            ? { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
            : undefined,
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
