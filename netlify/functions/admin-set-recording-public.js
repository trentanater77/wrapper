'use strict';

const { admin, getFirebaseAdmin } = require('./utils/firebase-admin');

const ADMIN_SECRET = process.env.ADMIN_SECRET;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const adminSecret = event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'];
  if (!ADMIN_SECRET) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server configuration error - admin secret not set' }),
    };
  }
  if (adminSecret !== ADMIN_SECRET) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { recordingId, roomKey, setAllInRoom } = body;

    if (!roomKey) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'roomKey required' }) };
    }

    const firebase = getFirebaseAdmin({ requireDatabaseURL: true });
    const db = firebase.database();

    if (setAllInRoom) {
      const roomRef = db.ref(`recordings/${roomKey}`);
      const snapshot = await roomRef.once('value');
      const entries = snapshot.val() || {};
      const ids = Object.keys(entries);

      let updated = 0;
      for (const id of ids) {
        try {
          await db.ref(`recordings/${roomKey}/${id}`).update({
            privacy: 'public',
            privacyUpdatedAt: admin.database.ServerValue.TIMESTAMP,
          });
          updated += 1;
        } catch (e) {}
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, updated, roomKey }),
      };
    }

    if (!recordingId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'recordingId required (or setAllInRoom=true)' }) };
    }

    await db.ref(`recordings/${roomKey}/${recordingId}`).update({
      privacy: 'public',
      privacyUpdatedAt: admin.database.ServerValue.TIMESTAMP,
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, roomKey, recordingId }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Failed' }),
    };
  }
};
