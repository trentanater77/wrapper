'use strict';

/**
 * Get KYC Verification Status
 * 
 * Returns the user's current KYC verification status.
 * If status is 'pending', syncs with Stripe to get the real status.
 */

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
      verified: false,
      status: 'disabled',
    }),
  };
};
