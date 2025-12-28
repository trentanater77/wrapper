'use strict';

const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const { sanitizeEmail } = require('./utils/sanitize');

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

function getAppBaseUrl() {
  const raw = (process.env.APP_BASE_URL || process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.SITE_URL || '').trim();
  return raw ? raw.replace(/\/$/, '') : '';
}

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

async function sendResendEmail({ from, to, subject, html, text, replyTo }) {
  const payload = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    ...(html ? { html } : {}),
    ...(text ? { text } : {}),
    ...(replyTo ? { reply_to: replyTo } : {}),
  };
  return resendRequest(payload);
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildCreatorWelcomeEmailHtml({ baseUrl, creatorName, supportEmail }) {
  const logoUrl = baseUrl ? `${baseUrl}/assets/icons/icon.svg` : '';
  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="Tivoq" width="28" height="28" style="display:block;width:28px;height:28px;border-radius:8px;" />`
    : '<div style="width:28px;height:28px;border-radius:8px;background:#111827;color:#ffffff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:14px;">T</div>';

  const safeName = escapeHtml(creatorName || 'Creator');
  const safeSupport = escapeHtml(supportEmail || 'support@tivoq.com');

  const createUrl = baseUrl ? `${baseUrl}/live?createRoom=1` : '/live?createRoom=1';
  const safeCreateUrl = escapeHtml(createUrl);

  const pinnedMessage = "\n\n\ud83d\udd34 CALL IN: Join the queue here \u2192 [paste your room link]\n\n\u23f1\ufe0f 3-5 min per challenger. Be respectful.\n\n\ud83d\udcb0 Tip to support the show, or buy a guaranteed slot.";

  return `
  <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; padding: 24px 12px; background: #f3f4f6;">
    <div style="max-width: 680px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 16px; overflow: hidden; background:#ffffff;">
      <div style="background: linear-gradient(135deg, #e63946 0%, #ff7a86 100%); color: #fff; padding: 18px 20px; display:flex; align-items:center; justify-content:center; gap:10px; text-align:center;">
        ${logoHtml}
        <div>
          <div style="opacity: 0.96; font-weight: 900; font-size: 16px; letter-spacing: 0.2px;">Tivoq</div>
          <div style="opacity: 0.9; font-weight: 800; font-size: 13px;">Founding Creator Program</div>
        </div>
      </div>

      <div style="padding: 18px 20px; color: #111827; font-size: 16px; line-height: 1.6;">
        <p style="margin:0 0 12px;"><strong>Welcome</strong> ${safeName} — you’re in.</p>
        <p style="margin:0 0 12px;"><strong>Host Pro is unlocked for life</strong>, and your Creator Program perks are active.</p>

        <div style="margin: 14px 0; padding: 12px 14px; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 12px;">
          <div style="font-weight: 900; margin-bottom: 6px;">Start your first show (2 minutes)</div>
          <ol style="margin: 0; padding-left: 18px;">
            <li>Create your room</li>
            <li>Copy the link</li>
            <li>Pin the link in YouTube/Twitch chat</li>
          </ol>
        </div>

        <p style="margin:0 0 16px;">
          <a href="${safeCreateUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-weight:900;padding:12px 16px;border-radius:12px;">Create your first Creator Room</a>
        </p>

        <div style="margin: 14px 0; padding: 12px 14px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px;">
          <div style="font-weight: 900; margin-bottom: 6px;">Pinned chat message (copy/paste)</div>
          <pre style="margin:0; white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 12px; line-height: 1.45;">${escapeHtml(pinnedMessage)}</pre>
        </div>

        <p style="margin: 0; color:#6b7280; font-size: 13px;">Questions or bugs? Email us anytime at <a href="mailto:${safeSupport}" style="color:#e63946; font-weight:800; text-decoration:none;">${safeSupport}</a>. Primary support is email (no meetings needed).</p>
      </div>
    </div>

    <div style="max-width:680px;margin:12px auto 0;color:#9ca3af;font-size:12px;text-align:center;">© 2026 Tivoq</div>
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

  try {
    const body = JSON.parse(event.body || '{}');
    const userId = body.userId || null;
    const code = String(body.code || '').trim();

    if (!userId || !code) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'userId and code are required' }),
      };
    }

    const { data, error } = await supabase
      .rpc('redeem_creator_program_invite', { p_user_id: userId, p_code: code });

    if (error) {
      console.error('❌ redeem_creator_program_invite error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to redeem invite', message: error.message }),
      };
    }

    if (!data || data.success !== true) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: data?.error || 'redeem_failed',
          code: data?.code || code,
        }),
      };
    }

    const status = data.status || 'redeemed';

    if (status === 'redeemed') {
      const from = process.env.RESEND_FROM_EMAIL;
      if (!from) {
        throw new Error('Missing RESEND_FROM_EMAIL');
      }

      const baseUrl = getAppBaseUrl();
      const supportEmail = process.env.RESEND_REPLY_TO_EMAIL || 'support@tivoq.com';

      let userEmail = '';
      let creatorName = '';
      try {
        const resp = await supabase.auth.admin.getUserById(userId);
        userEmail = sanitizeEmail(resp?.data?.user?.email || '');
        creatorName = resp?.data?.user?.user_metadata?.name || resp?.data?.user?.user_metadata?.full_name || '';
      } catch (e) {
        // Continue without email.
      }

      if (userEmail) {
        const subject = 'Welcome to the Tivoq Founding Creator Program';
        const html = buildCreatorWelcomeEmailHtml({ baseUrl, creatorName, supportEmail });
        await sendResendEmail({
          from,
          to: userEmail,
          subject,
          html,
          replyTo: supportEmail,
        });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        status,
        code: data.code || code,
        maxUses: data.maxUses || null,
      }),
    };
  } catch (error) {
    console.error('❌ redeem-creator-invite error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error', message: error.message }),
    };
  }
};
