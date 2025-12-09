'use strict';

/**
 * Submit Report - Report a user for misconduct
 * 
 * RATE LIMITED: 10 requests per minute (STRICT tier) to prevent abuse
 * SANITIZED: XSS prevention on description
 */

const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit, getClientIP, rateLimitResponse, RATE_LIMITS } = require('./utils/rate-limiter');
const { sanitizeTextarea } = require('./utils/sanitize');

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

// Auto-suspend threshold
const REPORTS_FOR_SUSPENSION = 3;
const REPORT_WINDOW_DAYS = 7;

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

  // Rate limiting - STRICT tier (10 requests/min) to prevent report spam
  const clientIP = getClientIP(event);
  const rateLimitResult = await checkRateLimit(supabase, clientIP, RATE_LIMITS.STRICT, 'submit-report');
  if (!rateLimitResult.allowed) {
    return rateLimitResponse(rateLimitResult, RATE_LIMITS.STRICT);
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { reporterId, reportedId, roomId, category, description } = body;

    // Validate required fields
    if (!reporterId || !reportedId || !category) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields: reporterId, reportedId, category' }),
      };
    }

    // Validate category
    const validCategories = ['inappropriate', 'harassment', 'underage', 'spam', 'other'];
    if (!validCategories.includes(category)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: `Category must be one of: ${validCategories.join(', ')}` }),
      };
    }

    // Can't report yourself
    if (reporterId === reportedId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Cannot report yourself' }),
      };
    }

    // Check if already reported by this user recently (prevent spam reports)
    const { data: existingReport } = await supabase
      .from('user_reports')
      .select('id')
      .eq('reporter_id', reporterId)
      .eq('reported_id', reportedId)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // Last 24 hours
      .single();

    if (existingReport) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'You already reported this user recently' }),
      };
    }

    // Sanitize description for XSS prevention
    const cleanDescription = description ? sanitizeTextarea(description, 500) : null;

    // Submit the report
    const { data: report, error: reportError } = await supabase
      .from('user_reports')
      .insert({
        reporter_id: reporterId,
        reported_id: reportedId,
        room_id: roomId || null,
        category: category,
        description: cleanDescription,
      })
      .select()
      .single();

    if (reportError) {
      // Handle table not existing
      if (reportError.code === '42P01' || reportError.message?.includes('does not exist')) {
        console.log('⚠️ user_reports table does not exist yet');
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            message: 'Report noted (tables not yet created)',
            reportCount: 0,
            userSuspended: false,
          }),
        };
      }
      console.error('❌ Report submission error:', reportError);
      throw reportError;
    }

    console.log(`🚩 Report submitted: ${reporterId} reported ${reportedId} for ${category}`);

    // Check if auto-suspension should trigger
    const { data: recentReports } = await supabase
      .from('user_reports')
      .select('reporter_id')
      .eq('reported_id', reportedId)
      .gte('created_at', new Date(Date.now() - REPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString());

    // Count unique reporters
    const uniqueReporters = new Set(recentReports?.map(r => r.reporter_id) || []);
    const reportCount = uniqueReporters.size;

    let suspended = false;

    if (reportCount >= REPORTS_FOR_SUSPENSION) {
      // Check if already suspended
      const { data: existingSuspension } = await supabase
        .from('user_suspensions')
        .select('id')
        .eq('user_id', reportedId)
        .eq('is_active', true)
        .single();

      if (!existingSuspension) {
        // Auto-suspend the user
        const { error: suspendError } = await supabase
          .from('user_suspensions')
          .insert({
            user_id: reportedId,
            reason: `Auto-suspended: ${reportCount} reports from different users in ${REPORT_WINDOW_DAYS} days`,
            suspended_by: 'system',
            expires_at: null, // Permanent until reviewed
            is_active: true,
          });

        if (suspendError) {
          console.error('❌ Auto-suspend error:', suspendError);
        } else {
          console.log(`⛔ AUTO-SUSPENDED: User ${reportedId} (${reportCount} reports)`);
          suspended = true;
        }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Report submitted successfully',
        reportCount: reportCount,
        userSuspended: suspended,
      }),
    };

  } catch (error) {
    console.error('❌ Submit report error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to submit report',
        message: error.message,
      }),
    };
  }
};
