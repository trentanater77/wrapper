'use strict';

/**
 * Submit Improvement Request
 * 
 * RATE LIMITED: 10 requests per minute (STRICT tier)
 * SANITIZED: XSS prevention on title, description, device_info
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
  const rateLimitResult = await checkRateLimit(supabase, clientIP, RATE_LIMITS.STRICT, 'submit-improvement-request');
  if (!rateLimitResult.allowed) {
    return rateLimitResponse(rateLimitResult, RATE_LIMITS.STRICT);
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { 
      userId, 
      userName, 
      userEmail, 
      category, 
      title,
      description, 
      deviceInfo, 
      url, 
      priority,
      timestamp 
    } = body;

    // Validate required fields
    if (!title || title.trim().length < 5) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Title must be at least 5 characters' }),
      };
    }

    if (!description || description.trim().length < 20) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Description must be at least 20 characters' }),
      };
    }

    // Valid categories
    const validCategories = ['feature', 'ui', 'performance', 'mobile', 'accessibility', 'integration', 'other'];
    const requestCategory = validCategories.includes(category) ? category : 'feature';

    // Valid priorities
    const validPriorities = ['low', 'normal', 'high'];
    const requestPriority = validPriorities.includes(priority) ? priority : 'normal';

    // Sanitize all inputs for XSS prevention
    const cleanTitle = sanitizeDisplayName(title, 200) || 'Untitled';
    const cleanDescription = sanitizeTextarea(description, 2000);
    const cleanDeviceInfo = deviceInfo ? sanitizeObject(deviceInfo, 3) : {};
    const cleanUserName = sanitizeDisplayName(userName, 50) || 'Guest';
    const cleanUrl = url ? sanitizeUrl(url) : null;

    // Insert the improvement request
    const { data: request, error: requestError } = await supabase
      .from('improvement_requests')
      .insert({
        user_id: userId || 'guest',
        user_name: cleanUserName,
        user_email: userEmail || null,
        category: requestCategory,
        title: cleanTitle,
        description: cleanDescription,
        device_info: cleanDeviceInfo,
        page_url: cleanUrl,
        priority: requestPriority,
        status: 'new',
        submitted_at: timestamp || new Date().toISOString()
      })
      .select()
      .single();

    if (requestError) {
      // Handle table not existing
      if (requestError.code === '42P01' || requestError.message?.includes('does not exist')) {
        console.log('⚠️ improvement_requests table does not exist yet');
        console.log('💡 Improvement request received (table pending):', {
          userId,
          category: requestCategory,
          title: cleanTitle.substring(0, 50) + '...'
        });
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            message: 'Improvement request noted (tables pending setup)',
          }),
        };
      }
      console.error('❌ Improvement request submission error:', requestError);
      throw requestError;
    }

    console.log(`💡 Improvement request submitted: ${userId || 'guest'} - ${requestCategory}: ${cleanTitle.substring(0, 50)}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Thank you! Your improvement request has been submitted.',
        requestId: request?.id
      }),
    };

  } catch (error) {
    console.error('❌ Submit improvement request error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to submit improvement request',
        message: error.message,
      }),
    };
  }
};
