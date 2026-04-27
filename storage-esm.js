/**
 * ESM wrapper for storage.js (used by background service worker)
 * Re-declares the same code with export statements.
 */

export const STORAGE_KEY = 'linuxdo_stars';

export const DEFAULT_COLLECTION = {
  id: 'default',
  name: '默认收藏夹',
  icon: '⭐',
  color: '#eab308',
  createdAt: new Date().toISOString(),
  order: 0,
};

export const StarStorage = {
  async getAll() {
    return new Promise(r => {
      chrome.storage.local.get([STORAGE_KEY], res => {
        let d = res[STORAGE_KEY] || {};
        if (!d.collections && !d.bookmarks) {
          const oldKeys = Object.keys(d).filter(k => k.startsWith('topic_'));
          if (oldKeys.length > 0) {
            const migrated = { collections: { default: { ...DEFAULT_COLLECTION } }, bookmarks: {} };
            for (const k of oldKeys) {
              migrated.bookmarks[k] = d[k];
              if (!migrated.bookmarks[k].collectionId) migrated.bookmarks[k].collectionId = 'default';
            }
            d = migrated;
            chrome.storage.local.set({ [STORAGE_KEY]: d });
          }
        }
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
};
