'use strict';

const admin = require('firebase-admin');

function getFirebaseAdmin(options = {}) {
  if (admin.apps.length > 0) {
    return admin;
  }

  const isNetlifyLikeEnv =
    process.env.NETLIFY === 'true' ||
    !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
    !!process.env.AWS_REGION;

  const projectId = process.env.FIREBASE_MAIN_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
  const databaseURL = process.env.FIREBASE_MAIN_DATABASE_URL || process.env.FIREBASE_DATABASE_URL;
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_MAIN_STORAGE_BUCKET;

  if (!projectId) {
    throw new Error('Firebase configuration missing');
  }
  if (options.requireDatabaseURL && !databaseURL) {
    throw new Error('Firebase configuration missing');
  }
  if (options.requireStorageBucket && !storageBucket) {
    throw new Error('Firebase configuration missing');
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  let credential;

  if (serviceAccountJson) {
    try {
      const parsed = JSON.parse(serviceAccountJson);
      if (typeof parsed?.private_key === 'string') {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }
      credential = admin.credential.cert(parsed);
    } catch (error) {
      if (isNetlifyLikeEnv) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is set but is not valid JSON');
      }
    }
  } else if (clientEmail && privateKey) {
    credential = admin.credential.cert({
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, '\n'),
    });
  }

  if (!credential && isNetlifyLikeEnv) {
    throw new Error('Firebase credentials missing (set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY)');
  }

  const initConfig = {
    credential: credential || admin.credential.applicationDefault(),
  };

  if (databaseURL) initConfig.databaseURL = databaseURL;
  if (storageBucket) initConfig.storageBucket = storageBucket;

  admin.initializeApp(initConfig);
  return admin;
}

module.exports = {
  admin,
  getFirebaseAdmin,
};
