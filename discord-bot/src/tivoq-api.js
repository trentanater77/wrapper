function cleanBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/\/$/, '');
}

async function resolveFetch() {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch;
  try {
    const mod = await import('undici');
    if (typeof mod.fetch !== 'function') {
      throw new Error('No fetch implementation available.');
    }
    return mod.fetch;
  } catch (err) {
    const message = 'No fetch implementation available. Use Node 18+ (recommended) or add a fetch polyfill (e.g. install `undici`).';
    const e = new Error(message);
    e.cause = err;
    throw e;
  }
}

function safeJsonParse(text) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: true, json: {} };
  try {
    return { ok: true, json: JSON.parse(raw) };
  } catch {
    return { ok: false, json: null, rawText: raw };
  }
}

export function buildTivoqLinks({ inviteLink, roomType, host }) {
  const base = String(inviteLink || '');
  if (!base) return { hostLink: '', challengerLink: '', spectatorLink: '' };

  const joiner = base.includes('?') ? '&' : '?';
  const withRoomType = `${base}${joiner}roomType=${encodeURIComponent(roomType || 'creator')}`;

  const hostLink = host ? `${withRoomType}&host=true` : '';
  const challengerLink = `${withRoomType}&mode=queue`;
  const spectatorLink = `${withRoomType}&mode=spectator`;

  return { hostLink, challengerLink, spectatorLink };
}

export class TivoqApi {
  constructor({ baseUrl }) {
    this.baseUrl = cleanBaseUrl(baseUrl || 'https://tivoq.com');
  }

  async manageRoom(payload) {
    const url = `${this.baseUrl}/.netlify/functions/manage-room`;
    const fetchFn = await resolveFetch();
    const resp = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });

    const text = await resp.text().catch(() => '');
    const parsed = safeJsonParse(text);
    const json = parsed.ok ? parsed.json : {};

    if (!resp.ok) {
      const message = json?.error || json?.message || `manage-room failed (${resp.status})`;
      const err = new Error(message);
      err.status = resp.status;
      err.body = parsed.ok ? json : { rawText: parsed.rawText };
      throw err;
    }

    return json;
  }

  async manageQueue(payload) {
    const url = `${this.baseUrl}/.netlify/functions/manage-queue`;
    const fetchFn = await resolveFetch();
    const resp = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });

    const text = await resp.text().catch(() => '');
    const parsed = safeJsonParse(text);
    const json = parsed.ok ? parsed.json : {};

    if (!resp.ok) {
      const message = json?.error || json?.message || `manage-queue failed (${resp.status})`;
      const err = new Error(message);
      err.status = resp.status;
      err.body = parsed.ok ? json : { rawText: parsed.rawText };
      throw err;
    }

    return json;
  }
}
