/**
 * LinuxDo Star - Storage Module
 *
 * 数据结构:
 * {
 *   collections: {
 *     "default":    { id, name, icon, color, createdAt, order },
 *     "col_abc123": { id, name, icon, color, createdAt, order }
 *   },
 *   assets: {
 *     "asset_<sha256>": { id, mimeType, dataUrl, originalUrl, originalUrls }
 *   },
 *   bookmarks: {
 *     "topic_2066807": {
 *       topicId, topicTitle, topicUrl, category,
 *       starredAt, starred,
 *       contentMarkdown: "帖子正文 Markdown",
 *       contentCapturedAt: "2026-06-10T...",
 *       collectionId: "default",   // 所属收藏夹
 *       tags: [], note: "",
 *       posts: {
 *         "post_12": { postNumber, postUrl, author, excerpt, contentMarkdown, contentCapturedAt, starredAt, tags, note, collectionId }
 *       }
 *     }
 *   }
 * }
 */

const STORAGE_KEY = 'linuxdo_stars';
const SETTINGS_KEY = 'linuxdo_settings';
const DEFAULT_SETTINGS = {
  autoArchiveMarkdown: true,
  obsidianVault: '',
  obsidianFolder: '',
  obsidianDownloadImages: false,
  obsidianRestApiKey: '',
  obsidianRestApiPort: 27123,
  notionToken: '',
  notionDatabaseId: '',
  notionTitleProperty: '标题',
  notionUrlProperty: '链接',
  notionAuthorProperty: '作者',
  notionCategoryProperty: '分类',
  notionTagsProperty: '标签',
  notionDateProperty: '保存日期',
  notionCommentCountProperty: '评论数',
  feishuApiDomain: 'feishu',
  feishuAppId: '',
  feishuAppSecret: '',
  feishuAppToken: '',
  feishuTableId: '',
  feishuUploadContent: true,
  feishuUploadMarkdown: false,
};

const DEFAULT_COLLECTION = {
  id: 'default',
  name: '默认收藏夹',
  icon: '⭐',
  color: '#eab308',
  createdAt: new Date().toISOString(),
  order: 0,
};

