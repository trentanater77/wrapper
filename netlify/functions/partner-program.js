'use strict';

/**
 * Partner Program
 * 
 * Handle creator partner operations:
 * - Apply to become a partner
 * - Check partner status
 * - Get partner benefits (tip share, etc.)
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // GET: Check partner status
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};
      const { userId } = params;

      if (!userId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'User ID is required' }),
        };
      }

      // Check if user is a partner
      const { data: partner, error: partnerError } = await supabase
        .from('creator_partners')
        .select('*')
        .eq('user_id', userId)
        .single();

      // Check if user has a pending application
      let application = null;
      const { data: appData } = await supabase
        .from('partner_applications')
        .select('*')
        .eq('user_id', userId)
        .single();
      
      if (appData) {
        application = appData;
      }

      // Handle table not existing
      if (partnerError && partnerError.code === '42P01') {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            isPartner: false,
            partner: null,
            application: null,
            tipSharePercent: 85, // Default platform rate
          }),
        };
      }

      const isPartner = partner && partner.status === 'active';
      const tipSharePercent = isPartner ? partner.tip_share_percent : 85;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          isPartner,
          partner: partner || null,
          application: application || null,
          tipSharePercent,
        }),
      };

    } catch (error) {
      console.error('❌ Error checking partner status:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to check partner status' }),
      };
    }
  }

  // POST: Partner operations
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { action } = body;

    switch (action) {
      case 'apply': {
        const { userId, socialLinks, audienceSize, contentType, whyPartner } = body;

        if (!userId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'User ID is required' }),
          };
        }

        // Check if already a partner
        const { data: existingPartner } = await supabase
          .from('creator_partners')
          .select('id, status')
          .eq('user_id', userId)
          .single();

        if (existingPartner && existingPartner.status === 'active') {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'You are already a creator partner!' }),
          };
        }

        // Check for existing pending application
        const { data: existingApp } = await supabase
          .from('partner_applications')
          .select('id, status')
          .eq('user_id', userId)
          .single();

        if (existingApp && existingApp.status === 'pending') {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'You already have a pending application' }),
          };
        }

        // Create or update application
        const appData = {
          user_id: userId,
          social_links: socialLinks || '',
          audience_size: audienceSize || '',
          content_type: contentType || '',
          why_partner: whyPartner || '',
          status: 'pending',
          created_at: new Date().toISOString(),
        };

        const { data: newApp, error: insertError } = await supabase
          .from('partner_applications')
          .upsert(appData, { onConflict: 'user_id' })
          .select()
          .single();

        if (insertError) {
          if (insertError.code === '42P01') {
            return {
              statusCode: 500,
              headers,
              body: JSON.stringify({ error: 'Partner program not yet set up. Please run migration.' }),
            };
          }
          throw insertError;
        }

        console.log(`📝 Partner application submitted by ${userId}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            application: newApp,
            message: 'Application submitted! We\'ll review it soon.',
          }),
        };
      }

      case 'approve': {
        // Admin action - approve a partner application
        const { userId, adminKey, tipSharePercent, tier } = body;

        // Simple admin key check (in production, use proper auth)
        if (adminKey !== process.env.ADMIN_SECRET_KEY) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ error: 'Unauthorized' }),
          };
        }

        if (!userId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'User ID is required' }),
          };
        }

        // Create partner record
        const { data: partner, error: partnerError } = await supabase
          .from('creator_partners')
          .upsert({
            user_id: userId,
            status: 'active',
            tip_share_percent: tipSharePercent || 100,
            tier: tier || 'founding',
            approved_at: new Date().toISOString(),
          }, { onConflict: 'user_id' })
          .select()
          .single();

        if (partnerError) throw partnerError;

        // Update application status
        await supabase
          .from('partner_applications')
          .update({
            status: 'approved',
            reviewed_at: new Date().toISOString(),
          })
          .eq('user_id', userId);

        console.log(`✅ Partner approved: ${userId}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            partner,
          }),
        };
      }

      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid action' }),
        };
    }

  } catch (error) {
    console.error('❌ Error with partner program:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to process partner request',
        message: error.message,
      }),
    };
  }
};
