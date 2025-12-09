'use strict';

/**
 * Rate Limiter Utility
 * 
 * Provides rate limiting for API endpoints using Supabase.
 * Tracks requests per IP/user and enforces configurable limits.
 * 
 * Usage:
 *   const { checkRateLimit, RATE_LIMITS } = require('./utils/rate-limiter');
 *   const rateLimitResult = await checkRateLimit(supabase, identifier, RATE_LIMITS.STANDARD);
 *   if (!rateLimitResult.allowed) {
 *     return { statusCode: 429, body: JSON.stringify({ error: 'Too many requests' }) };
 *   }
 */

// Predefined rate limit configurations
const RATE_LIMITS = {
  // Standard API calls (most endpoints)
  STANDARD: {
    windowMs: 60 * 1000,      // 1 minute window
    maxRequests: 60,          // 60 requests per minute
    name: 'standard'
  },
  // Strict limits for sensitive operations
  STRICT: {
    windowMs: 60 * 1000,      // 1 minute window
    maxRequests: 10,          // 10 requests per minute
    name: 'strict'
  },
  // For authentication attempts
  AUTH: {
    windowMs: 15 * 60 * 1000, // 15 minute window
    maxRequests: 10,          // 10 attempts per 15 minutes
    name: 'auth'
  },
  // For financial operations (tips, payouts)
  FINANCIAL: {
    windowMs: 60 * 1000,      // 1 minute window
    maxRequests: 20,          // 20 per minute
    name: 'financial'
  },
  // For creation operations (forums, rooms)
  CREATE: {
    windowMs: 60 * 60 * 1000, // 1 hour window
    maxRequests: 30,          // 30 per hour
    name: 'create'
  },
  // For search/list operations
  SEARCH: {
    windowMs: 60 * 1000,      // 1 minute window
    maxRequests: 120,         // 120 per minute (2 per second)
    name: 'search'
  },
  // Very lenient for read operations
  READ: {
    windowMs: 60 * 1000,      // 1 minute window
    maxRequests: 300,         // 300 per minute (5 per second)
    name: 'read'
  }
};

/**
 * Check rate limit for an identifier
 * 
 * @param {object} supabase - Supabase client
 * @param {string} identifier - IP address or user ID
 * @param {object} config - Rate limit config from RATE_LIMITS
 * @param {string} endpoint - Optional endpoint name for more granular tracking
 * @returns {object} { allowed: boolean, remaining: number, resetAt: Date }
 */
async function checkRateLimit(supabase, identifier, config = RATE_LIMITS.STANDARD, endpoint = 'default') {
  if (!supabase || !identifier) {
    // If no supabase or identifier, allow the request (fail open for availability)
    console.warn('⚠️ Rate limiter: missing supabase or identifier, allowing request');
    return { allowed: true, remaining: config.maxRequests, resetAt: new Date() };
  }

  const now = Date.now();
  const windowStart = now - config.windowMs;
  const key = `${config.name}:${endpoint}:${identifier}`;

  try {
    // Clean up old entries (older than window)
    await supabase
      .from('rate_limits')
      .delete()
      .lt('expires_at', new Date().toISOString());

    // Get current request count in window
    const { data: existing, error: selectError } = await supabase
      .from('rate_limits')
      .select('request_count, window_start, expires_at')
      .eq('key', key)
      .single();

    if (selectError && selectError.code !== 'PGRST116') {
      // PGRST116 = no rows returned, which is fine
      // Table might not exist yet - allow request
      if (selectError.code === '42P01' || selectError.message?.includes('does not exist')) {
        console.log('ℹ️ rate_limits table not found, allowing request');
        return { allowed: true, remaining: config.maxRequests, resetAt: new Date() };
      }
      console.error('Rate limit select error:', selectError);
      // Fail open - allow request on error
      return { allowed: true, remaining: config.maxRequests, resetAt: new Date() };
    }

    const expiresAt = new Date(now + config.windowMs).toISOString();

    if (existing) {
      const windowStartTime = new Date(existing.window_start).getTime();
      
      // Check if we're still in the same window
      if (windowStartTime > windowStart) {
        // Same window - check count
        if (existing.request_count >= config.maxRequests) {
          // Rate limited!
          const resetAt = new Date(existing.expires_at);
          const remaining = 0;
          console.log(`🚫 Rate limited: ${key} (${existing.request_count}/${config.maxRequests})`);
          return { 
            allowed: false, 
            remaining, 
            resetAt,
            retryAfter: Math.ceil((resetAt.getTime() - now) / 1000)
          };
        }

        // Increment counter
        await supabase
          .from('rate_limits')
          .update({ 
            request_count: existing.request_count + 1,
            updated_at: new Date().toISOString()
          })
          .eq('key', key);

        const remaining = config.maxRequests - existing.request_count - 1;
        return { allowed: true, remaining, resetAt: new Date(existing.expires_at) };
      } else {
        // Window expired, reset counter
        await supabase
          .from('rate_limits')
          .update({ 
            request_count: 1,
            window_start: new Date().toISOString(),
            expires_at: expiresAt,
            updated_at: new Date().toISOString()
          })
          .eq('key', key);

        return { allowed: true, remaining: config.maxRequests - 1, resetAt: new Date(expiresAt) };
      }
    } else {
      // First request - create entry
      await supabase
        .from('rate_limits')
        .insert({
          key,
          identifier,
          endpoint,
          limit_type: config.name,
          request_count: 1,
          window_start: new Date().toISOString(),
          expires_at: expiresAt
        });

      return { allowed: true, remaining: config.maxRequests - 1, resetAt: new Date(expiresAt) };
    }
  } catch (error) {
    console.error('Rate limit error:', error);
    // Fail open - allow request on error
    return { allowed: true, remaining: config.maxRequests, resetAt: new Date() };
  }
}

/**
 * Get client IP from request headers
 * Works with Netlify's proxy headers
 */
function getClientIP(event) {
  const headers = event.headers || {};
  return headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         headers['x-real-ip'] ||
         headers['client-ip'] ||
         'unknown';
}

/**
 * Create rate limit response headers
 */
function getRateLimitHeaders(result, config) {
  return {
    'X-RateLimit-Limit': String(config.maxRequests),
    'X-RateLimit-Remaining': String(Math.max(0, result.remaining)),
    'X-RateLimit-Reset': String(Math.floor(result.resetAt.getTime() / 1000)),
    ...(result.retryAfter ? { 'Retry-After': String(result.retryAfter) } : {})
  };
}

/**
 * Create a 429 Too Many Requests response
 */
function rateLimitResponse(result, config) {
  return {
    statusCode: 429,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      ...getRateLimitHeaders(result, config)
    },
    body: JSON.stringify({
      error: 'Too many requests',
      message: `Rate limit exceeded. Please try again in ${result.retryAfter || 60} seconds.`,
      retryAfter: result.retryAfter
    })
  };
}

module.exports = {
  checkRateLimit,
  getClientIP,
  getRateLimitHeaders,
  rateLimitResponse,
  RATE_LIMITS
};
