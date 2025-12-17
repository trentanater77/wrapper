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

async function sendResendEmail({ from, to, subject, html, text }) {
  const payload = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    ...(html ? { html } : {}),
    ...(text ? { text } : {}),
  };

  return resendRequest(payload);
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

function buildReminderHtml({ title, hostName, timeDisplay, ctaUrl, ctaLabel, subtitle }) {
  return `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; padding: 24px; background: #ffffff;">
      <div style="max-width: 560px; margin: 0 auto; border: 1px solid #eee; border-radius: 12px; overflow: hidden;">
        <div style="background: #e63946; color: #fff; padding: 18px 20px;">
          <div style="font-size: 18px; font-weight: 800;">ChatSpheres</div>
          <div style="opacity: 0.9; margin-top: 4px;">${subtitle}</div>
        </div>
        <div style="padding: 18px 20px;">
          <div style="font-size: 18px; font-weight: 800; margin-bottom: 6px;">${title}</div>
          <div style="color: #444; margin-bottom: 10px;">Hosted by <strong>${hostName}</strong></div>
          <div style="color: #444; margin-bottom: 18px;">Time: <strong>${timeDisplay}</strong></div>

          <a href="${ctaUrl}" style="display: inline-block; background: #111827; color: #fff; text-decoration: none; padding: 12px 16px; border-radius: 10px; font-weight: 700;">${ctaLabel}</a>

          <div style="margin-top: 18px; color: #6b7280; font-size: 12px;">
            If you didn’t request reminders, you can ignore this email.
          </div>
        </div>
      </div>
    </div>
  `;
}

async function sendTMinus10(now) {
  const from = process.env.RESEND_FROM_EMAIL;
  const baseUrl = process.env.APP_BASE_URL;
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

      if (!toEmail && r.user_id) {
        const userEmail = await getEmailForUserId(r.user_id);
        toEmail = sanitizeEmail(userEmail);

        if (toEmail) {
          await supabase
            .from('event_reminders')
            .update({ email: toEmail })
            .eq('id', r.id);
        }
      }

      if (!toEmail) continue;

      const ctaUrl = `${baseUrl}/live.html`;
      const html = buildReminderHtml({
        title: evt.title,
        hostName: evt.host_name || 'Host',
        timeDisplay: formatEventTime(evt.scheduled_at),
        ctaUrl,
        ctaLabel: 'View event',
        subtitle: 'Reminder: starts soon',
      });

      try {
        await sendResendEmail({
          from,
          to: toEmail,
          subject: `Reminder: ${evt.title} starts soon`,
          html,
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
  const baseUrl = process.env.APP_BASE_URL;
  if (!from) throw new Error('Missing RESEND_FROM_EMAIL');
  if (!baseUrl) throw new Error('Missing APP_BASE_URL');

  const since = new Date(now.getTime() - 10 * 60 * 1000).toISOString();

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
    });

    for (const r of reminders) {
      let toEmail = sanitizeEmail(r.email);

      if (!toEmail && r.user_id) {
        const userEmail = await getEmailForUserId(r.user_id);
        toEmail = sanitizeEmail(userEmail);

        if (toEmail) {
          await supabase
            .from('event_reminders')
            .update({ email: toEmail })
            .eq('id', r.id);
        }
      }

      if (!toEmail) continue;

      try {
        await sendResendEmail({
          from,
          to: toEmail,
          subject: `Live now: ${evt.title}`,
          html,
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
