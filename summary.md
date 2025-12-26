# Tivoq Wrapper – Key Facts for Future Maintainers

This document orients anyone (human or AI) who lands in this repo without prior context. It highlights the moving pieces you must understand before changing or debugging the stack.

## High-Level Architecture
- **Frontend**: Single-page app in `index.html` served via Netlify. Uses Firebase auth/DB, Supabase session tracking, and LiveKit for real-time calls. No bundler; everything is vanilla JS plus inline modules.
- **Backend controller**: Express app in `server/controller.js`, containerized via `docker-compose.yml`. Exposes `/token` (LiveKit JWT issuance), `/recordings/*`, and `/webhooks/livekit`. Runs on a Google Cloud VM inside `/home/trenton_hammons777/livekit-stack`.
- **LiveKit**: The actual SFU instance is part of the same compose stack (`livekit/` configs). Frontend connects over WebSocket to `wss://api.chatspheres.com` (production) or the VM’s host/IP for debugging.

## Frontend Notes (`index.html`)
- Loads LiveKit SDK dynamically, preferring the vendored files `livekit-client.umd.min.js` and `livekit-client.esm.mjs`, then falling back to CDN. Because LiveKit’s bundles export slightly different shapes, the loader now:
  - Accepts `LiveKit`, `LiveKitClient`, `livekit`, or default exports.
  - Normalizes enums (`RoomEvent`, `TrackSource`, `DataPacketKind/DataPacket_Kind`).
  - Adds `ensureLiveKitConnectShim()` which builds a `connect()` helper via the SDK’s `Room` class if the bundle lacks one.
  - Uses `coerceLiveKitTokenValue()` to unwrap nested `{token: {...}}` responses and log diagnostics.
- Authentication + room join flow:
  1. Firebase auth supplies the user identity.
  2. Supabase records presence metadata.
  3. Frontend POSTs `{ roomName, identity, metadata }` to `/token`.
  4. Returned JWT feeds `LiveKitSDK.connect(url, token, options)`.
- Common false alarm: `Unchecked runtime.lastError: The message port closed before a response was received.` comes from the Edge “Enable Copy” extension; ignore.

## Backend Controller (`server/controller.js`)
- Requires env vars: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_CONTROL_API_KEY`, `LIVEKIT_WS_URL` (or `LIVEKIT_URL`/`LIVEKIT_HOST`), Firebase credentials (optional, for uploads), and `LIVEKIT_WEBHOOK_*` for webhook verification.
- `app.post('/token')` must remain `async` and `await token.toJwt()`. Returning the unresolved Promise produces `{}` and breaks LiveKit joins (manifested as `access_token=%5Bobject+Object%5D` in URLs).
- `requireApiKey` protects the control-plane routes when `LIVEKIT_CONTROL_API_KEY` is set (Netlify frontend sends it via `x-api-key` header).
- Recording endpoints:
  - `/recordings/start`: kicks off LiveKit egress with optional layout metadata, writes MP4 under `/recordings`, then optionally uploads to Firebase Storage and updates Realtime DB.
  - `/recordings/stop`: stops egress by ID.
- `/webhooks/livekit`: receives webhook events (verified if secrets present) and calls `handleEgressEvent` → `finalizeRecordingUpload` to manage Firebase + cleanup.

## Deployment + Ops
- **VM Path**: `/home/trenton_hammons777/livekit-stack`.
- **Compose command** (run on VM):
  ```
  cd /home/trenton_hammons777/livekit-stack
  docker compose up -d --build controller
  ```
  Re-run whenever `server/` changes.
- **Token smoke test** (from local dev box):
  ```
  curl -H "Content-Type: application/json" \
       -H "x-api-key: <LIVEKIT_CONTROL_API_KEY>" \
       -d '{"roomName":"debug-room","identity":"debug-user"}' \
       http://34.10.103.183:8789/token
  ```
  Expect a JSON object with a base64 JWT string, not an object.
- **SSH**: Use key `~/.ssh/livekit_gcp` (ed25519). Command:
  ```
  ssh -i ~/.ssh/livekit_gcp trenton_hammons777@34.10.103.183
  ```
  Public key must live in the VM’s `~/.ssh/authorized_keys` or GCP metadata. If you regenerate the key, paste the new `ssh-ed25519 ...` line into the VM’s SSH Keys section.

## Known Pitfalls
- Browser extensions can spam console errors; confirm they’re unrelated before debugging LiveKit.
- If the frontend logs `LiveKit SDK failed to initialize. Global exports missing.`, verify the new loader helpers haven’t been removed.
- `AccessToken.toJwt()` changed to async in newer LiveKit SDK versions; never call it without `await`.
- When debugging Netlify vs. local, ensure the allowed origins in the controller (`LIVEKIT_ALLOWED_ORIGINS`) include the domain you’re testing from, or CORS will silently block token requests.

## Quick Checklist When Things Break
1. Hit `/health` on the controller (`http://<host>:8789/health`) to ensure the container is up.
2. Run the curl token test above; if it fails, inspect controller logs via `docker compose logs -f controller`.
3. In the browser console, confirm `LiveKitSDK` has `connect` (shim installs it) and that the token string is non-empty.
4. If recording uploads fail, check Firebase env vars and whether `/recordings` is writable on the VM.

Keep this file updated whenever the architecture or operational workflow changes; it’s meant to be the launch pad for future troubleshooting.



