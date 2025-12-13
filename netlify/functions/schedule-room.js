'use strict';

/**
 * Schedule Room
 * 
 * Handle scheduled event operations:
 * - Create scheduled event
 * - List upcoming events
 * - Get event details
 * - Go live (convert scheduled event to live room)
 * - Cancel event
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // GET: List scheduled events or get specific event
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};
      const { eventId, hostId, upcoming } = params;

      if (eventId) {
        // Get specific event
        const { data: eventData, error } = await supabase
          .from('scheduled_events')
          .select('*')
          .eq('id', eventId)
          .single();

        if (error) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Event not found' }),
          };
        }

        // Get reminder count
        const { count: reminderCount } = await supabase
          .from('event_reminders')
          .select('*', { count: 'exact', head: true })
          .eq('event_id', eventId);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            event: {
              ...eventData,
              reminderCount: reminderCount || 0,
            },
          }),
        };
      }

      // List events
      let query = supabase
        .from('scheduled_events')
        .select('*')
        .order('scheduled_at', { ascending: true });

      if (hostId) {
        // Get events for a specific host
        query = query.eq('host_id', hostId);
      }

      if (upcoming === 'true') {
        // Only get upcoming scheduled events (not live or ended)
        const now = new Date().toISOString();
        console.log(`📅 Fetching upcoming events (scheduled_at >= ${now})`);
        query = query
          .eq('status', 'scheduled')
          .gte('scheduled_at', now);
      }

      const { data: events, error } = await query.limit(50);
      
      console.log(`📅 Query result: ${events?.length || 0} events, error: ${error?.message || 'none'}`);

      if (error) {
        // Table might not exist
        if (error.code === '42P01' || error.message?.includes('does not exist')) {
          console.log('📅 scheduled_events table not found');
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ events: [], message: 'Table not found - run migration' }),
          };
        }
        throw error;
      }

      // Get reminder counts for all events
      const eventIds = events.map(e => e.id);
      let reminderCounts = {};

      if (eventIds.length > 0) {
        const { data: reminders } = await supabase
          .from('event_reminders')
          .select('event_id')
          .in('event_id', eventIds);

        if (reminders) {
          reminders.forEach(r => {
            reminderCounts[r.event_id] = (reminderCounts[r.event_id] || 0) + 1;
          });
        }
      }

      // Enrich events with reminder counts
      const enrichedEvents = events.map(e => ({
        ...e,
        reminderCount: reminderCounts[e.id] || 0,
      }));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ events: enrichedEvents }),
      };

    } catch (error) {
      console.error('❌ Error getting scheduled events:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to get scheduled events' }),
      };
    }
  }

  // POST: Event operations
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { action } = body;

    switch (action) {
      case 'create': {
        const {
          hostId,
          hostName,
          hostAvatar,
          title,
          description,
          coverImageUrl,
          roomType,
          challengerTimeLimit,
          maxQueueSize,
          scheduledAt,
          timezone,
          forumId,
          forumSlug,
          forumName,
        } = body;

        if (!hostId || !title || !scheduledAt) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({
              error: 'Missing required fields',
              required: ['hostId', 'title', 'scheduledAt'],
            }),
          };
        }

        // Validate scheduled time is in the future
        const scheduledTime = new Date(scheduledAt);
        if (scheduledTime <= new Date()) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Scheduled time must be in the future' }),
          };
        }

        // Build the insert object - base fields only
        const eventData = {
          host_id: hostId,
          host_name: hostName || 'Host',
          host_avatar: hostAvatar,
          title,
          description,
          cover_image_url: coverImageUrl,
          room_type: roomType || 'creator',
          challenger_time_limit: challengerTimeLimit,
          max_queue_size: maxQueueSize,
          scheduled_at: scheduledAt,
          timezone: timezone || 'UTC',
          status: 'scheduled',
        };

        // Try to create the scheduled event first without forum fields
        let { data: newEvent, error } = await supabase
          .from('scheduled_events')
          .insert(eventData)
          .select()
          .single();

        // If forum fields were provided and insert succeeded, try to update with forum info
        if (!error && newEvent && (forumId || forumSlug || forumName)) {
          const forumUpdate = {};
          if (forumId) forumUpdate.forum_id = forumId;
          if (forumSlug) forumUpdate.forum_slug = forumSlug;
          if (forumName) forumUpdate.forum_name = forumName;
          
          // Try to update - if columns don't exist, this will fail silently
          const { data: updated, error: updateError } = await supabase
            .from('scheduled_events')
            .update(forumUpdate)
            .eq('id', newEvent.id)
            .select()
            .single();
          
          if (!updateError && updated) {
            newEvent = updated;
            console.log(`📅 Added forum info to event: ${forumSlug}`);
          } else if (updateError) {
            // Forum columns don't exist yet - that's okay, just log it
            console.log(`📅 Forum columns not available (run migration): ${updateError.message}`);
          }
        }

        if (error) {
          if (error.code === '42P01') {
            return {
              statusCode: 500,
              headers,
              body: JSON.stringify({ error: 'Scheduled events table not found. Please run migration.' }),
            };
          }
          console.error('❌ Error creating scheduled event:', error);
          throw error;
        }

        console.log(`📅 Event scheduled: ${newEvent.id} by ${hostName} at ${scheduledAt}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            event: newEvent,
          }),
        };
      }

      case 'update': {
        const { eventId, hostId, ...updates } = body;

        if (!eventId || !hostId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Event ID and Host ID are required' }),
          };
        }

        // Verify ownership
        const { data: existingEvent } = await supabase
          .from('scheduled_events')
          .select('host_id, status')
          .eq('id', eventId)
          .single();

        if (!existingEvent) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Event not found' }),
          };
        }

        if (existingEvent.host_id !== hostId) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ error: 'Only the host can update this event' }),
          };
        }

        if (existingEvent.status !== 'scheduled') {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Cannot update event that is already live or ended' }),
          };
        }

        // Filter allowed update fields
        const allowedFields = ['title', 'description', 'cover_image_url', 'scheduled_at', 'timezone', 'challenger_time_limit', 'max_queue_size'];
        const filteredUpdates = {};
        
        for (const key of allowedFields) {
          // Convert camelCase to snake_case
          const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
          const camelKey = key;
          
          if (updates[camelKey] !== undefined) {
            filteredUpdates[snakeKey] = updates[camelKey];
          } else if (updates[snakeKey] !== undefined) {
            filteredUpdates[snakeKey] = updates[snakeKey];
          }
        }

        filteredUpdates.updated_at = new Date().toISOString();

        const { data: updatedEvent, error } = await supabase
          .from('scheduled_events')
          .update(filteredUpdates)
          .eq('id', eventId)
          .select()
          .single();

        if (error) throw error;

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            event: updatedEvent,
          }),
        };
      }

      case 'go-live': {
        const { eventId, hostId } = body;

        if (!eventId || !hostId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Event ID and Host ID are required' }),
          };
        }

        // Get the scheduled event
        const { data: scheduledEvent, error: fetchError } = await supabase
          .from('scheduled_events')
          .select('*')
          .eq('id', eventId)
          .single();

        if (fetchError || !scheduledEvent) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Event not found' }),
          };
        }

        // Verify ownership - ONLY the original host can go live
        if (scheduledEvent.host_id !== hostId) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ error: 'Only the original host can start this event' }),
          };
        }

        if (scheduledEvent.status !== 'scheduled') {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Event is not in scheduled status' }),
          };
        }

        // Generate room ID
        const roomId = 'room-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 6);
        const now = new Date();
        
        // Creator rooms don't have an ends_at - they only end when host ends them
        const isCreatorRoom = scheduledEvent.room_type === 'creator';
        const endsAt = isCreatorRoom ? null : new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();

        // Build room data
        const roomData = {
          room_id: roomId,
          host_id: hostId,
          host_name: scheduledEvent.host_name,
          host_avatar: scheduledEvent.host_avatar,
          room_type: scheduledEvent.room_type,
          topic: scheduledEvent.title,
          description: scheduledEvent.description,
          is_public: true,
          is_creator_room: isCreatorRoom,
          challenger_time_limit: scheduledEvent.challenger_time_limit,
          max_queue_size: scheduledEvent.max_queue_size,
          participant_count: 1,
          spectator_count: 0,
          pot_amount: 0,
          status: 'live',
          started_at: now.toISOString(),
          ends_at: endsAt,
        };
        
        // Add forum info if present in scheduled event
        if (scheduledEvent.forum_id) roomData.forum_id = scheduledEvent.forum_id;
        if (scheduledEvent.forum_slug) roomData.forum_slug = scheduledEvent.forum_slug;
        if (scheduledEvent.forum_name) roomData.forum_name = scheduledEvent.forum_name;

        // Create the live room
        const { data: room, error: roomError } = await supabase
          .from('active_rooms')
          .insert(roomData)
          .select()
          .single();

        if (roomError) throw roomError;

        // Update scheduled event status
        await supabase
          .from('scheduled_events')
          .update({
            status: 'live',
            room_id: roomId,
            went_live_at: now.toISOString(),
            updated_at: now.toISOString(),
          })
          .eq('id', eventId);

        console.log(`🔴 Event went live: ${eventId} -> ${roomId}`);

        // TODO: Send notifications to users who set reminders
        // This would be done via a separate job/worker

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            roomId,
            room,
            message: 'Event is now live!',
          }),
        };
      }

      case 'cancel': {
        const { eventId, hostId } = body;

        if (!eventId || !hostId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Event ID and Host ID are required' }),
          };
        }

        // Verify ownership
        const { data: existingEvent } = await supabase
          .from('scheduled_events')
          .select('host_id, status')
          .eq('id', eventId)
          .single();

        if (!existingEvent) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Event not found' }),
          };
        }

        if (existingEvent.host_id !== hostId) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ error: 'Only the host can cancel this event' }),
          };
        }

        if (existingEvent.status === 'live') {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Cannot cancel a live event' }),
          };
        }

        const { error } = await supabase
          .from('scheduled_events')
          .update({
            status: 'cancelled',
            updated_at: new Date().toISOString(),
          })
          .eq('id', eventId);

        if (error) throw error;

        console.log(`❌ Event cancelled: ${eventId}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true }),
        };
      }

      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid action' }),
        };
    }

  } catch (error) {
    console.error('❌ Error managing scheduled event:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to manage scheduled event',
        message: error.message,
      }),
    };
  }
};
