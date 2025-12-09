'use strict';

/**
 * Submit Bug Report
 * 
 * RATE LIMITED: 10 requests per minute (STRICT tier)
 * SANITIZED: XSS prevention on description, device_info
 */

const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit, getClientIP, rateLimitResponse, RATE_LIMITS } = require('./utils/rate-limiter');
const { sanitizeTextarea, sanitizeObject, sanitizeUrl, sanitizeDisplayName } = require('./utils/sanitize');

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

  // Rate limiting - STRICT tier (10 requests/min)
  const clientIP = getClientIP(event);
  const rateLimitResult = await checkRateLimit(supabase, clientIP, RATE_LIMITS.STRICT, 'submit-bug-report');
  if (!rateLimitResult.allowed) {
    return rateLimitResponse(rateLimitResult, RATE_LIMITS.STRICT);
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { 
      userId, 
      userName, 
      userEmail, 
      roomId, 
      category, 
      description, 
      deviceInfo, 
      url, 
      isSpectator,
      timestamp 
    } = body;

    // Validate required fields
    if (!description || description.trim().length < 10) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Description must be at least 10 characters' }),
      };
    }

    // Valid categories
    const validCategories = ['video', 'audio', 'connection', 'chat', 'ui', 'performance', 'other'];
    const bugCategory = validCategories.includes(category) ? category : 'other';

    // Sanitize all inputs for XSS prevention
    const cleanDescription = sanitizeTextarea(description, 1000);
    const cleanDeviceInfo = deviceInfo ? sanitizeObject(deviceInfo, 3) : {};
    const cleanUserName = sanitizeDisplayName(userName, 50) || 'Guest';
    const cleanUrl = url ? sanitizeUrl(url) : null;

    // Insert the bug report
    const { data: report, error: reportError } = await supabase
      .from('bug_reports')
      .insert({
        user_id: userId || 'guest',
        user_name: cleanUserName,
        user_email: userEmail || null,
        room_id: roomId || null,
        category: bugCategory,
        description: cleanDescription,
        device_info: cleanDeviceInfo,
        page_url: cleanUrl,
        is_spectator: isSpectator || false,
        status: 'new',
        reported_at: timestamp || new Date().toISOString()
      })
      .select()
      .single();

    if (reportError) {
      // Handle table not existing
      if (reportError.code === '42P01' || reportError.message?.includes('does not exist')) {
        console.log('⚠️ bug_reports table does not exist yet');
        console.log('📝 Bug report received (table pending):', {
          userId,
          category: bugCategory,
          description: description.substring(0, 100) + '...'
        });
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            message: 'Bug report noted (tables pending setup)',
          }),
        };
      }
      console.error('❌ Bug report submission error:', reportError);
      throw reportError;
    }

    console.log(`🐛 Bug report submitted: ${userId || 'guest'} reported ${bugCategory} issue`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Bug report submitted successfully',
        reportId: report?.id
      }),
    };

  } catch (error) {
    console.error('❌ Submit bug report error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to submit bug report',
        message: error.message,
      }),
    };
  }
};
