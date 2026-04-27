/**
 * LinuxDo Star - Background Service Worker (ES Module)
 * Handles badge count + auto-sync scheduling
 */

import { STORAGE_KEY, DEFAULT_COLLECTION, StarStorage } from './storage-esm.js';
import { SyncManager } from './sync-esm.js';

const SYNC_ALARM = 'linuxdo-star-sync';
const SYNC_DEBOUNCE_ALARM = 'linuxdo-star-sync-debounce';

// ==================== Install ====================
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 30 });
});

// ==================== Alarm Handler ====================
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SYNC_ALARM || alarm.name === SYNC_DEBOUNCE_ALARM) {
    const cfg = await SyncManager.getConfig();
    if (cfg.token && cfg.gistId && cfg.autoSync) {
      console.log(`[LinuxDo Star] Sync triggered by ${alarm.name}`);
      await SyncManager.sync();
    }
  }
});

// ==================== Message Handler ====================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_BADGE_COUNT') {
    updateBadge();
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === 'DATA_CHANGED') {
    chrome.alarms.create(SYNC_DEBOUNCE_ALARM, { delayInMinutes: 0.5 });
    updateBadge();
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === 'SYNC_NOW') {
    SyncManager.sync().then(r => sendResponse(r));
    return true;
  }
  if (message.type === 'SYNC_CONNECT') {
    SyncManager.connect(message.token).then(r => sendResponse(r));
    return true;
  }
  if (message.type === 'SYNC_DISCONNECT') {
    SyncManager.disconnect().then(r => sendResponse(r));
    return true;
  }
  if (message.type === 'SYNC_GET_CONFIG') {
    SyncManager.getConfig().then(cfg => sendResponse(cfg));
    return true;
  }
  if (message.type === 'SYNC_SET_AUTO') {
    SyncManager.getConfig().then(async cfg => {
      cfg.autoSync = message.enabled;
      await SyncManager.saveConfig(cfg);
      sendResponse({ ok: true });
    });
    return true;
  }
});

// ==================== Badge ====================
async function updateBadge() {
  try {
    const store = await StarStorage.getAll();
    const count = Object.values(store.bookmarks || {}).filter(b => !b._deleted).length;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#18181b' });
  } catch {}
}

updateBadge();
