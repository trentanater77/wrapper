// netlify/functions/join-queue.js
// Adds a user to the matchmaking queue in Firebase
// RATE LIMITED: 60 requests per minute (STANDARD tier)

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
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
      error: 'Deprecated endpoint',
      message: 'This endpoint is no longer supported. Use the current matchmaking flow.',
    }),
  };
};
