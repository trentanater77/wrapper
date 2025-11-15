const express = require('express');
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const {
  AccessToken,
  EgressClient,
  EncodedFileOutput,
  FileType,
  RoomCompositeEgressRequest,
  WebhookReceiver,
} = require('livekit-server-sdk');

const {
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
  LIVEKIT_HOST = 'http://livekit:7880',
  LIVEKIT_EGRESS_URL,
  CONTROL_PORT = 8789,
  RECORDING_OUTPUT_DIR = '/recordings',
  FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY,
  FIREBASE_STORAGE_BUCKET,
  FIREBASE_DATABASE_URL,
  DELETE_LOCAL_AFTER_UPLOAD = 'false',
  LIVEKIT_WEBHOOK_API_KEY,
  LIVEKIT_WEBHOOK_API_SECRET,
} = process.env;

const livekitEndpoint = LIVEKIT_EGRESS_URL || LIVEKIT_HOST;
const app = express();
const jsonParser = express.json({ limit: '1mb' });

app.use((req, res, next) => {
  if (req.originalUrl === '/webhooks/livekit') {
    next();
  } else {
    jsonParser(req, res, next);
  }
});

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
if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY && FIREBASE_STORAGE_BUCKET) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
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

app.post('/token', requireApiKey, (req, res) => {
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

    res.json({ token: token.toJwt() });
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

  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const fileOutput = EncodedFileOutput.fromPartial({
      filepath: outputPath,
      fileType: FileType.MP4,
    });

    const request = RoomCompositeEgressRequest.fromPartial({
      roomName,
      layout: layout || preferences.layout || 'grid',
      audioOnly: false,
      videoOnly: false,
      fileOutputs: [fileOutput],
    });

    const info = await egressClient.startRoomCompositeEgress(request);

    activeRecordings.set(info.egressId, {
      roomName,
      roomUrl,
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

app.post('/recordings/stop', requireApiKey, async (req, res) => {
  if (!egressClient) {
    return res.status(500).json({ error: 'Egress client is not configured.' });
  }
  const { recordingId } = req.body || {};
  if (!recordingId) {
    return res.status(400).json({ error: 'recordingId is required.' });
  }

  try {
    await egressClient.stopEgress(recordingId);
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

async function finalizeRecordingUpload(egressId, egressInfo) {
  const active = activeRecordings.get(egressId) || {};
  const result =
    egressInfo?.result?.file ||
    (egressInfo?.result?.fileResults && egressInfo.result.fileResults[0]) ||
    (egressInfo?.fileResults && egressInfo.fileResults[0]) ||
    {};

  const recordedFile = result.filename || active.filepath;
  if (!recordedFile) {
    console.warn(`⚠️ No file path reported for recording ${egressId}`);
    return;
  }

  const absolutePath = path.isAbsolute(recordedFile)
    ? recordedFile
    : path.join(RECORDING_OUTPUT_DIR, recordedFile);

  let downloadUrl = null;
  if (storageBucket && fs.existsSync(absolutePath)) {
    const destination = `recordings/${path.basename(absolutePath)}`;
    await storageBucket.upload(absolutePath, {
      destination,
      metadata: { contentType: 'video/mp4' },
    });

    const [signedUrl] = await storageBucket.file(destination).getSignedUrl({
      action: 'read',
      expires: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 days
    });
    downloadUrl = signedUrl;
    console.log(`✅ Uploaded recording ${egressId} to Firebase Storage`);
  } else {
    console.warn(`⚠️ Skipped Firebase upload for ${egressId} (storage not configured or file missing)`);
  }

  if (DELETE_LOCAL_AFTER_UPLOAD === 'true' && fs.existsSync(absolutePath)) {
    fs.unlink(absolutePath, (err) => {
      if (err) {
        console.warn(`⚠️ Unable to delete ${absolutePath}:`, err);
      }
    });
  }

  if (realtimeDb && active.roomUrl) {
    const roomKey = Buffer.from(active.roomUrl).toString('base64');
    const recordingPath = `recordings/${roomKey}/${active.recordingId || egressId}`;
    try {
      await realtimeDb.ref(recordingPath).update({
        status: downloadUrl ? 'uploaded' : 'complete',
        uploadProgress: 100,
        uploadCompletedAt: admin.database.ServerValue.TIMESTAMP,
        downloadUrl: downloadUrl || null,
      });
    } catch (error) {
      console.error('❌ Failed to update Firebase metadata:', error);
    }
  }

  activeRecordings.delete(egressId);
}

const port = Number(CONTROL_PORT) || 8789;
app.listen(port, () => {
  console.log(`🚀 LiveKit controller listening on port ${port}`);
});