const StarStorage = {
  async getAll() {
    return new Promise(r => {
      chrome.storage.local.get([STORAGE_KEY], res => {
        let d = res[STORAGE_KEY] || {};

        // Migration: old flat format -> new nested format
        if (!d.collections && !d.bookmarks) {
          // Check if d itself contains topic_ keys (old format)
          const oldKeys = Object.keys(d).filter(k => k.startsWith('topic_'));
          if (oldKeys.length > 0) {
            const migrated = {
              collections: { default: { ...DEFAULT_COLLECTION } },
              bookmarks: {},
            };
            for (const k of oldKeys) {
              migrated.bookmarks[k] = d[k];
              if (!migrated.bookmarks[k].collectionId) {
                migrated.bookmarks[k].collectionId = 'default';
              }
            }
            d = migrated;
            // Save migrated data
            chrome.storage.local.set({ [STORAGE_KEY]: d });
          }
        }

        // Ensure structure
        if (!d.collections) d.collections = { default: { ...DEFAULT_COLLECTION } };
        if (!d.bookmarks) d.bookmarks = {};
        if (!d.assets) d.assets = {};
        if (!d.collections.default) d.collections.default = { ...DEFAULT_COLLECTION };
        r(d);
      });
    });
  },

  async save(store) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [STORAGE_KEY]: store }, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    });
  },

  async saveAndNotify(store) {
    await this.save(store);
    this._notifyChange();
  },

  async getSettings() {
    return new Promise(resolve => {
      chrome.storage.local.get([SETTINGS_KEY], result => {
        const saved = result[SETTINGS_KEY] || {};
        resolve({
          ...DEFAULT_SETTINGS,
          ...saved,
        });
      });
    });
  },

  async saveSettings(updates) {
    const settings = { ...(await this.getSettings()), ...updates };
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [SETTINGS_KEY]: settings }, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(settings);
      });
    });
  },

  // === Collections ===
  async getCollections() {
    const store = await this.getAll();
    return store.collections;
  },

  async createCollection(name, icon, color) {
    const store = await this.getAll();
    const id = 'col_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const order = Object.keys(store.collections).length;
    const now = new Date().toISOString();
    store.collections[id] = {
      id, name: name || '新收藏夹',
      icon: icon || '📁', color: color || '#71717a',
      createdAt: now, updatedAt: now, order,
    };
    await this.save(store);
    this._notifyChange();
    return id;
  },

  async updateCollection(id, updates) {
    const store = await this.getAll();
    if (store.collections[id]) {
      Object.assign(store.collections[id], updates);
      store.collections[id].updatedAt = new Date().toISOString();
      await this.save(store);
      this._notifyChange();
    }
  },

  async deleteCollection(id) {
    if (id === 'default') return; // Cannot delete default
    const store = await this.getAll();
    const now = new Date().toISOString();
    delete store.collections[id];
    // Move bookmarks in this collection to default
    for (const bk of Object.values(store.bookmarks)) {
      if (bk.collectionId === id) {
        bk.collectionId = 'default';
        bk.updatedAt = now;
      }
      for (const p of Object.values(bk.posts || {})) {
        if (p.collectionId === id) {
          p.collectionId = 'default';
          p.updatedAt = now;
        }
      }
    }
    await this.save(store);
    this._notifyChange();
  },

  // === Bookmarks ===
  async isTopicStarred(topicId) {
    const store = await this.getAll();
    const bk = store.bookmarks[`topic_${topicId}`];
    return !!bk && !bk._deleted && bk.starred === true;
  },

  async isPostStarred(topicId, postNumber) {
    const store = await this.getAll();
    const bk = store.bookmarks[`topic_${topicId}`];
    const post = bk?.posts?.[`post_${postNumber}`];
    return !!bk && !bk._deleted && !!post && !post._deleted;
  },

  async toggleTopicStar(topicId, meta, collectionId) {
    const store = await this.getAll();
    const settings = await this.getSettings();
    const shouldArchive = settings.autoArchiveMarkdown !== false;
    const key = `topic_${topicId}`;
    const now = new Date().toISOString();
    collectionId = collectionId || 'default';

    const existing = store.bookmarks[key];

    if (existing?.starred && !existing._deleted) {
      existing.starred = false;
      existing.updatedAt = now;
      if (!this._hasActivePosts(existing.posts)) {
        store.bookmarks[key] = this._topicTombstone(existing, now, topicId);
      }
      await this.save(store);
      this._notifyChange();
      return false;
    } else {
      if (shouldArchive) this._mergeAssets(store, meta?.assets);
      if (!existing || existing._deleted) {
        store.bookmarks[key] = {
          topicId, topicTitle: meta.title, topicUrl: meta.url,
          category: meta.category || '',
          ...(shouldArchive ? {
            contentMarkdown: meta.contentMarkdown || '',
            contentCapturedAt: meta.contentCapturedAt || '',
          } : {}),
          starredAt: now, updatedAt: now, starred: true,
          collectionId, tags: meta.tags || [], note: '', posts: {},
        };
      } else {
        existing.starred = true;
        existing.starredAt = now;
        existing.updatedAt = now;
        existing.topicTitle = meta.title || existing.topicTitle;
        if (shouldArchive && meta.contentMarkdown) {
          existing.contentMarkdown = meta.contentMarkdown;
          existing.contentCapturedAt = meta.contentCapturedAt || now;
        }
        if (collectionId) existing.collectionId = collectionId;
      }
      await this.save(store);
      this._notifyChange();
      return true;
    }
  },

  async togglePostStar(topicId, postNumber, topicMeta, postMeta, collectionId) {
    const store = await this.getAll();
    const settings = await this.getSettings();
    const shouldArchive = settings.autoArchiveMarkdown !== false;
    const topicKey = `topic_${topicId}`;
    const postKey = `post_${postNumber}`;
    const now = new Date().toISOString();
    collectionId = collectionId || 'default';

    let topic = store.bookmarks[topicKey];
    if (!topic || topic._deleted) {
      topic = {
        topicId, topicTitle: topicMeta.title, topicUrl: topicMeta.url,
        category: topicMeta.category || '',
        ...(shouldArchive ? {
          contentMarkdown: topicMeta.contentMarkdown || '',
          contentCapturedAt: topicMeta.contentCapturedAt || '',
        } : {}),
        starredAt: now, updatedAt: now, starred: true,
        collectionId, tags: topicMeta.tags || [], note: '', posts: {},
      };
      store.bookmarks[topicKey] = topic;
    }
    if (!topic.posts) topic.posts = {};
    if (shouldArchive && topicMeta.contentMarkdown) {
      topic.contentMarkdown = topicMeta.contentMarkdown;
      topic.contentCapturedAt = topicMeta.contentCapturedAt || now;
    }

    if (topic.posts[postKey] && !topic.posts[postKey]._deleted) {
      topic.posts[postKey] = this._postTombstone(now);
      topic.updatedAt = now;
      if (!topic.starred && !this._hasActivePosts(topic.posts)) {
        store.bookmarks[topicKey] = this._topicTombstone(topic, now, topicId);
      }
      await this.save(store);
      this._notifyChange();
      return false;
    } else {
      if (shouldArchive) {
        this._mergeAssets(store, topicMeta?.assets);
        this._mergeAssets(store, postMeta?.assets);
      }
      topic.posts[postKey] = {
        postNumber, postUrl: postMeta.url,
        author: postMeta.author, excerpt: postMeta.excerpt,
        ...(shouldArchive ? {
          contentMarkdown: postMeta.contentMarkdown || '',
          contentCapturedAt: postMeta.contentCapturedAt || '',
        } : {}),
        starredAt: now, updatedAt: now,
        collectionId, tags: [], note: '',
      };
      topic.updatedAt = now;
      if (!topic.starred) topic.starred = true;
      await this.save(store);
      this._notifyChange();
      return true;
    }
  },

  async moveToCollection(topicKey, collectionId, postKey) {
    const store = await this.getAll();
    const now = new Date().toISOString();
    if (postKey) {
      if (store.bookmarks[topicKey]?.posts?.[postKey]) {
        store.bookmarks[topicKey].posts[postKey].collectionId = collectionId;
        store.bookmarks[topicKey].posts[postKey].updatedAt = now;
      }
    } else {
      if (store.bookmarks[topicKey]) {
        store.bookmarks[topicKey].collectionId = collectionId;
        store.bookmarks[topicKey].updatedAt = now;
      }
    }
    await this.save(store);
    this._notifyChange();
  },

  // Notify background to trigger auto-sync
  _notifyChange() {
    try { chrome.runtime.sendMessage({ type: 'DATA_CHANGED' }); } catch {}
  },

  _mergeAssets(store, assets = {}) {
    if (!assets || !Object.keys(assets).length) return;
    if (!store.assets) store.assets = {};
    for (const [id, asset] of Object.entries(assets)) {
      if (!asset) continue;
      const existing = store.assets[id];
      if (!existing) {
        store.assets[id] = {
          ...asset,
          originalUrls: [...new Set(asset.originalUrls || (asset.originalUrl ? [asset.originalUrl] : []))],
        };
        continue;
      }
      existing.originalUrls = [...new Set([
        ...(existing.originalUrls || (existing.originalUrl ? [existing.originalUrl] : [])),
        ...(asset.originalUrls || (asset.originalUrl ? [asset.originalUrl] : [])),
      ])];
      if (!existing.originalUrl && existing.originalUrls[0]) existing.originalUrl = existing.originalUrls[0];
    }
  },

  /**
   * Soft-delete a bookmark (mark as deleted instead of removing)
   * This allows sync to propagate deletions across devices
   */
  async softDeleteTopic(topicKey) {
    const store = await this.getAll();
    if (store.bookmarks[topicKey]) {
      store.bookmarks[topicKey] = this._topicTombstone(store.bookmarks[topicKey]);
    }
    await this.save(store);
    this._notifyChange();
  },

  async softDeletePost(topicKey, postKey) {
    const store = await this.getAll();
    if (store.bookmarks[topicKey]?.posts?.[postKey]) {
      const now = new Date().toISOString();
      store.bookmarks[topicKey].posts[postKey] = this._postTombstone(now);
      store.bookmarks[topicKey].updatedAt = now;
      if (!store.bookmarks[topicKey].starred && !this._hasActivePosts(store.bookmarks[topicKey].posts)) {
        store.bookmarks[topicKey] = this._topicTombstone(store.bookmarks[topicKey], now);
      }
    }
    await this.save(store);
    this._notifyChange();
  },

  async softDeleteAll() {
    const store = await this.getAll();
    const now = new Date().toISOString();
    for (const [key, bk] of Object.entries(store.bookmarks || {})) {
      if (!bk._deleted) store.bookmarks[key] = this._topicTombstone(bk, now);
    }
    await this.save(store);
    this._notifyChange();
  },

  /**
   * Purge all soft-deleted items older than 7 days
   * Called after sync to clean up tombstones
   */
  async purgeDeleted(store) {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const [key, bk] of Object.entries(store.bookmarks || {})) {
      if (bk._deleted && new Date(bk._deletedAt || 0).getTime() < cutoff) {
        delete store.bookmarks[key];
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
  },

  _hasActivePosts(posts = {}) {
    return Object.values(posts).some(p => !p._deleted);
  },

  _topicTombstone(bookmark = {}, deletedAt = new Date().toISOString(), fallbackTopicId = null) {
    return {
      _deleted: true,
      _deletedAt: deletedAt,
      updatedAt: deletedAt,
      topicId: bookmark.topicId ?? fallbackTopicId,
    };
  },

  _postTombstone(deletedAt = new Date().toISOString()) {
    return {
      _deleted: true,
      _deletedAt: deletedAt,
      updatedAt: deletedAt,
    };
  },
};
