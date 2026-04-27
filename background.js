/**
 * LinuxDo Star - Background Service Worker
 * Handles badge count + auto-sync scheduling
 */

importScripts('storage.js', 'sync.js');

const SYNC_ALARM = 'linuxdo-star-sync';
const SYNC_DEBOUNCE_ALARM = 'linuxdo-star-sync-debounce';

// ==================== Install ====================
chrome.runtime.onInstalled.addListener(() => {
  // Set up periodic sync alarm (every 30 minutes)
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 30 });
});

// ==================== Alarm Handler ====================
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SYNC_ALARM) {
    // Periodic sync
    const cfg = await SyncManager.getConfig();
    if (cfg.token && cfg.gistId && cfg.autoSync) {
      console.log('[LinuxDo Star] Periodic sync triggered');
      await SyncManager.sync();
    }
  }

  if (alarm.name === SYNC_DEBOUNCE_ALARM) {
    // Debounced sync after data change
    const cfg = await SyncManager.getConfig();
    if (cfg.token && cfg.gistId && cfg.autoSync) {
      console.log('[LinuxDo Star] Auto-sync after data change');
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
    // Debounce: sync 30s after last change
    chrome.alarms.create(SYNC_DEBOUNCE_ALARM, { delayInMinutes: 0.5 });
    updateBadge();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'SYNC_NOW') {
    SyncManager.sync().then(result => sendResponse(result));
    return true; // async
  }

  if (message.type === 'SYNC_CONNECT') {
    SyncManager.connect(message.token).then(result => sendResponse(result));
    return true;
  }

  if (message.type === 'SYNC_DISCONNECT') {
    SyncManager.disconnect().then(result => sendResponse(result));
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
    const count = Object.keys(store.bookmarks || {}).length;
    if (count > 0) {
      chrome.action.setBadgeText({ text: String(count) });
      chrome.action.setBadgeBackgroundColor({ color: '#18181b' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch {}
}

// Initial badge update
updateBadge();
