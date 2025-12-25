'use strict';

/**
 * Create KYC Verification Session
 * 
 * Uses Stripe Identity to verify user identity before allowing payouts.
 * Returns a URL to redirect the user to Stripe's hosted verification flow.
 */

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

  return {
    statusCode: 410,
    headers,
    body: JSON.stringify({
      error: 'Identity verification is disabled',
      message: 'Payout requests are processed manually and do not require identity verification at this time.',
    }),
  };
};
