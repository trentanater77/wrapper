const express = require('express');
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const {
  AccessToken,
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  RoomCompositeEgressRequest,
  WebhookReceiver,
} = require('livekit-server-sdk');

const {
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
  LIVEKIT_HOST = 'http://livekit:7880',
  LIVEKIT_URL,
  LIVEKIT_WS_URL,
  LIVEKIT_EGRESS_URL,
  CONTROL_PORT = 8789,
  RECORDING_OUTPUT_DIR = '/recordings',
  FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY,
  FIREBASE_STORAGE_BUCKET,
  FIREBASE_DATABASE_URL,
  FIREBASE_SERVICE_ACCOUNT_JSON,
  DELETE_LOCAL_AFTER_UPLOAD = 'false',
  LIVEKIT_WEBHOOK_API_KEY,
  LIVEKIT_WEBHOOK_API_SECRET,
} = process.env;

const livekitEndpoint = LIVEKIT_EGRESS_URL || LIVEKIT_URL || LIVEKIT_WS_URL || LIVEKIT_HOST;
const app = express();
const allowedOrigins = (process.env.LIVEKIT_ALLOWED_ORIGINS || 'https://sphere.chatspheres.com')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && (allowedOrigins.length === 0 || allowedOrigins.includes(origin))) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  return next();
});

const jsonParser = express.json({ limit: '1mb' });

app.use((req, res, next) => {
  if (req.originalUrl === '/webhooks/livekit') {
    next();
  } else {
    jsonParser(req, res, next);
  }
});

const STOP_RETRY_ATTEMPTS = Number(process.env.LIVEKIT_EGRESS_STOP_MAX_ATTEMPTS || 3);
const STOP_RETRY_DELAY_MS = Number(process.env.LIVEKIT_EGRESS_STOP_RETRY_DELAY_MS || 2_000);
const STOP_STATUS_CHECKS = Number(process.env.LIVEKIT_EGRESS_STOP_STATUS_CHECKS || 2);
const STOP_STATUS_CHECK_DELAY_MS = Number(process.env.LIVEKIT_EGRESS_STOP_STATUS_INTERVAL_MS || 1_500);

const egressClient =
  LIVEKIT_API_KEY && LIVEKIT_API_SECRET
    ? new EgressClient(livekitEndpoint, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
    : null;

const webhookReceiver =
  LIVEKIT_WEBHOOK_API_KEY && LIVEKIT_WEBHOOK_API_SECRET
    ? new WebhookReceiver(LIVEKIT_WEBHOOK_API_KEY, LIVEKIT_WEBHOOK_API_SECRET)
    : null;

const activeRecordings = new Map();

let firebaseReady = false;
let firebaseCredential = null;

if (FIREBASE_SERVICE_ACCOUNT_JSON && fs.existsSync(FIREBASE_SERVICE_ACCOUNT_JSON)) {
  try {
    const serviceAccount = JSON.parse(fs.readFileSync(FIREBASE_SERVICE_ACCOUNT_JSON, 'utf8'));
    firebaseCredential = admin.credential.cert(serviceAccount);
  } catch (error) {
    console.error('❌ Failed to load Firebase service account JSON:', error);
  }
} else if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
  firebaseCredential = admin.credential.cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  });
}

if (firebaseCredential && FIREBASE_STORAGE_BUCKET) {
  admin.initializeApp({
    credential: firebaseCredential,
    storageBucket: FIREBASE_STORAGE_BUCKET,
    databaseURL: FIREBASE_DATABASE_URL || undefined,
  });
  firebaseReady = true;
}

const storageBucket = firebaseReady ? admin.storage().bucket() : null;
const realtimeDb = firebaseReady && FIREBASE_DATABASE_URL ? admin.database() : null;

if (!fs.existsSync(RECORDING_OUTPUT_DIR)) {
  fs.mkdirSync(RECORDING_OUTPUT_DIR, { recursive: true });
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    livekit: !!egressClient,
    firebase: firebaseReady,
  });
});

function requireApiKey(req, res, next) {
  if (!process.env.LIVEKIT_CONTROL_API_KEY) {
    return next();
  }
  const provided = req.get('x-api-key');
  if (provided !== process.env.LIVEKIT_CONTROL_API_KEY) {
    return res.status(401).json({ error: 'Invalid API key.' });
  }
  return next();
}

