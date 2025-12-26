// netlify/functions/find-match.js
// Finds semantic matches using cosine similarity between topic vectors

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async function (event) {
  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers,
      body: "",
    };
  }

  return {
    statusCode: 410,
    headers,
    body: JSON.stringify({
      error: "Deprecated endpoint",
      message: "This endpoint is no longer supported. Use the current matchmaking flow.",
    }),
  };
};
