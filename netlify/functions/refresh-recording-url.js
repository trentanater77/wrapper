'use strict';

/**
 * Refresh Recording URL
 * 
 * Generates a new signed URL for an expired recording.
 * This is a workaround until recordings are made permanently public.
 */

const { admin, getFirebaseAdmin } = require('./utils/firebase-admin');

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

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { recordingId, filePath, oldUrl } = body;

    if (!recordingId && !filePath && !oldUrl) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'recordingId, filePath, or oldUrl required' }),
      };
    }

    const firebase = getFirebaseAdmin({ requireDatabaseURL: true, requireStorageBucket: true });
    const bucket = firebase.storage().bucket();
    const bucketName = bucket.name;

    // Try to determine the file path
    let actualFilePath = filePath;

    if (!actualFilePath && oldUrl) {
      // Extract file path from old URL
      // URL format: https://storage.googleapis.com/bucket/recordings/filename.mp4?params
      // Or: https://firebasestorage.googleapis.com/v0/b/bucket/o/recordings%2Ffilename.mp4?params
      
      const decodedUrl = decodeURIComponent(oldUrl);
      
      // Try different URL patterns
      let match = decodedUrl.match(/recordings\/([^?]+)/);
      if (!match) {
        match = decodedUrl.match(/recordings%2F([^?&]+)/);
      }
      
      if (match) {
        actualFilePath = `recordings/${match[1]}`;
      }
    }

    if (!actualFilePath) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Could not determine file path' }),
      };
    }

    console.log(`🔄 Refreshing URL for: ${actualFilePath}`);

    const file = bucket.file(actualFilePath);

    // Check if file exists
    const [exists] = await file.exists();
    if (!exists) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Recording file not found' }),
      };
    }

    // Try to make the file public (permanent solution)
    try {
      await file.makePublic();
      const publicUrl = `https://storage.googleapis.com/${bucketName}/${actualFilePath}`;
      
      console.log(`✅ Made file public: ${publicUrl}`);

      // Update the database with the permanent URL
      if (recordingId) {
        const db = firebase.database();
        // Try to find and update the recording in the database
        const recordingsRef = db.ref('recordings');
        const snapshot = await recordingsRef.once('value');
        const allRecordings = snapshot.val();

        if (allRecordings) {
          for (const [roomKey, roomRecordings] of Object.entries(allRecordings)) {
            if (roomRecordings && roomRecordings[recordingId]) {
              await db.ref(`recordings/${roomKey}/${recordingId}`).update({
                downloadUrl: publicUrl,
                linkStatus: 'ready',
                urlFixedAt: admin.database.ServerValue.TIMESTAMP,
              });
              console.log(`✅ Updated database record`);
              break;
            }
          }
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          url: publicUrl,
          permanent: true,
          message: 'File is now permanently public'
        }),
      };
    } catch (publicError) {
      // If making public fails, generate a new signed URL
      console.log('⚠️ Could not make public, generating signed URL:', publicError.message);

      const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          url: signedUrl,
          permanent: false,
          expiresIn: '7 days',
          message: 'Generated new signed URL (expires in 7 days)'
        }),
      };
    }

  } catch (error) {
    console.error('❌ Refresh recording URL error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to refresh recording URL',
        message: error.message 
      }),
    };
  }
};