app.post('/token', requireApiKey, async (req, res) => {
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return res.status(500).json({ error: 'LiveKit credentials are not configured.' });
  }

  const { roomName, identity, metadata = {}, role } = req.body || {};
  if (!roomName || !identity) {
    return res.status(400).json({ error: 'roomName and identity are required.' });
  }

  try {
    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity,
      name: metadata.displayName || identity,
      metadata: JSON.stringify(metadata || {}),
    });

    const isSpectator = (metadata.role || role) === 'spectator';
    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: !isSpectator,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: !isSpectator,
    });

    const jwt = await token.toJwt();
    res.json({ token: jwt });
  } catch (error) {
    console.error('❌ Token generation failed:', error);
    res.status(500).json({ error: 'Token generation failed.' });
  }
});

app.post('/recordings/start', requireApiKey, async (req, res) => {
  if (!egressClient) {
    return res.status(500).json({ error: 'Egress client is not configured.' });
  }

  const { roomName, preferences = {}, metadata = {}, roomUrl, layout } = req.body || {};
  if (!roomName) {
    return res.status(400).json({ error: 'roomName is required.' });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${roomName}_${timestamp}.mp4`;
  const outputPath = path.join(RECORDING_OUTPUT_DIR, filename);
  const normalizedRoomUrl = typeof roomUrl === 'string' && roomUrl.trim().length > 0 ? roomUrl.trim() : null;
  const roomKey = normalizedRoomUrl ? Buffer.from(normalizedRoomUrl).toString('base64') : null;

  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const layoutOption = layout || preferences.layout || 'grid';
    const output = {
      file: {
        filepath: outputPath,
        fileType: EncodedFileType.MP4,
      },
    };

    const info = await egressClient.startRoomCompositeEgress(
      roomName,
      output,
      {
        layout: layoutOption,
        audioOnly: false,
        videoOnly: false,
      }
    );

    activeRecordings.set(info.egressId, {
      roomName,
      roomUrl: normalizedRoomUrl,
      roomKey,
      recordingId: info.egressId,
      filepath: outputPath,
      preferences,
      metadata,
    });

    res.json({
      recordingId: info.egressId,
      filepath: outputPath,
    });
  } catch (error) {
    console.error('❌ Failed to start recording:', error);
    res.status(500).json({ error: 'Failed to start recording.' });
  }
});

function isTerminalEgressStatus(status) {
  return (
    status === 'EGRESS_COMPLETE' ||
    status === 'EGRESS_FAILED' ||
    status === 'EGRESS_ABORTED'
  );
}

app.post('/recordings/stop', requireApiKey, async (req, res) => {
  if (!egressClient) {
    return res.status(500).json({ error: 'Egress client is not configured.' });
  }
  const { recordingId } = req.body || {};
  if (!recordingId) {
    return res.status(400).json({ error: 'recordingId is required.' });
  }

  try {
    const info = await stopEgressWithBackoff(recordingId);
    await finalizeStopResult(recordingId, info);
    res.json({ ok: true });
  } catch (error) {
    console.error('❌ Failed to stop recording:', error);
    res.status(500).json({ error: 'Failed to stop recording.' });
  }
});

app.post('/webhooks/livekit', express.raw({ type: '*/*', limit: '2mb' }), async (req, res) => {
  let payload;

  try {
    if (webhookReceiver) {
      payload = webhookReceiver.receive(req.body, req.get('Authorization') || '');
    } else {
      payload = JSON.parse(req.body.toString());
    }
  } catch (error) {
    console.error('❌ Failed to parse webhook payload:', error);
    return res.status(400).send('invalid payload');
  }

  if (payload?.event?.startsWith('egress')) {
    try {
      await handleEgressEvent(payload);
    } catch (error) {
      console.error('❌ Failed to handle egress webhook:', error);
    }
  }

  res.json({ received: true });
});

async function handleEgressEvent(payload) {
  const egressInfo = payload.egressInfo || payload;
  const egressId = egressInfo?.egressId || egressInfo?.id;
  if (!egressId) {
    return;
  }

  const status = egressInfo.status || payload.status;
  if (
    payload.event === 'egress_ended' ||
    payload.event === 'egress_complete' ||
    status === 'EGRESS_COMPLETE' ||
    status === 'EGRESS_FAILED'
  ) {
    await finalizeRecordingUpload(egressId, egressInfo);
  }
}

function getErrorCode(error) {
  if (!error) {
    return null;
  }
  if (typeof error.code === 'string') {
    return error.code;
  }
  if (typeof error.status === 'number') {
    if (error.status === 404) {
      return 'not_found';
    }
    if (error.status === 408) {
      return 'deadline_exceeded';
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isEgressStillActive(egressId) {
  if (!egressClient) {
    return null;
  }
  try {
    const items = await egressClient.listEgress();
    return items.some((item) => (item.egressId || item.id) === egressId);
  } catch (error) {
    console.warn(`⚠️ Unable to confirm egress status for ${egressId}:`, error);
    return null;
  }
}

async function confirmEgressInactive(egressId) {
  for (let attempt = 0; attempt < STOP_STATUS_CHECKS; attempt += 1) {
    const active = await isEgressStillActive(egressId);
    if (active === false) {
      return true;
    }
    if (active === null) {
      return false;
    }
    await sleep(STOP_STATUS_CHECK_DELAY_MS);
  }
  return false;
}

async function stopEgressWithBackoff(egressId) {
  let lastError = null;

  for (let attempt = 1; attempt <= STOP_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const info = await egressClient.stopEgress(egressId);
      return info;
    } catch (error) {
      lastError = error;
      const code = getErrorCode(error);
      if (code === 'not_found' || code === 'failed_precondition') {
        console.warn(`⚠️ Stop requested for ${egressId}, but LiveKit reported it was already stopped.`);
        return null;
      }
      if ((code === 'deadline_exceeded' || code === 'unavailable') && attempt < STOP_RETRY_ATTEMPTS) {
        console.warn(
          `⚠️ Stop request timed out for ${egressId}. Retrying (${attempt}/${STOP_RETRY_ATTEMPTS})...`
        );
        await sleep(STOP_RETRY_DELAY_MS);
        continue;
      }
      break;
    }
  }

  if (lastError) {
    const code = getErrorCode(lastError);
    if (code === 'deadline_exceeded' || code === 'unavailable') {
    const inactive = await confirmEgressInactive(egressId);
    if (inactive) {
      console.warn(`⚠️ Stop request timed out, but ${egressId} is no longer active.`);
      return null;
    }
    }
  }

  throw lastError;
}

async function finalizeStopResult(recordingId, info) {
  if (info && isTerminalEgressStatus(info.status)) {
    try {
      await finalizeRecordingUpload(recordingId, info);
      return;
    } catch (finalizeErr) {
      console.warn(`⚠️ Stop succeeded but finalize failed for ${recordingId}:`, finalizeErr);
    }
  }

  if (!info) {
    try {
      await finalizeRecordingUpload(recordingId, {
        egressId: recordingId,
        status: 'EGRESS_COMPLETE'
      });
    } catch (fallbackErr) {
      console.warn(`⚠️ Unable to finalize recording ${recordingId} without egress info:`, fallbackErr);
    }
  }
}

async function finalizeRecordingUpload(egressId, egressInfo) {
  console.log(`📼 finalizeRecordingUpload invoked for ${egressId}`);
  const active = activeRecordings.get(egressId) || {};
  const roomKey = await resolveRecordingRoomKey(active, egressId);
  const result =
    egressInfo?.result?.file ||
    (egressInfo?.result?.fileResults && egressInfo.result.fileResults[0]) ||
    (egressInfo?.fileResults && egressInfo.fileResults[0]) ||
    {};

  const recordedFile = result.filename || active.filepath || (await findMostRecentRecordingFile());
  if (!recordedFile) {
    console.warn(`⚠️ No file path reported for recording ${egressId}`);
    await markRecordingLinkUnavailable(active, egressId, 'no_file_reported');
    return;
  }

  const absolutePath = path.isAbsolute(recordedFile)
    ? recordedFile
    : path.join(RECORDING_OUTPUT_DIR, recordedFile);

  let downloadUrl = null;
  const egressFailed = egressInfo?.status === 'EGRESS_FAILED';
  let linkStatus = 'pending';
  let linkError = egressInfo?.error || null;
  if (storageBucket && fs.existsSync(absolutePath)) {
    const destination = `recordings/${path.basename(absolutePath)}`;
    await storageBucket.upload(absolutePath, {
      destination,
      metadata: { contentType: 'video/mp4' },
    });

    // Make the file publicly readable so URLs never expire
    const file = storageBucket.file(destination);
    try {
      await file.makePublic();
      // Use permanent public URL (never expires)
      const bucketName = storageBucket.name;
      downloadUrl = `https://storage.googleapis.com/${bucketName}/${destination}`;
      console.log(`✅ Uploaded recording ${egressId} to Firebase Storage (public URL)`);
    } catch (publicError) {
      // If makePublic fails (e.g., uniform bucket access), fall back to signed URL
      console.warn(`⚠️ Could not make file public, using signed URL: ${publicError.message}`);
      const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 1000 * 60 * 60 * 24 * 365, // 1 year fallback
      });
      downloadUrl = signedUrl;
      console.log(`✅ Uploaded recording ${egressId} to Firebase Storage (signed URL)`);
    }
    linkStatus = 'ready';
  } else {
    console.warn(`⚠️ Skipped Firebase upload for ${egressId} (storage not configured or file missing)`);
    linkStatus = egressFailed ? 'failed' : 'missing';
    linkError = linkError || (storageBucket ? 'file_missing' : 'storage_unconfigured');
  }

  if (DELETE_LOCAL_AFTER_UPLOAD === 'true' && fs.existsSync(absolutePath)) {
    fs.unlink(absolutePath, (err) => {
      if (err) {
        console.warn(`⚠️ Unable to delete ${absolutePath}:`, err);
      }
    });
  }

  const finalStatus = downloadUrl ? 'uploaded' : egressFailed ? 'failed' : 'complete';
  if (realtimeDb && roomKey) {
    const recordingPath = `recordings/${roomKey}/${active.recordingId || egressId}`;
    try {
      await realtimeDb.ref(recordingPath).update({
        status: finalStatus,
        uploadProgress: 100,
        uploadCompletedAt: admin.database.ServerValue.TIMESTAMP,
        downloadUrl: downloadUrl || null,
        linkStatus,
        linkError: linkError || null
      });
      console.log(`💾 Recording metadata updated for ${egressId} (status=${finalStatus}, linkStatus=${linkStatus})`);
    } catch (error) {
      console.error('❌ Failed to update Firebase metadata:', error);
    }
  } else if (!downloadUrl) {
    const reason = roomKey ? linkError || 'unknown' : 'missing_room_reference';
    await markRecordingLinkUnavailable(active, egressId, reason);
  }

  activeRecordings.delete(egressId);
}

