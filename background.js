/**
 * LinuxDo Star - Background Service Worker
 * 处理扩展的后台逻辑
 */

// 监听安装事件
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('LinuxDo Star 已安装');
  }
});

// 处理来自 content script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_BADGE_COUNT') {
    chrome.storage.local.get(['linuxdo_stars'], (result) => {
      const bookmarks = result.linuxdo_stars || {};
      const count = Object.keys(bookmarks).length;
      // 更新 badge
      if (count > 0) {
        chrome.action.setBadgeText({ text: String(count) });
        chrome.action.setBadgeBackgroundColor({ color: '#667eea' });
      } else {
        chrome.action.setBadgeText({ text: '' });
      }
      sendResponse({ count });
    });
    return true; // 异步响应
  }
});
