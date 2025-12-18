'use strict';

const crypto = require('crypto');
const https = require('https');

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

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildConfirmEmailHtml({ subject, confirmUrl, baseUrl }) {
  const safeSubject = sanitizeText(subject || '', 160);
  const logoUrl = baseUrl ? `${baseUrl}/assets/icons/icon.svg` : '';
  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="ChatSpheres" width="28" height="28" style="display:block;width:28px;height:28px;border-radius:6px;" />`
    : '<div style="font-size:18px;font-weight:900;letter-spacing:0.2px;">ChatSpheres</div>';

  return `
  <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; padding: 24px 12px; background: #ffffff;">
    <div style="max-width: 680px; margin: 0 auto; border: 1px solid #f1f1f1; border-radius: 16px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #e63946 0%, #ff7a86 100%); color: #fff; padding: 18px 20px; display:flex; align-items:center; gap:10px;">
        ${logoHtml}
        <div style="flex:1;">
          <div style="opacity: 0.92; font-weight: 800;">${escapeHtml(safeSubject)}</div>
        </div>
      </div>
      <div style="padding: 18px 20px; color: #111827; font-size: 16px; line-height: 1.6;">
        <p style="margin:0 0 12px;">Confirm your email to start receiving ChatSpheres updates.</p>
        <p style="margin:0 0 16px;">
          <a href="${confirmUrl}" style="display:inline-block;background:#e63946;color:#ffffff;text-decoration:none;font-weight:800;padding:12px 16px;border-radius:999px;">Confirm subscription</a>
        </p>
        <p style="margin:0 0 12px; color:#6b7280; font-size: 13px;">If you did not request this, you can ignore this email.</p>
      </div>
    </div>
    <div style="max-width:680px;margin:12px auto 0;color:#9ca3af;font-size:12px;text-align:center;">© ${new Date().getFullYear()} ChatSpheres</div>
  </div>`;
}

function buildConfirmEmailText({ confirmUrl }) {
  return `Confirm your ChatSpheres subscription:\n${confirmUrl}\n\nIf you did not request this, you can ignore this email.`;
}

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
    .select('id, email, user_id, status, unsubscribe_token, confirm_token, confirmed_at')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (existingErr) throw existingErr;

  const nowIso = new Date().toISOString();

  if (existing) {
    if (existing.status === 'subscribed' && existing.confirmed_at) {
      const { error: updateErr } = await supabase
        .from('marketing_subscribers')
        .update({
          user_id: userId || existing.user_id || null,
          updated_at: nowIso,
          ...(cleanSource ? { source: cleanSource } : {}),
        })
        .eq('id', existing.id);

      if (updateErr) throw updateErr;

      return {
        email: normalizedEmail,
        status: 'subscribed',
        unsubscribe_token: existing.unsubscribe_token,
        confirm_token: null,
      };
    }

    const confirmToken = crypto.randomBytes(24).toString('hex');
    const { error: updateErr } = await supabase
      .from('marketing_subscribers')
      .update({
        user_id: userId || existing.user_id || null,
        status: 'pending',
        confirm_token: confirmToken,
        confirmed_at: null,
        optin_requested_at: nowIso,
        unsubscribed_at: null,
        updated_at: nowIso,
        ...(cleanSource ? { source: cleanSource } : {}),
      })
      .eq('id', existing.id);

    if (updateErr) throw updateErr;

    return {
      email: normalizedEmail,
      status: 'pending',
      unsubscribe_token: existing.unsubscribe_token,
      confirm_token: confirmToken,
    };
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const unsubscribeToken = crypto.randomBytes(24).toString('hex');
    const confirmToken = crypto.randomBytes(24).toString('hex');

    const { data: inserted, error: insertErr } = await supabase
      .from('marketing_subscribers')
      .insert({
        user_id: userId || null,
        email: normalizedEmail,
        status: 'pending',
        unsubscribe_token: unsubscribeToken,
        confirm_token: confirmToken,
        confirmed_at: null,
        optin_requested_at: nowIso,
        ...(cleanSource ? { source: cleanSource } : {}),
        subscribed_at: nowIso,
        updated_at: nowIso,
      })
      .select('email, status, unsubscribe_token, confirm_token')
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

    const from = process.env.RESEND_FROM_EMAIL;
    if (!from) {
      throw new Error('Missing RESEND_FROM_EMAIL');
    }

    const unsubscribeUrl = result.unsubscribe_token
      ? (baseUrl
        ? `${baseUrl}/.netlify/functions/marketing-unsubscribe?token=${encodeURIComponent(result.unsubscribe_token)}`
        : `/.netlify/functions/marketing-unsubscribe?token=${encodeURIComponent(result.unsubscribe_token)}`)
      : '';

    const confirmUrl = result.confirm_token
      ? (baseUrl
        ? `${baseUrl}/.netlify/functions/marketing-confirm?token=${encodeURIComponent(result.confirm_token)}`
        : `/.netlify/functions/marketing-confirm?token=${encodeURIComponent(result.confirm_token)}`)
      : '';

    if (result.status === 'pending' && confirmUrl) {
      const subject = 'Confirm your subscription to ChatSpheres';
      const html = buildConfirmEmailHtml({ subject, confirmUrl, baseUrl });
      const text = buildConfirmEmailText({ confirmUrl });
      await sendResendEmail({ from, to: result.email, subject, html, text });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        email: result.email,
        status: result.status,
        ...(unsubscribeUrl ? { unsubscribeUrl } : {}),
        ...(confirmUrl ? { confirmUrl } : {}),
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
