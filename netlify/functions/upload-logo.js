'use strict';

/**
 * Upload Custom Logo
 * 
 * Allows Host Pro / Pro Bundle users to upload a custom logo.
 * Stores the logo in Supabase Storage and updates user_profiles.
 */

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// CORS headers
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

// Plans that allow custom branding
const BRANDING_PLANS = ['host_pro', 'pro_bundle'];

exports.handler = async function(event) {
  // Handle CORS preflight
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
    const { userId, logoData, logoType } = body;

    // Validate inputs
    if (!userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'userId is required' }),
      };
    }

    if (!logoData) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'logoData is required' }),
      };
    }

    // Check user's subscription
    const { data: subscription } = await supabase
      .from('user_subscriptions')
      .select('plan_type, status')
      .eq('user_id', userId)
      .single();

    const planType = subscription?.plan_type || 'free';

    if (!BRANDING_PLANS.includes(planType)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ 
          error: 'Custom branding requires Host Pro or Pro Bundle subscription',
          currentPlan: planType
        }),
      };
    }

    // Validate logo data (base64)
    if (!logoData.startsWith('data:image/')) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid image format. Please upload PNG, JPG, or GIF.' }),
      };
    }

    // Extract base64 content
    const matches = logoData.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid base64 image data' }),
      };
    }

    const fileExtension = matches[1] === 'jpeg' ? 'jpg' : matches[1];
    const base64Content = matches[2];
    const buffer = Buffer.from(base64Content, 'base64');

    // Validate file size (max 500KB)
    if (buffer.length > 500 * 1024) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Logo must be under 500KB' }),
      };
    }

    // Generate unique filename
    const timestamp = Date.now();
    const fileName = `logos/${userId}/${timestamp}.${fileExtension}`;

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('user-assets')
      .upload(fileName, buffer, {
        contentType: `image/${fileExtension}`,
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to upload logo', details: uploadError.message }),
      };
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('user-assets')
      .getPublicUrl(fileName);

    const logoUrl = urlData?.publicUrl;

    if (!logoUrl) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to get logo URL' }),
      };
    }

    // Update user profile
    const { error: profileError } = await supabase
      .from('user_profiles')
      .upsert({
        user_id: userId,
        custom_logo_url: logoUrl,
        logo_updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id',
      });

    if (profileError) {
      console.error('Profile update error:', profileError);
      // Don't fail - logo is uploaded, just profile update failed
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        logoUrl,
        message: 'Logo uploaded successfully!',
      }),
    };

  } catch (error) {
    console.error('❌ Error uploading logo:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to upload logo',
        message: error.message,
      }),
    };
  }
};
