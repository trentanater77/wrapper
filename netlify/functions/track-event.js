'use strict';

/**
 * Track Event - Simple Free Analytics
 * 
 * Tracks page views, events, and user actions in Supabase.
 * No external analytics service needed!
 * 
 * RATE LIMITED: 300 requests per minute (very lenient)
 */

const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit, getClientIP, rateLimitResponse, RATE_LIMITS } = require('./utils/rate-limiter');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

// Very lenient rate limit for analytics
const ANALYTICS_RATE_LIMIT = {
  windowMs: 60 * 1000,
  maxRequests: 300,
  name: 'analytics'
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Light rate limiting
  const clientIP = getClientIP(event);
  const rateLimitResult = await checkRateLimit(supabase, clientIP, ANALYTICS_RATE_LIMIT, 'track-event');
  if (!rateLimitResult.allowed) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }; // Silently ignore
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { 
      eventType = 'page_view',
      page,
      referrer,
      userId,
      sessionId,
      data = {}
    } = body;

    // Get user agent and other info
    const userAgent = event.headers['user-agent'] || '';
    const country = event.headers['x-country'] || event.headers['cf-ipcountry'] || null;

    // Parse user agent for device info
    const isMobile = /Mobile|Android|iPhone|iPad/i.test(userAgent);
    const isTablet = /Tablet|iPad/i.test(userAgent);
    const deviceType = isTablet ? 'tablet' : (isMobile ? 'mobile' : 'desktop');

    // Parse browser
    let browser = 'unknown';
    if (userAgent.includes('Chrome')) browser = 'chrome';
    else if (userAgent.includes('Safari')) browser = 'safari';
    else if (userAgent.includes('Firefox')) browser = 'firefox';
    else if (userAgent.includes('Edge')) browser = 'edge';

    // Insert analytics event
    const { error } = await supabase
      .from('analytics_events')
      .insert({
        event_type: eventType,
        page: page?.slice(0, 500),
        referrer: referrer?.slice(0, 500),
        user_id: userId || null,
        session_id: sessionId || null,
        ip_hash: await hashIP(clientIP), // Store hash, not actual IP
        country,
        device_type: deviceType,
        browser,
        user_agent: userAgent.slice(0, 500),
        event_data: data,
        created_at: new Date().toISOString()
      });

    if (error) {
      // Table might not exist yet - that's OK
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }
      console.error('Analytics error:', error);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true }),
    };

  } catch (error) {
    // Never fail analytics - just log
    console.error('Track event error:', error);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true }),
    };
  }
};

// Simple hash function for IP anonymization
async function hashIP(ip) {
  const encoder = new TextEncoder();
  const data = encoder.encode(ip + 'chatspheres-salt');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}
