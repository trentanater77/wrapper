'use strict';

/**
 * Resend Verification Email
 * 
 * Allows users to request a new verification email.
 * Rate limited to prevent abuse.
 */

const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit, getClientIP, rateLimitResponse, RATE_LIMITS } = require('./utils/rate-limiter');

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

// Custom rate limit for verification emails (stricter)
const VERIFICATION_RATE_LIMIT = {
  windowMs: 5 * 60 * 1000,  // 5 minute window
  maxRequests: 3,            // 3 requests per 5 minutes
  name: 'verification'
};

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

  // Rate limiting - strict for email sending
  const clientIP = getClientIP(event);
  const rateLimitResult = await checkRateLimit(supabase, clientIP, VERIFICATION_RATE_LIMIT, 'resend-verification');
  if (!rateLimitResult.allowed) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({ 
        error: 'Too many verification requests',
        message: `Please wait ${rateLimitResult.retryAfter || 300} seconds before requesting another verification email.`,
        retryAfter: rateLimitResult.retryAfter
      }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { email } = body;

    if (!email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email is required' }),
      };
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid email format' }),
      };
    }

    // Get site URL for redirect
    const siteUrl = process.env.AUTH_SITE_URL || process.env.URL || 'https://chatspheres.com';

    // Resend verification email
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email,
      options: {
        emailRedirectTo: `${siteUrl}/login.html?verified=true`
      }
    });

    if (error) {
      console.error('❌ Error resending verification:', error);
      
      // Don't reveal if email exists or not for security
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'If an account exists with this email, a verification link has been sent.'
        }),
      };
    }

    console.log(`📧 Verification email resent to: ${email.substring(0, 3)}***`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Verification email sent! Please check your inbox and spam folder.'
      }),
    };

  } catch (error) {
    console.error('❌ Resend verification error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to send verification email',
        message: error.message 
      }),
    };
  }
};
