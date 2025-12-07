'use strict';

/**
 * Create Forum - Creates a new forum/community
 */

const { createClient } = require('@supabase/supabase-js');

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

const VALID_CATEGORIES = ['gaming', 'technology', 'music', 'entertainment', 'business', 'education', 'fitness', 'creative', 'just_chatting', 'other'];
const RESERVED_SLUGS = ['admin', 'api', 'home', 'explore', 'settings', 'profile', 'create', 'edit', 'delete', 'mod', 'help', 'support', 'about', 'terms', 'privacy', 'login', 'signup', 'chatspheres', 'official', 'staff', 'live'];

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { userId, name, slug, description, rules, category, tags, forumType, isNsfw, iconUrl, bannerUrl, primaryColor, secondaryColor } = body;

    if (!userId) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Authentication required' }) };
    }

    if (!name || !slug) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name and slug are required' }) };
    }

    if (name.length < 3 || name.length > 100) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Forum name must be 3-100 characters' }) };
    }

    const sanitizedSlug = slug.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    
    if (sanitizedSlug.length < 3) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Slug must be at least 3 characters' }) };
    }

    if (RESERVED_SLUGS.includes(sanitizedSlug)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'This forum name is reserved' }) };
    }

    const { data: existingForum } = await supabase.from('forums').select('id').eq('slug', sanitizedSlug).single();
    if (existingForum) {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'A forum with this URL already exists' }) };
    }

    const validCategory = VALID_CATEGORIES.includes(category) ? category : 'other';
    const validForumType = ['public', 'unlisted', 'private'].includes(forumType) ? forumType : 'public';

    if (validForumType === 'private') {
      const { data: subscription } = await supabase.from('user_subscriptions').select('plan_type').eq('user_id', userId).single();
      if (!['host_pro', 'pro_bundle'].includes(subscription?.plan_type)) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Private forums require Pro subscription', upgradeRequired: true }) };
      }
    }

    let allowBranding = false;
    if (bannerUrl || primaryColor || secondaryColor) {
      const { data: subscription } = await supabase.from('user_subscriptions').select('plan_type').eq('user_id', userId).single();
      allowBranding = ['host_pro', 'pro_bundle'].includes(subscription?.plan_type);
    }

    const forumData = {
      slug: sanitizedSlug,
      name: name.trim(),
      description: description?.trim() || null,
      rules: rules?.trim() || null,
      category: validCategory,
      tags: Array.isArray(tags) ? tags.slice(0, 10) : [],
      forum_type: validForumType,
      is_nsfw: Boolean(isNsfw),
      owner_id: userId,
      icon_url: iconUrl || null,
      banner_url: allowBranding ? bannerUrl : null,
      primary_color: allowBranding ? primaryColor : null,
      secondary_color: allowBranding ? secondaryColor : null,
      member_count: 1,
    };

    const { data: forum, error: createError } = await supabase.from('forums').insert(forumData).select().single();
    if (createError) throw createError;

    await supabase.from('forum_members').insert({ forum_id: forum.id, user_id: userId, role: 'owner' });

    console.log(`✅ Forum created: ${forum.slug} by ${userId}`);

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        success: true,
        forum: { id: forum.id, slug: forum.slug, name: forum.name, forumType: forum.forum_type },
        url: `/f/${forum.slug}`,
      }),
    };
  } catch (error) {
    console.error('❌ Error creating forum:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to create forum', message: error.message }) };
  }
};
