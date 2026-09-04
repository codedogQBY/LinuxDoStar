/**
 * LinuxDo Star - Background Service Worker (ES Module)
 * Handles badge count + auto-sync scheduling
 */

import { StarStorage } from './storage-esm.js';
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
  if (message.type === 'FETCH_IMAGE_ASSET') {
    fetchImageAsset(message.url)
      .then(asset => sendResponse({ ok: true, asset }))
      .catch(error => sendResponse({ ok: false, message: error.message || '图片请求失败' }));
    return true;
  }
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

async function fetchImageAsset(url) {
  const imageUrl = validateImageUrl(url);
  const response = await fetch(imageUrl, { credentials: 'include' });
  if (!response.ok) throw new Error(`Image request failed: ${response.status}`);

  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const mimeType = blob.type || 'image/png';

  return {
    id: `asset_${hash}`,
    mimeType,
    dataUrl: `data:${mimeType};base64,${bytesToBase64(bytes)}`,
    originalUrl: imageUrl,
    originalUrls: [imageUrl],
  };
}

function validateImageUrl(url) {
  let imageUrl;
  try {
    imageUrl = new URL(String(url));
  } catch {
    throw new Error('图片地址无效');
  }
  if (!['http:', 'https:'].includes(imageUrl.protocol)) {
    throw new Error('不支持的图片地址');
  }
  return imageUrl.href;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

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
