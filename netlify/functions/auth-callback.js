'use strict';

/**
 * Auth Callback Handler
 * 
 * This function handles OAuth callbacks (e.g., Google sign-in).
 * After Supabase processes the OAuth flow, it redirects here with tokens.
 * We then redirect the user back to the app with proper session handling.
 */

exports.handler = async function authCallbackHandler(event) {
  const { queryStringParameters, headers } = event;
  
  // Get the base URL from environment or headers
  const siteUrl = process.env.AUTH_SITE_URL || 
                  process.env.URL || 
                  `https://${headers.host}`;
  
  // Preserve original query parameters for session handling
  const searchParams = new URLSearchParams();
  
  // Forward all query parameters from Supabase callback
  if (queryStringParameters) {
    Object.entries(queryStringParameters).forEach(([key, value]) => {
      if (value) searchParams.set(key, value);
    });
  }
  
  // Redirect to matchmaking page where the client-side JS will handle the session
  // Using matchmaking instead of index.html since index.html redirects away without room code
  const redirectTarget = `${siteUrl}/matchmaking.html?${searchParams.toString()}#auth-callback`;
  
  return {
    statusCode: 302,
    headers: {
      'Location': redirectTarget,
      'Cache-Control': 'no-store'
    },
    body: ''
  };
};
