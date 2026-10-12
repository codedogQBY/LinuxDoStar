/**
 * Shared page-side helpers for external save targets.
 */
(function (root) {
  'use strict';

  const LABELS = { obsidian: 'Obsidian', notion: 'Notion', feishu: '飞书' };

  async function save(data, targets) {
    const settings = await StarStorage.getSettings();
    const selected = [...new Set((targets || []).filter(target => LABELS[target]))];
    if (!selected.length) return { results: [] };
    const results = [];
    const remoteTargets = selected.filter(target => target !== 'obsidian');
    if (remoteTargets.length) {
      const externalData = {
        ...data,
        markdown: LinuxDoMarkdown.restoreAssetReferences(data.markdown, data.assets || {}),
      };
      delete externalData.assets;
      const response = await chrome.runtime.sendMessage({ type: 'SAVE_EXTERNAL', data: externalData, targets: remoteTargets });
      if (!response?.ok) throw new Error(response?.message || '外部保存失败');
      results.push(...(response.results || []));
    }
    if (selected.includes('obsidian')) {
      try {
        results.push(await saveToObsidian(data, settings));
      } catch (error) {
        results.push({ target: 'obsidian', ok: false, error: error.message || '保存失败' });
      }
    }
    return { results };
  }

  async function saveToObsidian(data, settings) {
    let markdown = data.markdown || '';
    let mediaResult = { paths: {}, failed: 0 };
    if (settings.obsidianDownloadImages && settings.obsidianRestApiKey && Object.keys(data.assets || {}).length) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'SAVE_OBSIDIAN_MEDIA',
          assets: Object.values(data.assets || {}),
          folder: settings.obsidianFolder || 'LinuxDo',
          apiKey: settings.obsidianRestApiKey,
          port: Number(settings.obsidianRestApiPort) || 27123,
        });
        if (response?.ok) mediaResult = response;
      } catch (error) {
        console.warn('[LinuxDo Star] Obsidian 图片保存失败，将保留原链接', error);
      }
    }
    markdown = replaceObsidianAssetReferences(markdown, data.assets || {}, mediaResult.paths);
    let clipboardReady = false;
    try {
      await writeClipboard(markdown);
      clipboardReady = true;
    } catch (error) {
      if (markdown.length > 60000) throw new Error(`无法写入剪贴板，内容过大无法通过 Obsidian URI 传递：${error.message}`);
    }
    const filePath = buildObsidianPath(settings, data.title);
    const uri = buildObsidianUri(settings, filePath, markdown, clipboardReady);
    openExternalUrl(uri);
    return {
      target: 'obsidian',
      ok: true,
      mediaFailed: mediaResult.failed || 0,
    };
  }

  function replaceObsidianAssetReferences(markdown, assets, paths) {
    const withLocalPaths = (markdown || '').replace(/!\[([^\]]*)\]\(asset:\/\/([A-Za-z0-9_-]+)\)/g, (full, alt, id) => {
      const path = paths[id];
      return path ? `![${alt}](${path})` : full;
    });
    return LinuxDoMarkdown.restoreAssetReferences(withLocalPaths, assets);
  }

  function buildObsidianPath(settings, title) {
    const safeTitle = String(title || 'linuxdo-post')
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'linuxdo-post';
    const folder = String(settings.obsidianFolder || 'LinuxDo').replace(/^\/+|\/+$/g, '');
    return folder ? `${folder}/${safeTitle}.md` : `${safeTitle}.md`;
  }

  function buildObsidianUri(settings, filePath, markdown, clipboardReady) {
    const params = new URLSearchParams();
    if (settings.obsidianVault) params.set('vault', settings.obsidianVault);
    params.set('filepath', filePath);
    if (clipboardReady) {
      params.set('clipboard', 'true');
      params.set('mode', 'overwrite');
      return `obsidian://advanced-uri?${params.toString()}`;
    }
    if (markdown.length > 60000) throw new Error('浏览器无法使用剪贴板，内容过大无法通过 URI 传递');
    params.delete('filepath');
    params.set('file', filePath);
    params.set('overwrite', 'true');
    params.set('content', markdown);
    return `obsidian://new?${params.toString()}`;
  }

  async function writeClipboard(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('无法写入剪贴板');
  }

  function openExternalUrl(url) {
    if (location.protocol === 'chrome-extension:' && chrome.tabs?.create) {
      chrome.tabs.create({ url });
    } else {
      window.location.href = url;
    }
  }

  async function showTargetMenu(anchor) {
    const settings = await StarStorage.getSettings();
    const configured = getConfiguredTargets(settings);
    if (!configured.length) {
      alert('请先在收藏管理 → 收藏设置中配置 Notion、飞书或 Obsidian');
      return [];
    }
    document.querySelector('.ld-external-target-menu')?.remove();
    return new Promise(resolve => {
      const menu = document.createElement('div');
      menu.className = 'ld-external-target-menu';
      menu.style.cssText = 'position:fixed;z-index:100000;min-width:170px;padding:5px;background:#fff;border:1px solid #e4e4e7;border-radius:7px;box-shadow:0 8px 24px rgba(0,0,0,.14);font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
      const rect = anchor.getBoundingClientRect();
      menu.style.top = `${Math.min(window.innerHeight - 12, rect.bottom + 6)}px`;
      menu.style.left = `${Math.max(8, Math.min(window.innerWidth - 185, rect.left))}px`;
      const all = document.createElement('button');
      all.textContent = '保存到全部已配置';
      styleMenuButton(all, true);
      menu.appendChild(all);
      for (const target of configured) {
        const button = document.createElement('button');
        button.textContent = LABELS[target];
        styleMenuButton(button, false);
        button.addEventListener('click', () => finish([target]));
        menu.appendChild(button);
      }
      all.addEventListener('click', () => finish(configured));
      document.body.appendChild(menu);
      const outside = event => {
        if (!menu.contains(event.target) && event.target !== anchor) finish([]);
      };
      document.addEventListener('click', outside, true);
      function finish(targets) {
        document.removeEventListener('click', outside, true);
        menu.remove();
        resolve(targets);
      }
    });
  }

  function styleMenuButton(button, primary) {
    button.type = 'button';
    button.style.cssText = `display:block;width:100%;padding:7px 9px;border:0;border-radius:5px;text-align:left;cursor:pointer;background:${primary ? '#f4f4f5' : '#fff'};color:#18181b;font:inherit;`;
    button.addEventListener('mouseenter', () => { button.style.background = '#f4f4f5'; });
    button.addEventListener('mouseleave', () => { button.style.background = primary ? '#f4f4f5' : '#fff'; });
  }

  function getConfiguredTargets(settings) {
    const targets = [];
    if (settings.notionToken && settings.notionDatabaseId) targets.push('notion');
    if (settings.feishuAppId && settings.feishuAppSecret && settings.feishuAppToken && settings.feishuTableId) targets.push('feishu');
    if (settings.obsidianFolder || settings.obsidianVault) targets.push('obsidian');
    return targets;
  }

  function labels() { return { ...LABELS }; }

  root.LinuxDoIntegrations = { save, showTargetMenu, getConfiguredTargets, labels };
})(globalThis);
