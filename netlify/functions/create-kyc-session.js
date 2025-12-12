'use strict';

/**
 * Create KYC Verification Session
 * 
 * Uses Stripe Identity to verify user identity before allowing payouts.
 * Returns a URL to redirect the user to Stripe's hosted verification flow.
 */

const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { userId, userEmail, returnUrl } = body;

    if (!userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'User ID is required' }),
      };
    }

    // Check if user already has a verified status
    const { data: existingKyc } = await supabase
      .from('kyc_verifications')
      .select('status, stripe_verification_id')
      .eq('user_id', userId)
      .single();

    if (existingKyc?.status === 'verified') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          alreadyVerified: true,
          message: 'You are already verified!'
        }),
      };
    }

    // If there's a pending verification, check its status with Stripe
    if (existingKyc?.status === 'pending' && existingKyc?.stripe_verification_id) {
      try {
        const existingSession = await stripe.identity.verificationSessions.retrieve(
          existingKyc.stripe_verification_id
        );
        
        if (existingSession.status === 'verified') {
          // Update our database
          await supabase
            .from('kyc_verifications')
            .update({ 
              status: 'verified',
              verified_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('user_id', userId);

          await supabase
            .from('gem_balances')
            .update({ kyc_verified: true })
            .eq('user_id', userId);

          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
              alreadyVerified: true,
              message: 'You are now verified!'
            }),
          };
        }

        // If still processing, return the existing session URL
        if (existingSession.status === 'requires_input') {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
              url: existingSession.url,
              sessionId: existingSession.id,
              message: 'Please complete your verification'
            }),
          };
        }
      } catch (e) {
        console.log('Could not retrieve existing session, creating new one');
      }
    }

    // Create a new Stripe Identity Verification Session
    const verificationSession = await stripe.identity.verificationSessions.create({
      type: 'document',
      metadata: {
        user_id: userId,
        user_email: userEmail || ''
      },
      options: {
        document: {
          // Allow passport, driver's license, or ID card
          allowed_types: ['driving_license', 'passport', 'id_card'],
          require_id_number: false,
          require_live_capture: true,
          require_matching_selfie: true,
        },
      },
      return_url: returnUrl || `${process.env.URL || 'https://sphere.chatspheres.com'}/cashout.html?kyc=complete`,
    });

    // Store/update the verification record
    await supabase
      .from('kyc_verifications')
      .upsert({
        user_id: userId,
        stripe_verification_id: verificationSession.id,
        status: 'pending',
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      });

    console.log(`🆔 KYC session created for user ${userId}: ${verificationSession.id}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        url: verificationSession.url,
        sessionId: verificationSession.id,
        message: 'Please complete identity verification'
      }),
    };

  } catch (error) {
    console.error('❌ Error creating KYC session:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to create verification session',
        message: error.message 
      }),
    };
  }
};
