'use strict';

/**
 * Get Stripe Connect Status
 * 
 * Returns the user's Stripe Connect account status.
 * Syncs with Stripe to get the latest status.
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
      error: 'Stripe Connect payouts are disabled',
      message: 'Payouts are processed manually.',
      connected: false,
      payoutsEnabled: false,
    }),
  };
};
