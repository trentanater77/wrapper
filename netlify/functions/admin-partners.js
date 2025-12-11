const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // GET - List pending applications or current partners
    if (event.httpMethod === 'GET') {
      const action = event.queryStringParameters?.action;
      
      if (action === 'list-pending') {
        // Get pending applications with user email
        const { data: applications, error } = await supabase
          .from('partner_applications')
          .select('*')
          .eq('status', 'pending')
          .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        // Get emails for each user
        const appsWithEmail = await Promise.all(applications.map(async (app) => {
          const { data: user } = await supabase.auth.admin.getUserById(app.user_id);
          return { ...app, email: user?.user?.email };
        }));
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ applications: appsWithEmail })
        };
      }
      
      if (action === 'list-partners') {
        // Get current partners with user email
        const { data: partners, error } = await supabase
          .from('creator_partners')
          .select('*')
          .eq('status', 'active')
          .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        // Get emails for each partner
        const partnersWithEmail = await Promise.all(partners.map(async (p) => {
          const { data: user } = await supabase.auth.admin.getUserById(p.user_id);
          return { ...p, email: user?.user?.email };
        }));
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ partners: partnersWithEmail })
        };
      }
      
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid action' })
      };
    }

    // POST - Approve, reject, or quick-add partner
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { action } = body;
      
      if (action === 'approve') {
        const { userId, applicationId, tipSharePercent = 100, tier = 'founding' } = body;
        
        if (!userId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'userId required' })
          };
        }
        
        // Add to creator_partners
        const { error: partnerError } = await supabase
          .from('creator_partners')
          .upsert({
            user_id: userId,
            status: 'active',
            tip_share_percent: tipSharePercent,
            tier: tier,
            approved_by: 'admin',
            approved_at: new Date().toISOString()
          }, { onConflict: 'user_id' });
        
        if (partnerError) throw partnerError;
        
        // Update application status if provided
        if (applicationId) {
          await supabase
            .from('partner_applications')
            .update({
              status: 'approved',
              reviewed_by: 'admin',
              reviewed_at: new Date().toISOString()
            })
            .eq('id', applicationId);
        }
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true })
        };
      }
      
      if (action === 'reject') {
        const { applicationId } = body;
        
        if (!applicationId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'applicationId required' })
          };
        }
        
        const { error } = await supabase
          .from('partner_applications')
          .update({
            status: 'rejected',
            reviewed_by: 'admin',
            reviewed_at: new Date().toISOString()
          })
          .eq('id', applicationId);
        
        if (error) throw error;
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true })
        };
      }
      
      if (action === 'quick-add') {
        const { email, tipSharePercent = 100, tier = 'founding' } = body;
        
        if (!email) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'email required' })
          };
        }
        
        // Find user by email
        const { data: users, error: userError } = await supabase.auth.admin.listUsers();
        
        if (userError) throw userError;
        
        const user = users.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
        
        if (!user) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'User not found with that email' })
          };
        }
        
        // Check if already a partner
        const { data: existing } = await supabase
          .from('creator_partners')
          .select('id')
          .eq('user_id', user.id)
          .single();
        
        if (existing) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'User is already a partner' })
          };
        }
        
        // Add as partner
        const { error: partnerError } = await supabase
          .from('creator_partners')
          .insert({
            user_id: user.id,
            status: 'active',
            tip_share_percent: tipSharePercent,
            tier: tier,
            approved_by: 'admin',
            approved_at: new Date().toISOString()
          });
        
        if (partnerError) throw partnerError;
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, userId: user.id })
        };
      }
      
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid action' })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };

  } catch (error) {
    console.error('Admin partners error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
