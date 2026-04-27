/**
 * LinuxDo Star - Gist Sync Module
 * 通过 GitHub Gist 实现跨设备同步
 */

const SYNC_CONFIG_KEY = 'linuxdo_sync_config';
const GIST_FILENAME = 'linuxdo-stars.json';
const GIST_DESCRIPTION = 'LinuxDo Star Collector - Sync Data (do not delete)';

const SyncManager = {
  // ==================== Config ====================
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

  // ==================== Core Sync ====================
  /**
   * Full sync: pull remote → merge → push merged result
   * Returns { ok, message, merged? }
   */
  async sync() {
    const cfg = await this.getConfig();
    if (!cfg.token || !cfg.gistId) return { ok: false, message: '未配置同步' };

    try {
      await this.updateStatus('syncing');

      // 1. Read remote
      const remote = await this.readGist(cfg.token, cfg.gistId);

      // 2. Read local
      const local = await StarStorage.getAll();

      // 3. Merge
      const merged = this.merge(local, remote);

      // 4. Save merged locally
      await StarStorage.save(merged);

      // 5. Push merged to remote
      await this.writeGist(cfg.token, cfg.gistId, merged);

      // 6. Update config
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

  /**
   * Push only: local → remote (with merge to avoid overwriting)
   */
  async push() {
    return this.sync(); // Full sync is safer than blind push
  },

  /**
   * Pull only: remote → local (with merge)
   */
  async pull() {
    return this.sync(); // Same as sync
  },

  async updateStatus(status, error) {
    const cfg = await this.getConfig();
    cfg.status = status;
    if (error) cfg.lastError = error;
    else delete cfg.lastError;
    await this.saveConfig(cfg);
    // Notify popup/manage page
    try { chrome.runtime.sendMessage({ type: 'SYNC_STATUS', status, error }); } catch {}
  },

  // ==================== Gist API ====================
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

  /**
   * Find existing gist or create a new one
   */
  async findOrCreateGist(token) {
    // Search user's gists for our file
    const gists = await this.apiRequest(token, 'https://api.github.com/gists?per_page=100');
    for (const gist of gists) {
      if (gist.files[GIST_FILENAME]) {
        return gist.id;
      }
    }

    // Not found — create new private gist
    const newGist = await this.apiRequest(token, 'https://api.github.com/gists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: GIST_DESCRIPTION,
        public: false,
        files: {
          [GIST_FILENAME]: {
            content: JSON.stringify({ collections: {}, bookmarks: {} }, null, 2),
          },
        },
      }),
    });
    return newGist.id;
  },

  /**
   * Read data from gist
   */
  async readGist(token, gistId) {
    const gist = await this.apiRequest(token, `https://api.github.com/gists/${gistId}`);
    const file = gist.files[GIST_FILENAME];
    if (!file) throw new Error('Gist 中未找到数据文件');

    try {
      const data = JSON.parse(file.content);
      // Ensure structure
      if (!data.collections) data.collections = {};
      if (!data.bookmarks) data.bookmarks = {};
      return data;
    } catch {
      // Corrupted data, return empty
      return { collections: {}, bookmarks: {} };
    }
  },

  /**
   * Write data to gist
   */
  async writeGist(token, gistId, data) {
    await this.apiRequest(token, `https://api.github.com/gists/${gistId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: {
          [GIST_FILENAME]: {
            content: JSON.stringify(data, null, 2),
          },
        },
      }),
    });
  },

  /**
   * Validate token by getting user info
   */
  async validateToken(token) {
    try {
      const user = await this.apiRequest(token, 'https://api.github.com/user');
      return { ok: true, username: user.login, avatar: user.avatar_url };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  },

  /**
   * Connect: validate token → find/create gist → initial sync
   */
  async connect(token) {
    // 1. Validate token
    const validation = await this.validateToken(token);
    if (!validation.ok) return { ok: false, message: validation.message };

    // 2. Find or create gist
    const gistId = await this.findOrCreateGist(token);

    // 3. Save config
    const cfg = {
      token,
      gistId,
      lastSyncAt: '',
      autoSync: true,
      status: 'connected',
      username: validation.username,
    };
    await this.saveConfig(cfg);

    // 4. Initial sync
    const result = await this.sync();
    return { ok: true, message: `已连接为 @${validation.username}`, gistId, ...result };
  },

  /**
   * Disconnect: clear token (keep local data)
   */
  async disconnect() {
    await this.saveConfig({ token: '', gistId: '', lastSyncAt: '', autoSync: false, status: 'disconnected' });
    return { ok: true, message: '已断开同步' };
  },

  // ==================== Merge Algorithm ====================
  /**
   * Merge local and remote data
   * Strategy:
   *  - Union of all items
   *  - Per-item latest-wins by updatedAt/starredAt
   *  - Soft-deletes (_deleted + _deletedAt) propagate: if deleted side is newer, item stays deleted
   *  - Tombstones older than 7 days are purged after merge
   */
  merge(local, remote) {
    const result = { collections: {}, bookmarks: {} };

    // --- Merge collections ---
    const allColIds = new Set([
      ...Object.keys(local.collections || {}),
      ...Object.keys(remote.collections || {}),
    ]);
    for (const id of allColIds) {
      const l = local.collections?.[id];
      const r = remote.collections?.[id];
      if (!l) result.collections[id] = r;
      else if (!r) result.collections[id] = l;
      else result.collections[id] = this._newer(l, r);
    }
    if (!result.collections.default) {
      result.collections.default = {
        id: 'default', name: '默认收藏夹', icon: '⭐', color: '#eab308',
        createdAt: new Date().toISOString(), order: 0,
      };
    }

    // --- Merge bookmarks (with soft-delete support) ---
    const allTopicKeys = new Set([
      ...Object.keys(local.bookmarks || {}),
      ...Object.keys(remote.bookmarks || {}),
    ]);
    for (const key of allTopicKeys) {
      const l = local.bookmarks?.[key];
      const r = remote.bookmarks?.[key];

      // One side missing entirely — use the other
      if (!l && !r) continue;
      if (!l) { result.bookmarks[key] = r; continue; }
      if (!r) { result.bookmarks[key] = l; continue; }

      // Both exist — check soft-delete
      const lDel = l._deleted;
      const rDel = r._deleted;

      if (lDel && rDel) {
        // Both deleted — keep tombstone with latest time
        result.bookmarks[key] = this._newer(l, r);
        continue;
      }

      if (lDel && !rDel) {
        // Local deleted, remote alive — who's newer?
        const lTime = new Date(l._deletedAt || 0).getTime();
        const rTime = new Date(r.updatedAt || r.starredAt || 0).getTime();
        if (lTime >= rTime) {
          // Delete is newer — keep tombstone
          result.bookmarks[key] = l;
        } else {
          // Remote update is newer — resurrect
          result.bookmarks[key] = r;
        }
        continue;
      }

      if (!lDel && rDel) {
        // Remote deleted, local alive — who's newer?
        const rTime = new Date(r._deletedAt || 0).getTime();
        const lTime = new Date(l.updatedAt || l.starredAt || 0).getTime();
        if (rTime >= lTime) {
          result.bookmarks[key] = r;
        } else {
          result.bookmarks[key] = l;
        }
        continue;
      }

      // Both alive — merge normally
      const merged = { ...this._newer(l, r) };

      // Merge posts (with soft-delete)
      merged.posts = {};
      const allPostKeys = new Set([
        ...Object.keys(l.posts || {}),
        ...Object.keys(r.posts || {}),
      ]);
      for (const pk of allPostKeys) {
        const lp = l.posts?.[pk];
        const rp = r.posts?.[pk];

        if (!lp && !rp) continue;
        if (!lp) { merged.posts[pk] = rp; continue; }
        if (!rp) { merged.posts[pk] = lp; continue; }

        const lpDel = lp._deleted;
        const rpDel = rp._deleted;

        if (lpDel && rpDel) {
          merged.posts[pk] = this._newer(lp, rp);
        } else if (lpDel && !rpDel) {
          const lt = new Date(lp._deletedAt || 0).getTime();
          const rt = new Date(rp.updatedAt || rp.starredAt || 0).getTime();
          merged.posts[pk] = lt >= rt ? lp : rp;
        } else if (!lpDel && rpDel) {
          const rt = new Date(rp._deletedAt || 0).getTime();
          const lt = new Date(lp.updatedAt || lp.starredAt || 0).getTime();
          merged.posts[pk] = rt >= lt ? rp : lp;
        } else {
          merged.posts[pk] = this._newer(lp, rp);
        }
      }

      result.bookmarks[key] = merged;
    }

    // Purge old tombstones (> 7 days)
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const [key, bk] of Object.entries(result.bookmarks)) {
      if (bk._deleted && new Date(bk._deletedAt || 0).getTime() < cutoff) {
        delete result.bookmarks[key];
        continue;
      }
      if (bk.posts) {
        for (const [pk, p] of Object.entries(bk.posts)) {
          if (p._deleted && new Date(p._deletedAt || 0).getTime() < cutoff) {
            delete bk.posts[pk];
          }
        }
      }
    }

    return result;
  },

    return result;
  },

  /**
   * Return the newer of two objects based on updatedAt > starredAt > createdAt
   */
  _newer(a, b) {
    const ta = new Date(a.updatedAt || a.starredAt || a.createdAt || 0).getTime();
    const tb = new Date(b.updatedAt || b.starredAt || b.createdAt || 0).getTime();
    return ta >= tb ? { ...a } : { ...b };
  },
};
