'use strict';

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

function getControlApiBaseUrl() {
  return (process.env.CONTROL_API_BASE_URL || process.env.LIVEKIT_CONTROL_API_BASE_URL || '').replace(/\/$/, '');
}

function getControlApiKey() {
  return process.env.CONTROL_API_KEY || process.env.LIVEKIT_CONTROL_API_KEY || '';
}

async function stopActiveRecording({ recordingId, roomName, roomUrl }) {
  const baseUrl = getControlApiBaseUrl();
  const apiKey = getControlApiKey();
  if (!baseUrl || !apiKey || !recordingId) return { attempted: false };

  try {
    const response = await fetch(`${baseUrl}/recordings/stop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ recordingId, roomName, roomUrl }),
    });

    if (!response.ok) {
      return { attempted: true, ok: false };
    }

    return { attempted: true, ok: true };
  } catch (error) {
    return { attempted: true, ok: false };
  }
}

async function clearCreatorRoomQueue(roomId, endedAt) {
  if (!roomId) return;
  try {
    await supabase
      .from('room_queue')
      .update({
        status: 'left',
        ended_at: endedAt,
      })
      .eq('room_id', roomId)
      .in('status', ['waiting', 'active']);
  } catch (error) {}
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const nowIso = new Date().toISOString();
  const emptyEndsAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();

  try {
    try {
      await supabase
        .from('active_rooms')
        .update({ ends_at: emptyEndsAt })
        .eq('status', 'live')
        .eq('room_type', 'creator')
        .eq('participant_count', 0)
        .gt('ends_at', emptyEndsAt);
    } catch (e) {}

    try {
      await supabase
        .from('active_rooms')
        .update({ ends_at: emptyEndsAt })
        .eq('status', 'live')
        .eq('room_type', 'creator')
        .eq('participant_count', 0)
        .is('ends_at', null);
    } catch (e) {}

    const { data: expiredCreatorRooms } = await supabase
      .from('active_rooms')
      .select('room_id, active_recording_id')
      .eq('status', 'live')
      .eq('room_type', 'creator')
      .not('ends_at', 'is', null)
      .lt('ends_at', nowIso);

    for (const room of expiredCreatorRooms || []) {
      await clearCreatorRoomQueue(room.room_id, nowIso);

      if (room.active_recording_id) {
        await stopActiveRecording({
          recordingId: room.active_recording_id,
          roomName: room.room_id,
          roomUrl: room.room_id,
        });
      }

      await supabase
        .from('active_rooms')
        .update({
          status: 'ended',
          ended_at: nowIso,
          ended_reason: 'empty_timeout',
          ended_by: null,
          queue_cleared_at: nowIso,
          recording_stopped_at: room.active_recording_id ? nowIso : null,
          active_recording_id: null,
        })
        .eq('room_id', room.room_id);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        now: nowIso,
        emptyEndsAt,
        ended: (expiredCreatorRooms || []).length,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Failed' }),
    };
  }
};
