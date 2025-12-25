'use strict';

/**
 * Stripe Connect Onboarding
 * 
 * Creates a Stripe Connect Express account for creators and returns
 * an onboarding link to complete their account setup.
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
      error: 'Stripe Connect payouts are disabled',
      message: 'Payouts are processed manually. Use the cashout page to submit a manual payout request.',
    }),
  };
};
