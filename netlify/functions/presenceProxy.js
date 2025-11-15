const admin = require('./utils/firebaseAdmin');

const db = admin.database();

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: ''
    };
  }

  try {
    const path = event.queryStringParameters?.path;
    if (!path) {
      return respond(400, { error: 'Missing path query parameter' });
    }

    const ref = db.ref(path);

    if (event.httpMethod === 'GET') {
      const snapshot = await ref.get();
      return respond(200, snapshot.exists() ? snapshot.val() : null);
    }

    if (event.httpMethod === 'PATCH' || event.httpMethod === 'PUT' || event.httpMethod === 'POST') {
      if (!event.body) {
        return respond(400, { error: 'Missing request body' });
      }

      const payload = JSON.parse(event.body);

      if (event.httpMethod === 'PATCH') {
        await ref.update(payload);
      } else {
        await ref.set(payload);
      }

      return respond(200, { ok: true });
    }

    if (event.httpMethod === 'DELETE') {
      await ref.remove();
      return respond(200, { ok: true });
    }

    return respond(405, { error: 'Method not allowed' });
  } catch (error) {
    console.error('presenceProxy error:', error);
    return respond(500, { error: error.message || 'Internal error' });
  }
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(body)
  };
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}
