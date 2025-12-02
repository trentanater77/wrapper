'use strict';

/**
 * Process Payout (Admin)
 * 
 * Admin function to approve/reject/complete payout requests.
 * Protected by admin secret key.
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Admin secret for protecting this endpoint
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'chatspheres-admin-2024';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Secret',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // Verify admin secret
  const adminSecret = event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'];
  if (adminSecret !== ADMIN_SECRET) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Unauthorized - Invalid admin secret' }),
    };
  }

  try {
    // GET - List pending payout requests
    if (event.httpMethod === 'GET') {
      const { data: requests, error } = await supabase
        .from('payout_requests')
        .select(`
          *,
          gem_balances!inner (
            spendable_gems,
            cashable_gems
          )
        `)
        .order('requested_at', { ascending: true });

      if (error) throw error;

      // Get user emails
      const userIds = requests?.map(r => r.user_id) || [];
      const { data: users } = await supabase
        .from('auth.users')
        .select('id, email')
        .in('id', userIds);

      const userMap = {};
      users?.forEach(u => userMap[u.id] = u.email);

      const enrichedRequests = requests?.map(r => ({
        ...r,
        userEmail: userMap[r.user_id] || 'Unknown'
      }));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          requests: enrichedRequests || [],
          summary: {
            pending: requests?.filter(r => r.status === 'pending').length || 0,
            processing: requests?.filter(r => r.status === 'processing').length || 0,
            completed: requests?.filter(r => r.status === 'completed').length || 0,
            rejected: requests?.filter(r => r.status === 'rejected').length || 0,
            totalPendingUsd: requests
              ?.filter(r => r.status === 'pending')
              .reduce((sum, r) => sum + parseFloat(r.usd_amount), 0) || 0
          }
        }),
      };
    }

    // POST - Update payout status
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { requestId, action, adminNotes } = body;

      if (!requestId || !action) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: 'Missing required fields',
            required: ['requestId', 'action']
          }),
        };
      }

      // Get the payout request
      const { data: request, error: fetchError } = await supabase
        .from('payout_requests')
        .select('*')
        .eq('id', requestId)
        .single();

      if (fetchError || !request) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Payout request not found' }),
        };
      }

      let newStatus;
      let updateData = {
        admin_notes: adminNotes || request.admin_notes,
        updated_at: new Date().toISOString()
      };

      switch (action) {
        case 'approve':
          newStatus = 'processing';
          updateData.status = newStatus;
          updateData.processed_at = new Date().toISOString();
          break;

        case 'complete':
          newStatus = 'completed';
          updateData.status = newStatus;
          updateData.completed_at = new Date().toISOString();
          
          // Log the completion
          await supabase
            .from('gem_transactions')
            .insert({
              user_id: request.user_id,
              transaction_type: 'payout_completed',
              amount: 0, // Already deducted when request was made
              wallet_type: 'cashable',
              description: `Payout completed: $${request.usd_amount} via ${request.payout_method}`
            });
          break;

        case 'reject':
          newStatus = 'rejected';
          updateData.status = newStatus;
          
          // Refund the gems back to cashable balance
          const { data: currentBalance } = await supabase
            .from('gem_balances')
            .select('cashable_gems')
            .eq('user_id', request.user_id)
            .single();

          await supabase
            .from('gem_balances')
            .update({ 
              cashable_gems: (currentBalance?.cashable_gems || 0) + request.gems_amount,
              updated_at: new Date().toISOString()
            })
            .eq('user_id', request.user_id);

          // Log the refund
          await supabase
            .from('gem_transactions')
            .insert({
              user_id: request.user_id,
              transaction_type: 'payout_rejected',
              amount: request.gems_amount,
              wallet_type: 'cashable',
              description: `Payout rejected - gems refunded. Reason: ${adminNotes || 'No reason provided'}`
            });
          break;

        default:
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
              error: 'Invalid action',
              validActions: ['approve', 'complete', 'reject']
            }),
          };
      }

      // Update the request
      const { error: updateError } = await supabase
        .from('payout_requests')
        .update(updateData)
        .eq('id', requestId);

      if (updateError) throw updateError;

      console.log(`💰 Payout ${requestId} ${action}: ${request.usd_amount} USD to ${request.payout_email}`);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          requestId,
          action,
          newStatus,
          message: `Payout request ${action}d successfully`
        }),
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };

  } catch (error) {
    console.error('❌ Error processing payout:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to process payout',
        message: error.message 
      }),
    };
  }
};