async function resolveRecordingRoomKey(active, recordingId) {
  if (active?.roomKey) {
    return active.roomKey;
  }
  if (active?.roomUrl) {
    return Buffer.from(active.roomUrl).toString('base64');
  }
  if (!realtimeDb) {
    return null;
  }
  try {
    const snapshot = await realtimeDb.ref('recordings').once('value');
    const rooms = snapshot.val() || {};
    for (const [key, recordings] of Object.entries(rooms)) {
      if (recordings && recordings[recordingId]) {
        return key;
      }
    }
  } catch (error) {
    console.warn(`⚠️ Failed to resolve room key for ${recordingId}:`, error);
  }
  return null;
}

async function markRecordingLinkUnavailable(active, egressId, reason) {
  if (!realtimeDb) {
    return;
  }
  const roomKey = await resolveRecordingRoomKey(active, egressId);
  if (!roomKey) {
    console.warn(`⚠️ Unable to mark recording ${egressId} as unavailable (room key missing)`);
    return;
  }
  const recordingPath = `recordings/${roomKey}/${active.recordingId || egressId}`;
  try {
    await realtimeDb.ref(recordingPath).update({
      status: 'failed',
      linkStatus: 'missing',
      linkError: reason,
      uploadCompletedAt: admin.database.ServerValue.TIMESTAMP
    });
  } catch (error) {
    console.error(`❌ Failed to mark recording ${egressId} as unavailable:`, error);
  }
}

async function findMostRecentRecordingFile() {
  try {
    const files = await fs.promises.readdir(RECORDING_OUTPUT_DIR);
    const mp4Files = files
      .filter((file) => file.toLowerCase().endsWith('.mp4'))
      .map((file) => ({
        name: file,
        fullPath: path.join(RECORDING_OUTPUT_DIR, file)
      }));
    if (!mp4Files.length) {
      return null;
    }
    mp4Files.sort((a, b) => {
      const aStat = fs.statSync(a.fullPath);
      const bStat = fs.statSync(b.fullPath);
      return bStat.mtimeMs - aStat.mtimeMs;
    });
    return mp4Files[0].fullPath;
  } catch (error) {
    console.warn('⚠️ Unable to enumerate recordings directory:', RECORDING_OUTPUT_DIR, error);
    return null;
  }
}

const port = Number(CONTROL_PORT) || 8789;
app.listen(port, () => {
  console.log(`🚀 LiveKit controller listening on port ${port}`);
});
