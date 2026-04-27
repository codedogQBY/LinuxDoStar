/**
 * ESM wrapper for sync.js (used by background service worker)
 */

import { STORAGE_KEY, StarStorage } from './storage-esm.js';

const SYNC_CONFIG_KEY = 'linuxdo_sync_config';
const GIST_FILENAME = 'linuxdo-stars.json';
const GIST_DESCRIPTION = 'LinuxDo Star Collector - Sync Data (do not delete)';

export const SyncManager = {
  async getConfig() {
    return new Promise(r => {
      chrome.storage.local.get([SYNC_CONFIG_KEY], res => {
        r(res[SYNC_CONFIG_KEY] || { token: '', gistId: '', lastSyncAt: '', autoSync: true, status: 'disconnected' });
      });
    });
  },

  async saveConfig(cfg) {
    return new Promise(r => chrome.storage.local.set({ [SYNC_CONFIG_KEY]: cfg }, r));
  },

  async sync() {
    const cfg = await this.getConfig();
    if (!cfg.token || !cfg.gistId) return { ok: false, message: '未配置同步' };
    try {
      await this.updateStatus('syncing');
      const remote = await this.readGist(cfg.token, cfg.gistId);
      const local = await StarStorage.getAll();
      const merged = this.merge(local, remote);
      await StarStorage.save(merged);
      await this.writeGist(cfg.token, cfg.gistId, merged);
      cfg.lastSyncAt = new Date().toISOString();
      await this.saveConfig(cfg);
      await this.updateStatus('synced');
      return { ok: true, message: '同步成功', merged };
    } catch (err) {
      console.error('[LinuxDo Star Sync]', err);
      await this.updateStatus('error', err.message);
      return { ok: false, message: err.message };
    }
  },

  async push() { return this.sync(); },
  async pull() { return this.sync(); },

  async updateStatus(status, error) {
    const cfg = await this.getConfig();
    cfg.status = status;
    if (error) cfg.lastError = error; else delete cfg.lastError;
    await this.saveConfig(cfg);
    try { chrome.runtime.sendMessage({ type: 'SYNC_STATUS', status, error }); } catch {}
  },

  async apiRequest(token, url, options = {}) {
    const resp = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers || {}),
      },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      if (resp.status === 401) throw new Error('Token 无效或已过期');
      if (resp.status === 404) throw new Error('Gist 不存在');
      throw new Error(`GitHub API 错误 (${resp.status}): ${body.substring(0, 100)}`);
    }
    return resp.json();
  },

  async findOrCreateGist(token) {
    const gists = await this.apiRequest(token, 'https://api.github.com/gists?per_page=100');
    for (const gist of gists) {
      if (gist.files[GIST_FILENAME]) return gist.id;
    }
    const newGist = await this.apiRequest(token, 'https://api.github.com/gists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: GIST_DESCRIPTION, public: false,
        files: { [GIST_FILENAME]: { content: JSON.stringify({ collections: {}, bookmarks: {} }, null, 2) } },
      }),
    });
    return newGist.id;
  },

  async readGist(token, gistId) {
    const gist = await this.apiRequest(token, `https://api.github.com/gists/${gistId}`);
    const file = gist.files[GIST_FILENAME];
    if (!file) throw new Error('Gist 中未找到数据文件');
    try {
      const data = JSON.parse(file.content);
      if (!data.collections) data.collections = {};
      if (!data.bookmarks) data.bookmarks = {};
      return data;
    } catch { return { collections: {}, bookmarks: {} }; }
  },

  async writeGist(token, gistId, data) {
    await this.apiRequest(token, `https://api.github.com/gists/${gistId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: { [GIST_FILENAME]: { content: JSON.stringify(data, null, 2) } } }),
    });
  },

  async validateToken(token) {
    try {
      const user = await this.apiRequest(token, 'https://api.github.com/user');
      return { ok: true, username: user.login, avatar: user.avatar_url };
    } catch (err) { return { ok: false, message: err.message }; }
  },

  async connect(token) {
    const v = await this.validateToken(token);
    if (!v.ok) return { ok: false, message: v.message };
    const gistId = await this.findOrCreateGist(token);
    await this.saveConfig({ token, gistId, lastSyncAt: '', autoSync: true, status: 'connected', username: v.username });
    const result = await this.sync();
    return { ok: true, message: `已连接为 @${v.username}`, gistId, ...result };
  },

  async disconnect() {
    await this.saveConfig({ token: '', gistId: '', lastSyncAt: '', autoSync: false, status: 'disconnected' });
    return { ok: true, message: '已断开同步' };
  },

  // ==================== Merge (with soft-delete) ====================
  merge(local, remote) {
    const result = { collections: {}, bookmarks: {} };

    // Collections
    const allColIds = new Set([...Object.keys(local.collections || {}), ...Object.keys(remote.collections || {})]);
    for (const id of allColIds) {
      const l = local.collections?.[id], r = remote.collections?.[id];
      if (!l) result.collections[id] = r;
      else if (!r) result.collections[id] = l;
      else result.collections[id] = this._newer(l, r);
    }
    if (!result.collections.default) {
      result.collections.default = { id: 'default', name: '默认收藏夹', icon: '⭐', color: '#eab308', createdAt: new Date().toISOString(), order: 0 };
    }

    // Bookmarks (with tombstone support)
    const allKeys = new Set([...Object.keys(local.bookmarks || {}), ...Object.keys(remote.bookmarks || {})]);
    for (const key of allKeys) {
      const l = local.bookmarks?.[key], r = remote.bookmarks?.[key];
      if (!l && !r) continue;
      if (!l) { result.bookmarks[key] = r; continue; }
      if (!r) { result.bookmarks[key] = l; continue; }

      const lDel = l._deleted, rDel = r._deleted;
      if (lDel && rDel) { result.bookmarks[key] = this._newer(l, r); continue; }
      if (lDel) { result.bookmarks[key] = new Date(l._deletedAt || 0) >= new Date(r.updatedAt || r.starredAt || 0) ? l : r; continue; }
      if (rDel) { result.bookmarks[key] = new Date(r._deletedAt || 0) >= new Date(l.updatedAt || l.starredAt || 0) ? r : l; continue; }

      // Both alive — merge
      const merged = { ...this._newer(l, r), posts: {} };
      const allPK = new Set([...Object.keys(l.posts || {}), ...Object.keys(r.posts || {})]);
      for (const pk of allPK) {
        const lp = l.posts?.[pk], rp = r.posts?.[pk];
        if (!lp && !rp) continue;
        if (!lp) { merged.posts[pk] = rp; continue; }
        if (!rp) { merged.posts[pk] = lp; continue; }
        const lpD = lp._deleted, rpD = rp._deleted;
        if (lpD && rpD) { merged.posts[pk] = this._newer(lp, rp); }
        else if (lpD) { merged.posts[pk] = new Date(lp._deletedAt || 0) >= new Date(rp.updatedAt || rp.starredAt || 0) ? lp : rp; }
        else if (rpD) { merged.posts[pk] = new Date(rp._deletedAt || 0) >= new Date(lp.updatedAt || lp.starredAt || 0) ? rp : lp; }
        else { merged.posts[pk] = this._newer(lp, rp); }
      }
      result.bookmarks[key] = merged;
    }

    // Purge old tombstones > 7 days
    const cutoff = Date.now() - 7 * 86400000;
    for (const [k, bk] of Object.entries(result.bookmarks)) {
      if (bk._deleted && new Date(bk._deletedAt || 0).getTime() < cutoff) { delete result.bookmarks[k]; continue; }
      if (bk.posts) for (const [pk, p] of Object.entries(bk.posts)) {
        if (p._deleted && new Date(p._deletedAt || 0).getTime() < cutoff) delete bk.posts[pk];
      }
    }
    return result;
  },

  _newer(a, b) {
    const ta = new Date(a.updatedAt || a._deletedAt || a.starredAt || a.createdAt || 0).getTime();
    const tb = new Date(b.updatedAt || b._deletedAt || b.starredAt || b.createdAt || 0).getTime();
    return ta >= tb ? { ...a } : { ...b };
  },
};
