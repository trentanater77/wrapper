'use strict';

/**
 * Update User Profile
 * 
 * Updates user's display_name, bio, and avatar_url in the profiles table.
 */

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase with service role key
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
    const { userId, displayName, bio, avatarBase64, avatarContentType } = body;

    if (!userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'userId is required' }),
      };
    }

    let avatarUrl = null;

    // Handle avatar upload if provided
    if (avatarBase64 && avatarContentType) {
      // Validate content type
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(avatarContentType)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid image type. Allowed: JPEG, PNG, GIF, WebP' }),
        };
      }

      // Decode base64
      const buffer = Buffer.from(avatarBase64, 'base64');
      
      // Max 5MB
      if (buffer.length > 5 * 1024 * 1024) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Image too large. Max 5MB.' }),
        };
      }

      // Generate filename
      const ext = avatarContentType.split('/')[1] || 'png';
      const filename = `${userId}/${Date.now()}.${ext}`;

      // Upload to avatars bucket
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filename, buffer, {
          contentType: avatarContentType,
          upsert: true,
        });

      if (uploadError) {
        console.error('❌ Avatar upload error:', uploadError);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to upload avatar', message: uploadError.message }),
        };
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(filename);

      avatarUrl = urlData?.publicUrl;
      console.log(`✅ Avatar uploaded: ${avatarUrl}`);
    }

    // Build update object
    const updateData = {};
    if (displayName !== undefined) updateData.display_name = displayName;
    if (bio !== undefined) updateData.bio = bio;
    if (avatarUrl) updateData.avatar_url = avatarUrl;

    // Check if profile exists
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', userId)
      .single();

    let result;

    if (existingProfile) {
      // Update existing profile
      const { data, error } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        console.error('❌ Profile update error:', error);
        throw error;
      }
      result = data;
    } else {
      // Create new profile
      const { data, error } = await supabase
        .from('profiles')
        .insert({
          user_id: userId,
          ...updateData,
        })
        .select()
        .single();

      if (error) {
        console.error('❌ Profile insert error:', error);
        throw error;
      }
      result = data;
    }

    console.log(`✅ Profile updated for user ${userId}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        profile: {
          displayName: result.display_name,
          username: result.username,
          bio: result.bio,
          avatarUrl: result.avatar_url,
        },
      }),
    };

  } catch (error) {
    console.error('❌ Update profile error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to update profile',
        message: error.message 
      }),
    };
  }
};
