## LiveKit + Firebase Recording Stack

This project now expects a self‑hosted LiveKit stack that runs on a small Google Cloud VM (e2‑micro works if you enable 4 GB swap). The VM runs three containers:

1. `livekit` – signaling, SFU, TURN/webhook handling.
2. `egress` – LiveKit’s server-side recorder.
3. `controller` – Node service that issues access tokens, starts/stops recordings, and uploads completed files to Firebase Storage.

### 1. Prerequisites on the VM

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER
```

Reboot or re-login so the docker group is applied.

### 2. Environment variables

Create an `.env.livekit` file at the repo root (use `.env.livekit.example` as a template):

| Variable | Description |
| --- | --- |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Keys configured in `livekit/livekit.yaml`. |
| `LIVEKIT_HOST` | Public URL (including protocol) that the controller and egress services use, e.g. `https://livekit.example.com:7880`. |
| `LIVEKIT_URL` / `LIVEKIT_WS_URL` | Optional internal URL override; takes precedence over `LIVEKIT_HOST` for controller + egress. |
| `LIVEKIT_EGRESS_URL` | Internal URL that the egress container uses (defaults to `http://livekit:7880`). |
| `LIVEKIT_WEBHOOK_API_KEY` / `LIVEKIT_WEBHOOK_API_SECRET` | Used to verify webhook requests; must match the values in `livekit/livekit.yaml`. |
| `LIVEKIT_CONTROL_API_KEY` | Shared secret used by the frontend when calling the controller endpoints. |
| `FIREBASE_*` vars | Service-account credentials for Firebase Storage + Realtime Database (the private key must keep literal `\n` sequences). |
| `RECORDING_OUTPUT_DIR` | Directory that both the egress and controller containers mount (`/recordings`). |
| `DELETE_LOCAL_AFTER_UPLOAD` | `true` to remove the raw file after it is pushed to Firebase Storage. |
| `CONTROL_PORT` | Port that exposes the controller API (defaults to `8789`). |

> **Note:** Docker Compose only auto-loads a file named `.env` from the directory where `docker-compose.yml` lives. Either copy your secrets file via `cp .env.livekit .env` before running commands, or pass `--env-file .env.livekit` to every `docker compose` invocation so the CLI can resolve the variables without warning.

### 3. LiveKit server config

1. Copy `livekit/livekit.yaml` and replace the placeholder values (`LIVEKIT_API_KEY_PLACEHOLDER`, webhook secrets, TURN domain, TLS cert paths, etc.).
2. Point `webhook.urls` at the controller service (`http://controller:8789/webhooks/livekit`) or your public URL if you expose it outside Docker.
3. Fill out `livekit/egress.yaml` with the exact same API key/secret pair that you configured in the `.env` file. The egress container will refuse to boot (with `missing config`) until this YAML exists and matches your LiveKit + Redis settings.

### 4. Start the stack

```bash
# load env vars without renaming the file
docker compose --env-file .env.livekit build controller
docker compose --env-file .env.livekit up -d

# or, if you prefer copying
cp .env.livekit .env
docker compose build controller
docker compose up -d
docker compose logs -f controller
```

The controller exposes:

- `POST /token`
- `POST /recordings/start`
- `POST /recordings/stop`
- `POST /webhooks/livekit` (internal)
- `GET /health`

Each request requires the shared secret header `x-api-key` that matches `LIVEKIT_CONTROL_API_KEY`.

### 5. Frontend configuration

The SPA reads runtime settings from `window.__CHATSPHERES_CONFIG__` **or** from `data-*` attributes on the `<body>` element. Pick whichever works best for your hosting setup:

```html
<script>
  window.__CHATSPHERES_CONFIG__ = {
    livekitUrl: 'wss://livekit.example.com',
    controlApiBaseUrl: 'https://controller.example.com',
    controlApiKey: 'same-as-LIVEKIT_CONTROL_API_KEY',
    tokenEndpoint: 'https://controller.example.com/token',
    recordingsEndpoint: 'https://controller.example.com/recordings'
  };
</script>
```

If you prefer HTML attributes, keep the inline placeholders from `index.html` and set them server-side:

```html
<body
  data-livekit-url="wss://livekit.example.com"
  data-livekit-control="https://controller.example.com"
  data-livekit-control-key="..."
  data-livekit-token="https://controller.example.com/token"
  data-livekit-recordings="https://controller.example.com/recordings">
```

### 6. Recording flow

1. The frontend calls `/token` to join a LiveKit room.
2. “Start Recording” triggers `/recordings/start`, which launches a Room Composite egress job that writes to the shared `recordings/` volume.
3. LiveKit webhooks notify the controller when egress completes. The controller uploads the MP4 to Firebase Storage and updates the Firebase Realtime Database entry (`recordings/{btoa(roomUrl)}/{recordingId}`) with `status: uploaded` and a signed download URL.
4. Optional: set `DELETE_LOCAL_AFTER_UPLOAD=true` to reclaim disk space on the VM automatically.

That’s it—the VM now provides signaling, SFU routing, server-side recording, and a Firebase-backed archive without any Daily.co dependencies.
