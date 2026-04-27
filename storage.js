/**
 * LinuxDo Star - Storage Module
 *
 * 数据结构:
 * {
 *   collections: {
 *     "default":    { id, name, icon, color, createdAt, order },
 *     "col_abc123": { id, name, icon, color, createdAt, order }
 *   },
 *   bookmarks: {
 *     "topic_2066807": {
 *       topicId, topicTitle, topicUrl, category,
 *       starredAt, starred,
 *       collectionId: "default",   // 所属收藏夹
 *       tags: [], note: "",
 *       posts: {
 *         "post_12": { postNumber, postUrl, author, excerpt, starredAt, tags, note, collectionId }
 *       }
 *     }
 *   }
 * }
 */

const STORAGE_KEY = 'linuxdo_stars';

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
        if (!d.collections.default) d.collections.default = { ...DEFAULT_COLLECTION };
        r(d);
      });
    });
  },

  async save(store) {
    return new Promise(r => chrome.storage.local.set({ [STORAGE_KEY]: store }, r));
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
    return id;
  },

  async updateCollection(id, updates) {
    const store = await this.getAll();
    if (store.collections[id]) {
      Object.assign(store.collections[id], updates);
      store.collections[id].updatedAt = new Date().toISOString();
      await this.save(store);
    }
  },

  async deleteCollection(id) {
    if (id === 'default') return; // Cannot delete default
    const store = await this.getAll();
    delete store.collections[id];
    // Move bookmarks in this collection to default
    for (const bk of Object.values(store.bookmarks)) {
      if (bk.collectionId === id) bk.collectionId = 'default';
      for (const p of Object.values(bk.posts || {})) {
        if (p.collectionId === id) p.collectionId = 'default';
      }
    }
    await this.save(store);
  },

  // === Bookmarks ===
  async isTopicStarred(topicId) {
    const store = await this.getAll();
    return store.bookmarks[`topic_${topicId}`]?.starred || false;
  },

  async isPostStarred(topicId, postNumber) {
    const store = await this.getAll();
    return !!store.bookmarks[`topic_${topicId}`]?.posts?.[`post_${postNumber}`];
  },

  async toggleTopicStar(topicId, meta, collectionId) {
    const store = await this.getAll();
    const key = `topic_${topicId}`;
    const now = new Date().toISOString();
    collectionId = collectionId || 'default';

    if (store.bookmarks[key]?.starred) {
      store.bookmarks[key].starred = false;
      store.bookmarks[key].updatedAt = now;
      if (!Object.keys(store.bookmarks[key].posts || {}).length) {
        delete store.bookmarks[key];
      }
      await this.save(store);
      this._notifyChange();
      return false;
    } else {
      if (!store.bookmarks[key]) {
        store.bookmarks[key] = {
          topicId, topicTitle: meta.title, topicUrl: meta.url,
          category: meta.category || '',
          starredAt: now, updatedAt: now, starred: true,
          collectionId, tags: meta.tags || [], note: '', posts: {},
        };
      } else {
        store.bookmarks[key].starred = true;
        store.bookmarks[key].starredAt = now;
        store.bookmarks[key].updatedAt = now;
        store.bookmarks[key].topicTitle = meta.title || store.bookmarks[key].topicTitle;
        if (collectionId) store.bookmarks[key].collectionId = collectionId;
      }
      await this.save(store);
      this._notifyChange();
      return true;
    }
  },

  async togglePostStar(topicId, postNumber, topicMeta, postMeta, collectionId) {
    const store = await this.getAll();
    const topicKey = `topic_${topicId}`;
    const postKey = `post_${postNumber}`;
    const now = new Date().toISOString();
    collectionId = collectionId || 'default';

    if (!store.bookmarks[topicKey]) {
      store.bookmarks[topicKey] = {
        topicId, topicTitle: topicMeta.title, topicUrl: topicMeta.url,
        category: topicMeta.category || '',
        starredAt: now, updatedAt: now, starred: true,
        collectionId, tags: topicMeta.tags || [], note: '', posts: {},
      };
    }

    if (store.bookmarks[topicKey].posts[postKey]) {
      delete store.bookmarks[topicKey].posts[postKey];
      store.bookmarks[topicKey].updatedAt = now;
      if (!store.bookmarks[topicKey].starred && !Object.keys(store.bookmarks[topicKey].posts).length) {
        delete store.bookmarks[topicKey];
      }
      await this.save(store);
      this._notifyChange();
      return false;
    } else {
      store.bookmarks[topicKey].posts[postKey] = {
        postNumber, postUrl: postMeta.url,
        author: postMeta.author, excerpt: postMeta.excerpt,
        starredAt: now, updatedAt: now,
        collectionId, tags: [], note: '',
      };
      store.bookmarks[topicKey].updatedAt = now;
      if (!store.bookmarks[topicKey].starred) store.bookmarks[topicKey].starred = true;
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

  /**
   * Soft-delete a bookmark (mark as deleted instead of removing)
   * This allows sync to propagate deletions across devices
   */
  async softDeleteTopic(topicKey) {
    const store = await this.getAll();
    if (store.bookmarks[topicKey]) {
      store.bookmarks[topicKey] = {
        _deleted: true,
        _deletedAt: new Date().toISOString(),
        topicId: store.bookmarks[topicKey].topicId,
      };
    }
    await this.save(store);
    this._notifyChange();
  },

  async softDeletePost(topicKey, postKey) {
    const store = await this.getAll();
    if (store.bookmarks[topicKey]?.posts?.[postKey]) {
      store.bookmarks[topicKey].posts[postKey] = {
        _deleted: true,
        _deletedAt: new Date().toISOString(),
      };
      store.bookmarks[topicKey].updatedAt = new Date().toISOString();
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
};
