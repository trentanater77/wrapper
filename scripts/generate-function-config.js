'use strict';

const fs = require('fs');
const path = require('path');

function setDeep(target, keys, value) {
  let cur = target;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (!cur[k] || typeof cur[k] !== 'object') {
      cur[k] = {};
    }
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
}

function addEnv(target, keys, envName) {
  const value = process.env[envName];
  if (value === undefined || value === '') return;
  setDeep(target, keys, value);
}

function pruneEmpty(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const entries = Object.entries(obj)
    .map(([key, value]) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return [key, pruneEmpty(value)];
      }
      return [key, value];
    })
    .filter(([, value]) => {
      if (value === undefined || value === null) return false;
      if (typeof value === 'object' && !Array.isArray(value)) {
        return Object.keys(value).length > 0;
      }
      return true;
    });
  return Object.fromEntries(entries);
}

function pickEither(primaryEnv, fallbackEnv) {
  const primary = process.env[primaryEnv];
  if (primary !== undefined && primary !== '') return primary;
  const fallback = process.env[fallbackEnv];
  if (fallback !== undefined && fallback !== '') return fallback;
  return undefined;
}

function main() {
  const outDir = path.join(__dirname, '..', 'netlify', 'functions', '_generated');
  const outFile = path.join(outDir, 'function-config.js');

  const publicConfig = {};

  const billing = {
    stripePrices: {},
    squareItemVariations: {},
    squarePlanVariations: {},
  };

  addEnv(billing.stripePrices, ['host_pro_monthly'], 'STRIPE_PRICE_HOST_PRO_MONTHLY');
  addEnv(billing.stripePrices, ['host_pro_yearly'], 'STRIPE_PRICE_HOST_PRO_YEARLY');
  addEnv(billing.stripePrices, ['ad_free_plus_monthly'], 'STRIPE_PRICE_AD_FREE_PLUS_MONTHLY');
  addEnv(billing.stripePrices, ['ad_free_plus_yearly'], 'STRIPE_PRICE_AD_FREE_PLUS_YEARLY');
  addEnv(billing.stripePrices, ['ad_free_premium_monthly'], 'STRIPE_PRICE_AD_FREE_PREMIUM_MONTHLY');
  addEnv(billing.stripePrices, ['ad_free_premium_yearly'], 'STRIPE_PRICE_AD_FREE_PREMIUM_YEARLY');
  addEnv(billing.stripePrices, ['pro_bundle_monthly'], 'STRIPE_PRICE_PRO_BUNDLE_MONTHLY');
  addEnv(billing.stripePrices, ['pro_bundle_yearly'], 'STRIPE_PRICE_PRO_BUNDLE_YEARLY');

  addEnv(billing.stripePrices, ['gem_taste_test'], 'STRIPE_PRICE_GEM_TASTE_TEST');
  addEnv(billing.stripePrices, ['gem_handful'], 'STRIPE_PRICE_GEM_HANDFUL');
  addEnv(billing.stripePrices, ['gem_sack'], 'STRIPE_PRICE_GEM_SACK');
  addEnv(billing.stripePrices, ['gem_chest'], 'STRIPE_PRICE_GEM_CHEST');
  addEnv(billing.stripePrices, ['gem_vault'], 'STRIPE_PRICE_GEM_VAULT');

  addEnv(billing.squareItemVariations, ['gem_taste_test'], 'SQUARE_ITEMVAR_GEM_TASTE_TEST');
  addEnv(billing.squareItemVariations, ['gem_handful'], 'SQUARE_ITEMVAR_GEM_HANDFUL');
  addEnv(billing.squareItemVariations, ['gem_sack'], 'SQUARE_ITEMVAR_GEM_SACK');
  addEnv(billing.squareItemVariations, ['gem_chest'], 'SQUARE_ITEMVAR_GEM_CHEST');
  addEnv(billing.squareItemVariations, ['gem_vault'], 'SQUARE_ITEMVAR_GEM_VAULT');

  const planKeys = [
    ['host_pro_monthly', 'SQUARE_PLANVAR_HOST_PRO_MONTHLY', 'SQUARE_PLAN_HOST_PRO_MONTHLY'],
    ['host_pro_yearly', 'SQUARE_PLANVAR_HOST_PRO_YEARLY', 'SQUARE_PLAN_HOST_PRO_YEARLY'],
    ['ad_free_plus_monthly', 'SQUARE_PLANVAR_AD_FREE_PLUS_MONTHLY', 'SQUARE_PLAN_AD_FREE_PLUS_MONTHLY'],
    ['ad_free_plus_yearly', 'SQUARE_PLANVAR_AD_FREE_PLUS_YEARLY', 'SQUARE_PLAN_AD_FREE_PLUS_YEARLY'],
    ['ad_free_premium_monthly', 'SQUARE_PLANVAR_AD_FREE_PREMIUM_MONTHLY', 'SQUARE_PLAN_AD_FREE_PREMIUM_MONTHLY'],
    ['ad_free_premium_yearly', 'SQUARE_PLANVAR_AD_FREE_PREMIUM_YEARLY', 'SQUARE_PLAN_AD_FREE_PREMIUM_YEARLY'],
    ['pro_bundle_monthly', 'SQUARE_PLANVAR_PRO_BUNDLE_MONTHLY', 'SQUARE_PLAN_PRO_BUNDLE_MONTHLY'],
    ['pro_bundle_yearly', 'SQUARE_PLANVAR_PRO_BUNDLE_YEARLY', 'SQUARE_PLAN_PRO_BUNDLE_YEARLY'],
  ];

  for (const [key, primary, fallback] of planKeys) {
    const value = pickEither(primary, fallback);
    if (value !== undefined) {
      billing.squarePlanVariations[key] = value;
    }
  }

  fs.mkdirSync(outDir, { recursive: true });

  const cleaned = pruneEmpty({ publicConfig, billing });
  const content = `'use strict';\n\nmodule.exports = ${JSON.stringify(cleaned)};\n`;

  fs.writeFileSync(outFile, content, 'utf8');
  console.log('✅ Generated Netlify Functions config module');
}

main();
