'use strict';

/**
 * Input Sanitization Utility
 * 
 * Provides server-side sanitization for user inputs to prevent XSS,
 * SQL injection attempts, and other malicious content.
 */

// Common XSS patterns to strip
const XSS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,  // Script tags
  /javascript:/gi,                                         // javascript: protocol
  /on\w+\s*=/gi,                                          // Event handlers (onclick=, onerror=, etc)
  /data:\s*text\/html/gi,                                 // data:text/html
  /<iframe\b[^>]*>/gi,                                    // iframes
  /<object\b[^>]*>/gi,                                    // objects
  /<embed\b[^>]*>/gi,                                     // embeds
  /<link\b[^>]*>/gi,                                      // link tags
  /<meta\b[^>]*>/gi,                                      // meta tags
  /expression\s*\(/gi,                                    // CSS expressions
  /url\s*\(\s*["']?\s*javascript:/gi,                     // url(javascript:)
  /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi,    // Style tags (can contain JS)
  /\beval\s*\(/gi,                                        // eval()
  /\bexec\s*\(/gi,                                        // exec()
  /<base\b[^>]*>/gi,                                      // base tags
  /<!--.*?-->/gs,                                         // HTML comments
];

// Characters to HTML encode
const HTML_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
  '`': '&#96;',
};

/**
 * Strip dangerous HTML/JS patterns from text
 * Use for general text that shouldn't contain any HTML
 */
function stripXSS(input) {
  if (typeof input !== 'string') return input;
  
  let clean = input;
  for (const pattern of XSS_PATTERNS) {
    clean = clean.replace(pattern, '');
  }
  return clean.trim();
}

/**
 * HTML encode special characters
 * Use when text will be rendered in HTML context
 */
function htmlEncode(input) {
  if (typeof input !== 'string') return input;
  
  return input.replace(/[&<>"'\/`]/g, char => HTML_ENTITIES[char] || char);
}

/**
 * Sanitize a plain text field (forum names, room titles, etc.)
 * Strips XSS, limits length, trims whitespace
 */
function sanitizeText(input, maxLength = 200) {
  if (typeof input !== 'string') return '';
  
  let clean = stripXSS(input);
  clean = clean.trim();
  clean = clean.replace(/\s+/g, ' ');  // Normalize whitespace
  
  if (maxLength && clean.length > maxLength) {
    clean = clean.substring(0, maxLength);
  }
  
  return clean;
}

/**
 * Sanitize a longer text field (descriptions, bios, etc.)
 * Allows newlines but strips XSS
 */
function sanitizeTextarea(input, maxLength = 1000) {
  if (typeof input !== 'string') return '';
  
  let clean = stripXSS(input);
  clean = clean.trim();
  // Normalize excessive newlines (max 2 consecutive)
  clean = clean.replace(/\n{3,}/g, '\n\n');
  
  if (maxLength && clean.length > maxLength) {
    clean = clean.substring(0, maxLength);
  }
  
  return clean;
}

/**
 * Sanitize a display name/username
 * Strict: alphanumeric, spaces, basic punctuation only
 */
function sanitizeDisplayName(input, maxLength = 50) {
  if (typeof input !== 'string') return '';
  
  let clean = input.trim();
  // Only allow safe characters
  clean = clean.replace(/[^a-zA-Z0-9\s\-_.!]/g, '');
  // Normalize whitespace
  clean = clean.replace(/\s+/g, ' ');
  
  if (maxLength && clean.length > maxLength) {
    clean = clean.substring(0, maxLength);
  }
  
  return clean || 'User';  // Fallback
}

/**
 * Sanitize an email address
 */
function sanitizeEmail(input) {
  if (typeof input !== 'string') return '';
  
  let clean = input.trim().toLowerCase();
  // Basic email pattern check
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  if (!emailPattern.test(clean)) {
    return '';
  }
  
  return clean;
}

/**
 * Sanitize a URL
 */
function sanitizeUrl(input) {
  if (typeof input !== 'string') return '';
  
  let clean = input.trim();
  
  // Must start with http:// or https://
  if (!clean.match(/^https?:\/\//i)) {
    return '';
  }
  
  // Block javascript: and data: schemes (even if disguised)
  if (clean.match(/javascript:|data:/i)) {
    return '';
  }
  
  try {
    // Validate it's a proper URL
    new URL(clean);
    return clean;
  } catch {
    return '';
  }
}

/**
 * Sanitize a slug (URL-safe identifier)
 */
function sanitizeSlug(input, maxLength = 50) {
  if (typeof input !== 'string') return '';
  
  let clean = input.toLowerCase().trim();
  // Replace spaces with hyphens
  clean = clean.replace(/\s+/g, '-');
  // Only allow alphanumeric, hyphens, underscores
  clean = clean.replace(/[^a-z0-9\-_]/g, '');
  // Remove consecutive hyphens
  clean = clean.replace(/-+/g, '-');
  // Remove leading/trailing hyphens
  clean = clean.replace(/^-|-$/g, '');
  
  if (maxLength && clean.length > maxLength) {
    clean = clean.substring(0, maxLength);
  }
  
  return clean;
}

/**
 * Sanitize an array of tags
 */
function sanitizeTags(input, maxTags = 10, maxLength = 30) {
  if (!Array.isArray(input)) return [];
  
  return input
    .slice(0, maxTags)
    .map(tag => sanitizeText(String(tag), maxLength))
    .filter(tag => tag.length > 0);
}

/**
 * Sanitize JSON object (for device_info, etc.)
 * Recursively sanitizes all string values
 */
function sanitizeObject(obj, maxDepth = 3) {
  if (maxDepth <= 0) return {};
  if (typeof obj !== 'object' || obj === null) return {};
  
  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    // Sanitize key
    const cleanKey = sanitizeText(key, 50);
    if (!cleanKey) continue;
    
    if (typeof value === 'string') {
      clean[cleanKey] = sanitizeText(value, 500);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      clean[cleanKey] = value;
    } else if (Array.isArray(value)) {
      clean[cleanKey] = value.slice(0, 20).map(v => 
        typeof v === 'string' ? sanitizeText(v, 200) : v
      );
    } else if (typeof value === 'object' && value !== null) {
      clean[cleanKey] = sanitizeObject(value, maxDepth - 1);
    }
  }
  return clean;
}

/**
 * Check if input contains potential SQL injection
 * Returns true if suspicious patterns found
 */
function containsSQLInjection(input) {
  if (typeof input !== 'string') return false;
  
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|TRUNCATE)\b)/i,
    /(--)|(\/\*)/,                          // SQL comments
    /(;|\||`)/,                             // Statement terminators
    /(\bOR\b|\bAND\b)\s*(\d|'|")/i,        // OR/AND injection
    /'\s*(OR|AND)\s*'?\d*\s*=\s*'?\d*/i,   // String-based injection
  ];
  
  return sqlPatterns.some(pattern => pattern.test(input));
}

module.exports = {
  stripXSS,
  htmlEncode,
  sanitizeText,
  sanitizeTextarea,
  sanitizeDisplayName,
  sanitizeEmail,
  sanitizeUrl,
  sanitizeSlug,
  sanitizeTags,
  sanitizeObject,
  containsSQLInjection,
};
