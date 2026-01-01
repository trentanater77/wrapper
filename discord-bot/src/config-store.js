import fs from 'fs/promises';
import path from 'path';

const DEFAULT_DATA = { guilds: {} };

function normalizePath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

export class ConfigStore {
  constructor({ filePath }) {
    this.filePath = normalizePath(filePath || 'data.json');
    this._data = null;
    this._writePromise = Promise.resolve();
  }

  async load() {
    if (this._data) return this._data;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this._data = parsed && typeof parsed === 'object' ? parsed : { ...DEFAULT_DATA };
    } catch {
      this._data = { ...DEFAULT_DATA };
      await this.save();
    }
    if (!this._data.guilds || typeof this._data.guilds !== 'object') {
      this._data.guilds = {};
    }
    return this._data;
  }

  async save() {
    await this.load();
    if (!this.filePath) {
      throw new Error('ConfigStore: missing filePath');
    }
    const payload = JSON.stringify(this._data, null, 2);
    this._writePromise = this._writePromise.then(async () => {
      const dir = path.dirname(this.filePath);
      if (dir) {
        await fs.mkdir(dir, { recursive: true });
      }
      await fs.writeFile(this.filePath, payload, 'utf8');
    });
    return this._writePromise;
  }

  async getGuild(guildId) {
    const data = await this.load();
    if (!data.guilds[guildId]) {
      data.guilds[guildId] = {};
      await this.save();
    }
    return data.guilds[guildId];
  }

  async setGuild(guildId, patch) {
    const data = await this.load();
    const current = data.guilds[guildId] || {};
    data.guilds[guildId] = { ...current, ...patch };
    await this.save();
    return data.guilds[guildId];
  }

  async resetGuild(guildId) {
    const data = await this.load();
    data.guilds[guildId] = {};
    await this.save();
    return data.guilds[guildId];
  }
}
