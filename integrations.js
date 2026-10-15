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
    const externalData = {
      ...data,
      markdown: LinuxDoMarkdown.removeDuplicateLeadingTitle(data.markdown, data.title),
    };
    const results = [];
    const remoteTargets = selected.filter(target => target !== 'obsidian');
    if (remoteTargets.length) {
      const remoteData = {
        ...externalData,
        markdown: LinuxDoMarkdown.restoreAssetReferences(externalData.markdown, externalData.assets || {}),
      };
      delete remoteData.assets;
      const response = await chrome.runtime.sendMessage({ type: 'SAVE_EXTERNAL', data: remoteData, targets: remoteTargets });
      if (!response?.ok) throw new Error(response?.message || '外部保存失败');
      results.push(...(response.results || []));
    }
    if (selected.includes('obsidian')) {
      try {
        results.push(await saveToObsidian(externalData, settings));
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
    const filePath = buildObsidianPath(settings, data.title);
    if (settings.obsidianRestApiKey) {
      const response = await chrome.runtime.sendMessage({
        type: 'SAVE_OBSIDIAN_NOTE',
        filePath,
        markdown,
        apiKey: settings.obsidianRestApiKey,
        port: Number(settings.obsidianRestApiPort) || 27123,
      });
      if (!response?.ok) throw new Error(response?.message || 'Obsidian Markdown 保存失败');
      return {
        target: 'obsidian',
        ok: true,
        mediaFailed: mediaResult.failed || 0,
      };
    }

    let clipboardReady = false;
    try {
      await writeClipboard(markdown);
      clipboardReady = true;
    } catch (error) {
      if (markdown.length > 60000) throw new Error(`无法写入剪贴板，内容过大无法通过 Obsidian URI 传递：${error.message}`);
    }
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
      alert('请先在收藏管理 → 收藏设置中配置飞书或 Obsidian');
      return [];
    }
    return showMenu(anchor, [
      { label: '保存到全部已配置', value: configured, primary: true },
      ...configured.map(target => ({ label: LABELS[target], value: [target] })),
    ]);
  }

  async function showTopicSaveMenu(anchor) {
    const settings = await StarStorage.getSettings();
    const configured = getConfiguredTargets(settings);
    const entries = [
      { label: settings.includeCommentsInDownloads === true ? '导出 ZIP（含评论）' : '导出 ZIP（仅主贴）', value: { type: 'zip' } },
      { divider: true },
    ];
    if (configured.length) {
      entries.push(
        { label: '保存到全部已配置', value: { type: 'external', targets: configured }, primary: true },
        ...configured.map(target => ({ label: `保存到 ${LABELS[target]}`, value: { type: 'external', targets: [target] } })),
      );
    } else {
      entries.push({ label: '未配置外部保存目标', disabled: true });
    }
    return showMenu(anchor, entries);
  }

  function showMenu(anchor, entries) {
    document.querySelector('.ld-external-target-menu')?.remove();
    return new Promise(resolve => {
      const menu = document.createElement('div');
      menu.className = 'ld-external-target-menu';
      menu.style.cssText = 'position:fixed;z-index:100000;min-width:170px;padding:5px;background:#fff;border:1px solid #e4e4e7;border-radius:7px;box-shadow:0 8px 24px rgba(0,0,0,.14);font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
      const rect = anchor?.getBoundingClientRect?.() || document.body.getBoundingClientRect();
      menu.style.top = `${Math.min(window.innerHeight - 12, rect.bottom + 6)}px`;
      menu.style.left = `${Math.max(8, Math.min(window.innerWidth - 185, rect.left))}px`;
      for (const entry of entries) {
        if (entry.divider) {
          const divider = document.createElement('div');
          divider.style.cssText = 'height:1px;margin:5px 4px;background:#e4e4e7;';
          menu.appendChild(divider);
          continue;
        }
        const button = document.createElement('button');
        button.textContent = entry.label;
        button.disabled = Boolean(entry.disabled);
        styleMenuButton(button, Boolean(entry.primary), Boolean(entry.disabled));
        if (!entry.disabled) button.addEventListener('click', () => finish(entry.value));
        menu.appendChild(button);
      }
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

  function styleMenuButton(button, primary, disabled = false) {
    button.type = 'button';
    button.style.cssText = `display:block;width:100%;padding:7px 9px;border:0;border-radius:5px;text-align:left;cursor:${disabled ? 'default' : 'pointer'};background:${primary ? '#f4f4f5' : '#fff'};color:${disabled ? '#a1a1aa' : '#18181b'};font:inherit;`;
    if (!disabled) {
      button.addEventListener('mouseenter', () => { button.style.background = '#f4f4f5'; });
      button.addEventListener('mouseleave', () => { button.style.background = primary ? '#f4f4f5' : '#fff'; });
    }
  }

  function getConfiguredTargets(settings) {
    const targets = [];
    // Notion saving remains implemented, but is temporarily hidden from UI menus.
    if (settings.feishuAppId && settings.feishuAppSecret && settings.feishuAppToken && settings.feishuTableId) targets.push('feishu');
    if (settings.obsidianFolder || settings.obsidianVault) targets.push('obsidian');
    return targets;
  }

  function labels() { return { ...LABELS }; }

  root.LinuxDoIntegrations = { save, showTargetMenu, showTopicSaveMenu, getConfiguredTargets, labels };
})(globalThis);
