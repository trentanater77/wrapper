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
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

function formatEventTime(iso) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
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

function buildReminderHtml({ title, hostName, timeDisplay, ctaUrl, ctaLabel, subtitle, roomTypeLabel }) {
  const safeTitle = escapeHtml(title);
  const safeHost = escapeHtml(hostName);
  const safeTime = escapeHtml(timeDisplay);
  const safeSubtitle = escapeHtml(subtitle);
  const safeRoomType = roomTypeLabel ? escapeHtml(roomTypeLabel) : '';
  const safeCtaLabel = escapeHtml(ctaLabel);
  const safeCtaUrl = escapeHtml(ctaUrl);

  return `
  <div style="margin:0;padding:0;background:#ffffff;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${safeSubtitle} — ${safeTitle}
    </div>
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; padding: 24px 12px; background: #ffffff;">
      <div style="max-width: 600px; margin: 0 auto; border: 1px solid #f1f1f1; border-radius: 16px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #e63946 0%, #ff7a86 100%); color: #fff; padding: 18px 20px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:36px;height:36px;border-radius:12px;background:rgba(255,255,255,0.18);display:flex;align-items:center;justify-content:center;">
              <span style="font-size:18px;">💬</span>
            </div>
            <div>
              <div style="font-size: 18px; font-weight: 900; letter-spacing: 0.2px;">Tivoq</div>
              <div style="opacity: 0.92; margin-top: 2px; font-weight: 700;">${safeSubtitle}</div>
            </div>
          </div>
        </div>

        <div style="padding: 18px 20px 20px; background:#ffffff;">
          ${safeRoomType ? `<div style="display:inline-block;background:#fce2e5;color:#22223B;border:1px solid #ffb6b9;padding:6px 10px;border-radius:999px;font-size:12px;font-weight:800;">${safeRoomType}</div>` : ''}

          <div style="font-size: 20px; font-weight: 900; margin: 10px 0 6px; color:#111827; line-height:1.25;">${safeTitle}</div>
          <div style="color: #374151; margin-bottom: 10px;">Hosted by <strong>${safeHost}</strong></div>
          <div style="color: #374151; margin-bottom: 16px;">Time: <strong>${safeTime}</strong></div>

          <a href="${safeCtaUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 16px;border-radius:12px;font-weight:900;">${safeCtaLabel}</a>

          <div style="margin-top: 16px; padding-top: 14px; border-top: 1px solid #f3f4f6; color: #6b7280; font-size: 12px; line-height: 1.5;">
            Manage reminders anytime from <a href="${escapeHtml(process.env.APP_BASE_URL || process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.SITE_URL || '')}/live.html" style="color:#e63946;">Live</a>.
            <br/>If you didn’t request reminders, you can ignore this email.
          </div>
        </div>
      </div>
      <div style="max-width:600px;margin:12px auto 0;color:#9ca3af;font-size:12px;text-align:center;font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">
        © 2026 Tivoq
      </div>
    </div>
  </div>
  `;
}

function buildReminderText({ title, hostName, timeDisplay, ctaUrl, subtitle }) {
  return `Tivoq — ${subtitle}

${title}
Hosted by: ${hostName}
Time: ${timeDisplay}

Open: ${ctaUrl}

If you didn’t request reminders, you can ignore this email.`;
}

function formatRoomTypeLabel(roomType) {
  if (!roomType) return '';
  const v = String(roomType).toLowerCase();
  if (v === 'creator') return '⭐ Creator';
  if (v === 'red') return '🔥 Debate';
  if (v === 'help') return '🫶 Help';
  return roomType;
}

