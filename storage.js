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
    store.collections[id] = {
      id, name: name || '新收藏夹',
      icon: icon || '📁', color: color || '#71717a',
      createdAt: new Date().toISOString(), order,
    };
    await this.save(store);
    return id;
  },

  async updateCollection(id, updates) {
    const store = await this.getAll();
    if (store.collections[id]) {
      Object.assign(store.collections[id], updates);
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
    collectionId = collectionId || 'default';

    if (store.bookmarks[key]?.starred) {
      store.bookmarks[key].starred = false;
      if (!Object.keys(store.bookmarks[key].posts || {}).length) {
        delete store.bookmarks[key];
      }
      await this.save(store);
      return false;
    } else {
      if (!store.bookmarks[key]) {
        store.bookmarks[key] = {
          topicId, topicTitle: meta.title, topicUrl: meta.url,
          category: meta.category || '',
          starredAt: new Date().toISOString(), starred: true,
          collectionId, tags: [], note: '', posts: {},
        };
      } else {
        store.bookmarks[key].starred = true;
        store.bookmarks[key].starredAt = new Date().toISOString();
        store.bookmarks[key].topicTitle = meta.title || store.bookmarks[key].topicTitle;
        if (collectionId) store.bookmarks[key].collectionId = collectionId;
      }
      await this.save(store);
      return true;
    }
  },

  async togglePostStar(topicId, postNumber, topicMeta, postMeta, collectionId) {
    const store = await this.getAll();
    const topicKey = `topic_${topicId}`;
    const postKey = `post_${postNumber}`;
    collectionId = collectionId || 'default';

    if (!store.bookmarks[topicKey]) {
      store.bookmarks[topicKey] = {
        topicId, topicTitle: topicMeta.title, topicUrl: topicMeta.url,
        category: topicMeta.category || '',
        starredAt: new Date().toISOString(), starred: true,
        collectionId, tags: [], note: '', posts: {},
      };
    }

    if (store.bookmarks[topicKey].posts[postKey]) {
      delete store.bookmarks[topicKey].posts[postKey];
      if (!store.bookmarks[topicKey].starred && !Object.keys(store.bookmarks[topicKey].posts).length) {
        delete store.bookmarks[topicKey];
      }
      await this.save(store);
      return false;
    } else {
      store.bookmarks[topicKey].posts[postKey] = {
        postNumber, postUrl: postMeta.url,
        author: postMeta.author, excerpt: postMeta.excerpt,
        starredAt: new Date().toISOString(),
        collectionId, tags: [], note: '',
      };
      if (!store.bookmarks[topicKey].starred) store.bookmarks[topicKey].starred = true;
      await this.save(store);
      return true;
    }
  },

  async moveToCollection(topicKey, collectionId, postKey) {
    const store = await this.getAll();
    if (postKey) {
      if (store.bookmarks[topicKey]?.posts?.[postKey]) {
        store.bookmarks[topicKey].posts[postKey].collectionId = collectionId;
      }
    } else {
      if (store.bookmarks[topicKey]) {
        store.bookmarks[topicKey].collectionId = collectionId;
      }
    }
    await this.save(store);
  },
};
