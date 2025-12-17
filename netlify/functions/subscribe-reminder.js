'use strict';

/**
 * Subscribe Reminder
 * 
 * Handle "Remind Me" functionality for scheduled events:
 * - Subscribe to event reminder
 * - Unsubscribe from reminder
 * - Check if user has reminder set
 */

const { createClient } = require('@supabase/supabase-js');
const { sanitizeEmail } = require('./utils/sanitize');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

async function getEmailForUserId(userId) {
  if (!userId) return '';
  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (error) {
      console.warn('⚠️ Failed to fetch user email:', error.message);
      return '';
    }
    return data?.user?.email || '';
  } catch (e) {
    console.warn('⚠️ Failed to fetch user email:', e.message);
    return '';
  }
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // GET: Check if user has reminder for event
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};
      const { eventId, userId, email } = params;

      if (!eventId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Event ID is required' }),
        };
      }

      let query = supabase
        .from('event_reminders')
        .select('*')
        .eq('event_id', eventId);

      if (userId) {
        query = query.eq('user_id', userId);
      } else if (email) {
        query = query.eq('email', sanitizeEmail(email) || email);
      } else {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'User ID or email is required' }),
        };
      }

      const { data: reminder, error } = await query.single();

      if (error && error.code !== 'PGRST116') {
        // Table might not exist
        if (error.code === '42P01') {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ hasReminder: false }),
          };
        }
        throw error;
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          hasReminder: !!reminder,
          reminder: reminder || null,
        }),
      };

    } catch (error) {
      console.error('❌ Error checking reminder:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to check reminder' }),
      };
    }
  }

  // DELETE: Unsubscribe from reminder
  if (event.httpMethod === 'DELETE') {
    try {
      const params = event.queryStringParameters || {};
      const { eventId, userId, email } = params;

      if (!eventId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Event ID is required' }),
        };
      }

      let query = supabase
        .from('event_reminders')
        .delete()
        .eq('event_id', eventId);

      if (userId) {
        query = query.eq('user_id', userId);
      } else if (email) {
        query = query.eq('email', sanitizeEmail(email) || email);
      } else {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'User ID or email is required' }),
        };
      }

      const { error } = await query;

      if (error) throw error;

      console.log(`🔕 Reminder removed for event ${eventId}`);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true }),
      };

    } catch (error) {
      console.error('❌ Error removing reminder:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to remove reminder' }),
      };
    }
  }

  // POST: Subscribe to reminder
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { 
      eventId, 
      userId, 
      email, 
      pushSubscription,
      notifyBrowser,
      notifyEmail,
    } = body;

    const notifyBrowserValue = notifyBrowser !== false;
    const notifyEmailValue = notifyEmail !== false;

    let normalizedEmail = sanitizeEmail(email);

    if (!normalizedEmail && userId) {
      const userEmail = await getEmailForUserId(userId);
      normalizedEmail = sanitizeEmail(userEmail);
    }

    if (!eventId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Event ID is required' }),
      };
    }

    if (!userId && !email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'User ID or email is required' }),
      };
    }

    if (email && !normalizedEmail) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid email format' }),
      };
    }

    // Check if event exists and is scheduled
    const { data: eventData, error: eventError } = await supabase
      .from('scheduled_events')
      .select('id, status, scheduled_at')
      .eq('id', eventId)
      .single();

    if (eventError || !eventData) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Event not found' }),
      };
    }

    if (eventData.status !== 'scheduled') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Event is not scheduled' }),
      };
    }

    // Check if already subscribed
    let existingQuery = supabase
      .from('event_reminders')
      .select('id, email')
      .eq('event_id', eventId);

    if (userId) {
      existingQuery = existingQuery.eq('user_id', userId);
    } else {
      existingQuery = existingQuery.eq('email', normalizedEmail || email);
    }

    const { data: existing } = await existingQuery.single();

    if (existing) {
      // Update existing reminder
      const updatePayload = {
        push_subscription: pushSubscription || null,
        notify_browser: notifyBrowserValue,
        notify_email: notifyEmailValue,
      };

      if (!existing.email && normalizedEmail) {
        updatePayload.email = normalizedEmail;
      }

      let { error: updateError } = await supabase
        .from('event_reminders')
        .update(updatePayload)
        .eq('id', existing.id);

      if (updateError && updateError.code === '23505' && normalizedEmail && userId) {
        await supabase
          .from('event_reminders')
          .delete()
          .eq('event_id', eventId)
          .eq('email', normalizedEmail)
          .is('user_id', null);

        const retry = await supabase
          .from('event_reminders')
          .update(updatePayload)
          .eq('id', existing.id);
        updateError = retry.error;
      }

      if (updateError) throw updateError;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Reminder updated',
          alreadySubscribed: true,
        }),
      };
    }

    // Create new reminder
    const { data: newReminder, error: insertError } = await supabase
      .from('event_reminders')
      .insert({
        event_id: eventId,
        user_id: userId || null,
        email: normalizedEmail || null,
        push_subscription: pushSubscription || null,
        notify_browser: notifyBrowserValue,
        notify_email: notifyEmailValue,
      })
      .select()
      .single();

    if (insertError) {
      // Handle unique constraint
      if (insertError.code === '23505') {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            message: 'Already subscribed',
            alreadySubscribed: true,
          }),
        };
      }
      throw insertError;
    }

    console.log(`🔔 Reminder set for event ${eventId} by ${userId || email}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        reminder: newReminder,
      }),
    };

  } catch (error) {
    console.error('❌ Error setting reminder:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to set reminder',
        message: error.message,
      }),
    };
  }
};