async function sendTMinus10(now) {
  const from = process.env.RESEND_FROM_EMAIL;
  const replyTo = process.env.RESEND_REPLY_TO_EMAIL || 'support@tivoq.com';
  const baseUrl = getAppBaseUrl();
  if (!from) throw new Error('Missing RESEND_FROM_EMAIL');
  if (!baseUrl) throw new Error('Missing APP_BASE_URL');

  const start = new Date(now.getTime() + 8 * 60 * 1000).toISOString();
  const end = new Date(now.getTime() + 12 * 60 * 1000).toISOString();

  const { data: events, error } = await supabase
    .from('scheduled_events')
    .select('id,title,host_name,scheduled_at,room_type')
    .eq('status', 'scheduled')
    .gte('scheduled_at', start)
    .lte('scheduled_at', end)
    .limit(25);

  if (error) throw error;
  if (!events?.length) return { sent: 0, events: 0 };

  let sent = 0;

  for (const evt of events) {
    const { data: reminders, error: rErr } = await supabase
      .from('event_reminders')
      .select('id,email,user_id')
      .eq('event_id', evt.id)
      .eq('notify_email', true)
      .is('sent_tminus10_at', null)
      .limit(200);

    if (rErr) {
      console.error('❌ Reminder fetch error:', rErr);
      continue;
    }

    if (!reminders?.length) continue;

    for (const r of reminders) {
      let toEmail = sanitizeEmail(r.email);

      if (!toEmail) continue;

      const ctaUrl = `${baseUrl}/live.html`;
      const html = buildReminderHtml({
        title: evt.title,
        hostName: evt.host_name || 'Host',
        timeDisplay: formatEventTime(evt.scheduled_at),
        ctaUrl,
        ctaLabel: 'View event',
        subtitle: 'Reminder: starts soon',
        roomTypeLabel: formatRoomTypeLabel(evt.room_type),
      });
      const text = buildReminderText({
        title: evt.title,
        hostName: evt.host_name || 'Host',
        timeDisplay: formatEventTime(evt.scheduled_at),
        ctaUrl,
        subtitle: 'Reminder: starts soon',
      });

      try {
        await sendResendEmail({
          from,
          replyTo,
          to: toEmail,
          subject: `Reminder: ${evt.title} starts soon`,
          html,
          text,
        });

        await supabase
          .from('event_reminders')
          .update({ sent_tminus10_at: new Date().toISOString() })
          .eq('id', r.id)
          .is('sent_tminus10_at', null);

        sent++;
      } catch (e) {
        console.error('❌ Failed to send T-10 reminder:', e.message);
      }
    }
  }

  return { sent, events: events.length };
}

async function sendLiveNow(now) {
  const from = process.env.RESEND_FROM_EMAIL;
  const replyTo = process.env.RESEND_REPLY_TO_EMAIL || 'support@tivoq.com';
  const baseUrl = getAppBaseUrl();
  if (!from) throw new Error('Missing RESEND_FROM_EMAIL');
  if (!baseUrl) throw new Error('Missing APP_BASE_URL');

  const since = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

  const { data: events, error } = await supabase
    .from('scheduled_events')
    .select('id,title,host_name,scheduled_at,room_type,status,room_id,went_live_at')
    .eq('status', 'live')
    .not('went_live_at', 'is', null)
    .gte('went_live_at', since)
    .lte('went_live_at', now.toISOString())
    .limit(25);

  if (error) throw error;
  if (!events?.length) return { sent: 0, events: 0 };

  let sent = 0;

  for (const evt of events) {
    const { data: reminders, error: rErr } = await supabase
      .from('event_reminders')
      .select('id,email,user_id')
      .eq('event_id', evt.id)
      .eq('notify_email', true)
      .is('sent_live_at', null)
      .limit(200);

    if (rErr) {
      console.error('❌ Live reminder fetch error:', rErr);
      continue;
    }

    if (!reminders?.length) continue;

    const hasRoom = !!evt.room_id;
    const ctaUrl = hasRoom
      ? `${baseUrl}/index.html?room=${encodeURIComponent(evt.room_id)}&mode=spectator&roomType=${encodeURIComponent(evt.room_type || 'creator')}`
      : `${baseUrl}/live.html`;

    const html = buildReminderHtml({
      title: evt.title,
      hostName: evt.host_name || 'Host',
      timeDisplay: formatEventTime(evt.scheduled_at),
      ctaUrl,
      ctaLabel: hasRoom ? 'Join now' : 'View event',
      subtitle: 'Live now',
      roomTypeLabel: formatRoomTypeLabel(evt.room_type),
    });
    const text = buildReminderText({
      title: evt.title,
      hostName: evt.host_name || 'Host',
      timeDisplay: formatEventTime(evt.scheduled_at),
      ctaUrl,
      subtitle: 'Live now',
    });

    for (const r of reminders) {
      let toEmail = sanitizeEmail(r.email);

      if (!toEmail) continue;

      try {
        await sendResendEmail({
          from,
          replyTo,
          to: toEmail,
          subject: `Live now: ${evt.title}`,
          html,
          text,
        });

        await supabase
          .from('event_reminders')
          .update({ sent_live_at: new Date().toISOString() })
          .eq('id', r.id)
          .is('sent_live_at', null);

        sent++;
      } catch (e) {
        console.error('❌ Failed to send live reminder:', e.message);
      }
    }
  }

  return { sent, events: events.length };
}

exports.handler = async function(event) {
  if (event?.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const now = new Date();

  try {
    const tminus10 = await sendTMinus10(now);
    const liveNow = await sendLiveNow(now);

    const summary = {
      success: true,
      at: now.toISOString(),
      tminus10,
      liveNow,
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(summary),
    };
  } catch (error) {
    console.error('❌ send-event-reminders error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to send event reminders', message: error.message }),
    };
  }
};
