'use strict';

/**
 * Refresh Recording URL
 * 
 * Generates a new signed URL for an expired recording.
 * This is a workaround until recordings are made permanently public.
 */

const { URL } = require('url');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function resolveBucketName() {
  return (
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.FIREBASE_MAIN_STORAGE_BUCKET ||
    process.env.FIREBASE_PROJECT_STORAGE_BUCKET ||
    ''
  );
}

function parseBucketAndObjectFromUrl(oldUrl) {
  if (!oldUrl) return null;
  let parsed;
  try {
    parsed = new URL(oldUrl);
  } catch (_) {
    return null;
  }

  const host = parsed.hostname;

  if (host === 'storage.googleapis.com') {
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      return {
        bucket: parts[0],
        objectPath: parts.slice(1).join('/'),
      };
    }
  }

  if (host.endsWith('.storage.googleapis.com')) {
    const bucket = host.replace(/\.storage\.googleapis\.com$/, '');
    const objectPath = parsed.pathname.split('/').filter(Boolean).join('/');
    if (bucket && objectPath) {
      return { bucket, objectPath };
    }
  }

  if (host === 'firebasestorage.googleapis.com') {
    const match = parsed.pathname.match(/\/v0\/b\/([^/]+)\/o\/(.+)$/);
    if (match) {
      return {
        bucket: decodeURIComponent(match[1]),
        objectPath: decodeURIComponent(match[2]),
      };
    }
  }

  return null;
}

function normalizeObjectPath(objectPath) {
  if (!objectPath) return '';
  return String(objectPath).replace(/^\/+/, '');
}

function buildPublicUrl(bucket, objectPath) {
  const safeBucket = String(bucket || '').trim();
  const safeObjectPath = normalizeObjectPath(objectPath);
  if (!safeBucket || !safeObjectPath) return '';
  return `https://storage.googleapis.com/${safeBucket}/${safeObjectPath}`;
}

async function probeUrl(url) {
  if (!url) return { ok: false, status: 0 };
  try {
    let resp;
    try {
      resp = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    } catch (_) {
      resp = null;
    }

    if (resp && (resp.status === 405 || resp.status === 501)) {
      resp = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        redirect: 'follow',
      });
    }

    if (!resp) return { ok: false, status: 0 };
    return { ok: resp.ok, status: resp.status };
  } catch (_) {
    return { ok: false, status: 0 };
  }
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { recordingId, filePath, oldUrl, checkOnly } = body;

    if (!recordingId && !filePath && !oldUrl) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'recordingId, filePath, or oldUrl required' }),
      };
    }

    const fromUrl = parseBucketAndObjectFromUrl(oldUrl);
    const bucketName = fromUrl?.bucket || resolveBucketName();
    const objectPath = fromUrl?.objectPath || filePath;
    const publicUrl = buildPublicUrl(bucketName, objectPath);

    if (!oldUrl && !publicUrl) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Could not determine a URL to validate' }),
      };
    }

    const oldProbe = await probeUrl(oldUrl);
    if (oldProbe.ok) {
      const permanent =
        (oldUrl && oldUrl.includes('firebasestorage.googleapis.com') && oldUrl.includes('token=')) ||
        (oldUrl && oldUrl.includes('storage.googleapis.com') && !oldUrl.includes('?'));
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          url: oldUrl,
          permanent,
          message: 'URL still valid'
        }),
      };
    }

    const publicProbe = await probeUrl(publicUrl);

    if (checkOnly) {
      if (oldProbe.status === 404 && publicProbe.status === 404) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Recording file not found' }),
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          exists: true,
        }),
      };
    }

    if (publicProbe.ok) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          url: publicUrl,
          permanent: true,
          message: 'Derived public URL'
        }),
      };
    }

    if (oldProbe.status === 404 && publicProbe.status === 404) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Recording file not found' }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        url: oldUrl || publicUrl,
        permanent: false,
        message: 'Unable to generate a better URL'
      }),
    };

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
