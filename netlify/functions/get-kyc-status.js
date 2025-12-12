'use strict';

/**
 * Get KYC Verification Status
 * 
 * Returns the user's current KYC verification status.
 * If status is 'pending', syncs with Stripe to get the real status.
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
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const userId = event.queryStringParameters?.userId;

    if (!userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'User ID is required' }),
      };
    }

    // Get KYC status from database
    const { data: kyc, error } = await supabase
      .from('kyc_verifications')
      .select('status, verified_at, first_name, last_name, stripe_verification_id, updated_at')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      throw error;
    }

    let finalStatus = kyc?.status || 'unverified';
    let needsRetry = false;
    let canStartNew = false;

    // If status is 'pending', check with Stripe to see what actually happened
    // This catches cases where user X'd out without completing
    if (kyc?.status === 'pending' && kyc?.stripe_verification_id) {
      try {
        console.log(`🔄 Checking Stripe status for session ${kyc.stripe_verification_id}`);
        const stripeSession = await stripe.identity.verificationSessions.retrieve(
          kyc.stripe_verification_id
        );
        
        console.log(`📋 Stripe session status: ${stripeSession.status}`);
        
        // Map Stripe status to our status
        switch (stripeSession.status) {
          case 'verified':
            // User completed verification! Update our database
            finalStatus = 'verified';
            const verifiedOutputs = stripeSession.verified_outputs || {};
            await supabase
              .from('kyc_verifications')
              .update({ 
                status: 'verified',
                verified_at: new Date().toISOString(),
                first_name: verifiedOutputs.first_name || null,
                last_name: verifiedOutputs.last_name || null,
                updated_at: new Date().toISOString()
              })
              .eq('user_id', userId);
            
            await supabase
              .from('gem_balances')
              .update({ kyc_verified: true })
              .eq('user_id', userId);
            
            console.log(`✅ Updated KYC status to verified for user ${userId}`);
            break;
            
          case 'canceled':
            // User explicitly canceled - they can start fresh
            finalStatus = 'unverified';
            canStartNew = true;
            await supabase
              .from('kyc_verifications')
              .update({ 
                status: 'unverified',
                stripe_verification_id: null, // Clear old session
                updated_at: new Date().toISOString()
              })
              .eq('user_id', userId);
            console.log(`🚫 User canceled verification - reset to unverified`);
            break;
            
          case 'requires_input':
            // Session exists but user didn't complete it (X'd out or had issues)
            // Check if session is expired (sessions expire after 24 hours)
            const sessionAge = Date.now() - new Date(stripeSession.created * 1000).getTime();
            const isExpired = sessionAge > 24 * 60 * 60 * 1000; // 24 hours
            
            if (isExpired) {
              // Session expired - user needs to start fresh
              finalStatus = 'unverified';
              canStartNew = true;
              await supabase
                .from('kyc_verifications')
                .update({ 
                  status: 'unverified',
                  stripe_verification_id: null,
                  updated_at: new Date().toISOString()
                })
                .eq('user_id', userId);
              console.log(`⏰ Session expired - reset to unverified`);
            } else {
              // Session still valid - user can continue or retry
              finalStatus = 'incomplete';
              needsRetry = true;
              console.log(`⚠️ Session requires input - user can continue`);
            }
            break;
            
          case 'processing':
            // Stripe is still processing - keep as pending
            finalStatus = 'pending';
            console.log(`⏳ Stripe still processing verification`);
            break;
            
          default:
            console.log(`❓ Unknown Stripe status: ${stripeSession.status}`);
        }
        
      } catch (stripeError) {
        // If we can't reach Stripe or session doesn't exist, 
        // allow user to start fresh if session is old
        console.error('⚠️ Could not check Stripe session:', stripeError.message);
        
        // If session is older than 24 hours, assume it's stale
        const updatedAt = kyc?.updated_at ? new Date(kyc.updated_at).getTime() : 0;
        const isStale = Date.now() - updatedAt > 24 * 60 * 60 * 1000;
        
        if (isStale || stripeError.code === 'resource_missing') {
          finalStatus = 'unverified';
          canStartNew = true;
          await supabase
            .from('kyc_verifications')
            .update({ 
              status: 'unverified',
              stripe_verification_id: null,
              updated_at: new Date().toISOString()
            })
            .eq('user_id', userId);
          console.log(`🔄 Stale session cleared - user can start fresh`);
        }
      }
    }

    const isVerified = finalStatus === 'verified';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        verified: isVerified,
        status: finalStatus,
        verifiedAt: kyc?.verified_at || null,
        firstName: kyc?.first_name || null,
        lastName: kyc?.last_name || null,
        needsRetry: needsRetry,
        canStartNew: canStartNew,
      }),
    };

  } catch (error) {
    console.error('❌ Error getting KYC status:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to get verification status',
        message: error.message 
      }),
    };
  }
};
