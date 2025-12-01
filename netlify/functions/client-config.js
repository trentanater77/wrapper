'use strict';

const BASE_JSON_ENV = 'CHATSPHERES_CONFIG_JSON';

function safeParse(json) {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed;
    }
    return {};
  } catch (error) {
    console.warn('⚠️ Unable to parse CHATSPHERES_CONFIG_JSON:', error.message);
    return {};
  }
}

function mergeSection(base = {}, entries = []) {
  const result = { ...base };
  entries.forEach(([key, envName]) => {
    const value = process.env[envName];
    if (value !== undefined && value !== '') {
      result[key] = value;
    }
  });
  return result;
}

function pruneEmpty(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  const entries = Object.entries(obj)
    .map(([key, value]) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return [key, pruneEmpty(value)];
      }
      return [key, value];
    })
    .filter(([, value]) => {
      if (value === undefined || value === null) {
        return false;
      }
      if (typeof value === 'object' && !Array.isArray(value)) {
        return Object.keys(value).length > 0;
      }
      return true;
    });

  return Object.fromEntries(entries);
}

exports.handler = async function clientConfigHandler() {
  const baseConfig = safeParse(process.env[BASE_JSON_ENV]);

  const config = {
    ...baseConfig,
    livekitUrl: process.env.LIVEKIT_URL ?? baseConfig.livekitUrl,
    controlApiBaseUrl: process.env.CONTROL_API_BASE_URL ?? baseConfig.controlApiBaseUrl,
    controlApiKey: process.env.CONTROL_API_KEY ?? baseConfig.controlApiKey,
    tokenEndpoint: process.env.LIVEKIT_TOKEN_ENDPOINT ?? baseConfig.tokenEndpoint,
    recordingsEndpoint: process.env.LIVEKIT_RECORDINGS_ENDPOINT ?? baseConfig.recordingsEndpoint,
    recordingLayout: process.env.LIVEKIT_RECORDING_LAYOUT ?? baseConfig.recordingLayout,
    firebaseMain: mergeSection(baseConfig.firebaseMain, [
      ['apiKey', 'FIREBASE_MAIN_API_KEY'],
      ['authDomain', 'FIREBASE_MAIN_AUTH_DOMAIN'],
      ['databaseURL', 'FIREBASE_MAIN_DATABASE_URL'],
      ['projectId', 'FIREBASE_MAIN_PROJECT_ID'],
      ['storageBucket', 'FIREBASE_MAIN_STORAGE_BUCKET'],
      ['messagingSenderId', 'FIREBASE_MAIN_MESSAGING_SENDER_ID'],
      ['appId', 'FIREBASE_MAIN_APP_ID'],
      ['measurementId', 'FIREBASE_MAIN_MEASUREMENT_ID']
    ]),
    promptsFirebase: mergeSection(baseConfig.promptsFirebase, [
      ['apiKey', 'PROMPTS_FIREBASE_API_KEY'],
      ['authDomain', 'PROMPTS_FIREBASE_AUTH_DOMAIN'],
      ['databaseURL', 'PROMPTS_FIREBASE_DATABASE_URL'],
      ['projectId', 'PROMPTS_FIREBASE_PROJECT_ID'],
      ['storageBucket', 'PROMPTS_FIREBASE_STORAGE_BUCKET'],
      ['messagingSenderId', 'PROMPTS_FIREBASE_MESSAGING_SENDER_ID'],
      ['appId', 'PROMPTS_FIREBASE_APP_ID']
    ]),
    supabase: mergeSection(baseConfig.supabase, [
      ['url', 'SUPABASE_URL'],
      ['anonKey', 'SUPABASE_ANON_KEY']
    ]),
    auth: mergeSection(baseConfig.auth, [
      ['cookieDomain', 'AUTH_COOKIE_DOMAIN'],
      ['siteUrl', 'AUTH_SITE_URL'],
      ['redirectUrl', 'AUTH_REDIRECT_URL']
    ])
  };

  const cleanedConfig = pruneEmpty(config);
  const payload = JSON.stringify(cleanedConfig || {});
  const script = `(function(){window.__CHATSPHERES_CONFIG__=Object.assign({},window.__CHATSPHERES_CONFIG__||{},${payload});})();`;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'no-store'
    },
    body: script
  };
};
