'use strict';

/**
 * Create Forum - Creates a new forum/community
 * 
 * RATE LIMITED: 30 requests per hour (CREATE tier)
 * SANITIZED: XSS prevention on name, description, rules, tags
 */

const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit, getClientIP, rateLimitResponse, RATE_LIMITS } = require('./utils/rate-limiter');
const { sanitizeText, sanitizeTextarea, sanitizeSlug, sanitizeTags, sanitizeUrl } = require('./utils/sanitize');

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

  // Rate limiting - CREATE tier (30 requests/hour)
  const clientIP = getClientIP(event);
  const rateLimitResult = await checkRateLimit(supabase, clientIP, RATE_LIMITS.CREATE, 'create-forum');
  if (!rateLimitResult.allowed) {
    return rateLimitResponse(rateLimitResult, RATE_LIMITS.CREATE);
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

    // Sanitize inputs for XSS prevention
    const cleanName = sanitizeText(name, 100);
    const cleanSlug = sanitizeSlug(slug, 50);
    const cleanDescription = description ? sanitizeTextarea(description, 1000) : null;
    const cleanRules = rules ? sanitizeTextarea(rules, 2000) : null;
    const cleanTags = sanitizeTags(tags, 10, 30);
    const cleanIconUrl = iconUrl ? sanitizeUrl(iconUrl) : null;
    const cleanBannerUrl = bannerUrl ? sanitizeUrl(bannerUrl) : null;
    
    if (cleanName.length < 3) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Forum name must be 3-100 characters' }) };
    }
    
    if (cleanSlug.length < 3) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Slug must be at least 3 characters' }) };
    }

    if (RESERVED_SLUGS.includes(cleanSlug)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'This forum name is reserved' }) };
    }

    const { data: existingForum } = await supabase.from('forums').select('id').eq('slug', cleanSlug).single();
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
    if (cleanBannerUrl || primaryColor || secondaryColor) {
      const { data: subscription } = await supabase.from('user_subscriptions').select('plan_type').eq('user_id', userId).single();
      allowBranding = ['host_pro', 'pro_bundle'].includes(subscription?.plan_type);
    }

    // Validate color format (hex only)
    const hexColorPattern = /^#[0-9A-Fa-f]{6}$/;
    const cleanPrimaryColor = primaryColor && hexColorPattern.test(primaryColor) ? primaryColor : null;
    const cleanSecondaryColor = secondaryColor && hexColorPattern.test(secondaryColor) ? secondaryColor : null;

    const forumData = {
      slug: cleanSlug,
      name: cleanName,
      description: cleanDescription,
      rules: cleanRules,
      category: validCategory,
      tags: cleanTags,
      forum_type: validForumType,
      is_nsfw: Boolean(isNsfw),
      owner_id: userId,
      icon_url: cleanIconUrl,
      banner_url: allowBranding ? cleanBannerUrl : null,
      primary_color: allowBranding ? cleanPrimaryColor : null,
      secondary_color: allowBranding ? cleanSecondaryColor : null,
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
