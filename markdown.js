/**
 * Shared HTML to Markdown converter for content and management pages.
 */

(function (root) {
  'use strict';

  function htmlToMarkdown(container, baseUrl = '') {
    if (!container) return '';
    return normalizeMarkdown(
      Array.from(container.childNodes)
        .map(node => nodeToMarkdown(node, { baseUrl }))
        .join('')
    );
  }

  function nodeToMarkdown(node, ctx = {}) {
    if (node.nodeType === 3) {
      return node.nodeValue.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
    }
    if (node.nodeType !== 1) return '';

    const tag = node.tagName.toLowerCase();
    const children = () => Array.from(node.childNodes).map(child => nodeToMarkdown(child, ctx)).join('');

    if (tag === 'br') return '\n';
    if (tag === 'hr') return '\n\n---\n\n';
    if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${normalizeInline(children())}\n\n`;
    if (tag === 'p') return `\n\n${normalizeInline(children())}\n\n`;
    if (tag === 'strong' || tag === 'b') return `**${normalizeInline(children())}**`;
    if (tag === 'em' || tag === 'i') return `*${normalizeInline(children())}*`;
    if (tag === 's' || tag === 'del') return `~~${normalizeInline(children())}~~`;
    if (tag === 'code' && node.closest('pre')) return node.textContent;
    if (tag === 'code') return `\`${node.textContent.replace(/`/g, '\\`')}\``;
    if (tag === 'pre') return codeBlockToMarkdown(node);
    if (tag === 'blockquote') return blockquoteToMarkdown(children());
    if (tag === 'ul' || tag === 'ol') return listToMarkdown(node, tag === 'ol', ctx.baseUrl);
    if (tag === 'li') {
      const marker = ctx.ordered ? `${ctx.index}. ` : '- ';
      const body = normalizeMarkdown(children()).replace(/\n/g, '\n  ');
      return body ? `${marker}${body}\n` : '';
    }
    if (tag === 'a') {
      const href = absolutizeUrl(node.getAttribute('href') || '', ctx.baseUrl);
      const text = normalizeInline(children()) || href;
      return href ? `[${text}](${href})` : text;
    }
    if (tag === 'img') {
      const src = imageSourceUrl(node, ctx.baseUrl);
      const alt = node.getAttribute('alt') || 'image';
      return src ? `![${alt}](${src})` : '';
    }
    if (tag === 'table') return tableToMarkdown(node, ctx.baseUrl);
    if (['div', 'section', 'article', 'aside', 'details'].includes(tag)) return `\n${children()}\n`;
    return children();
  }

  function listToMarkdown(node, ordered, baseUrl) {
    const items = Array.from(node.children).filter(child => child.tagName?.toLowerCase() === 'li');
    const body = items.map((child, index) => nodeToMarkdown(child, { ordered, index: index + 1, baseUrl })).join('');
    return body ? `\n${body}\n` : '';
  }

  function codeBlockToMarkdown(node) {
    const codeEl = node.querySelector('code');
    const lang = codeEl?.className?.match(/language-([\w-]+)/)?.[1] || '';
    const code = node.textContent.replace(/\n+$/g, '');
    return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
  }

  function blockquoteToMarkdown(text) {
    const body = normalizeMarkdown(text);
    if (!body) return '';
    return `\n\n${body.split('\n').map(line => `> ${line}`).join('\n')}\n\n`;
  }

  function tableToMarkdown(table, baseUrl) {
    const rows = Array.from(table.querySelectorAll('tr')).map(row =>
      Array.from(row.children).map(cell => normalizeInline(htmlToMarkdown(cell, baseUrl))).filter(Boolean)
    ).filter(row => row.length);
    if (!rows.length) return '';
    const width = Math.max(...rows.map(row => row.length));
    const pad = row => Array.from({ length: width }, (_, i) => row[i] || '');
    const header = pad(rows[0]);
    const lines = [
      `| ${header.join(' | ')} |`,
      `| ${header.map(() => '---').join(' | ')} |`,
      ...rows.slice(1).map(row => `| ${pad(row).join(' | ')} |`),
    ];
    return `\n\n${lines.join('\n')}\n\n`;
  }

  function normalizeInline(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeMarkdown(text) {
    return (text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function imageSourceUrl(node, baseUrl) {
    const candidates = [
      node.getAttribute('data-src'),
      node.getAttribute('data-original'),
      node.getAttribute('data-image-url'),
      node.getAttribute('src'),
      node.closest('a')?.getAttribute('href'),
    ].filter(Boolean);
    const remote = candidates.find(url => !url.startsWith('data:'));
    return absolutizeUrl(remote || candidates[0] || '', baseUrl);
  }

  function absolutizeUrl(url, baseUrl = '') {
    if (!url) return '';
    try {
      const documentBase = typeof document !== 'undefined' ? document.baseURI : '';
      const fallback = /^https?:\/\//i.test(documentBase) ? documentBase : '';
      return new URL(url, baseUrl || fallback || 'https://linux.do/').href;
    } catch {
      return url;
    }
  }

  function dataUrlToBytes(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return new Uint8Array();
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return new Uint8Array();
    const meta = dataUrl.slice(0, comma);
    const payload = dataUrl.slice(comma + 1);
    if (/;base64/i.test(meta)) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
    return new TextEncoder().encode(decodeURIComponent(payload));
  }

  function extensionForMime(mimeType = '') {
    const mime = mimeType.toLowerCase().split(';')[0];
    return {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'image/bmp': 'bmp',
      'image/avif': 'avif',
    }[mime] || 'bin';
  }

  function buildMarkdownZip(markdown, assets = {}, markdownPath = 'post.md') {
    const rewritten = rewriteAssetReferences(markdown, assets);
    const files = [{ path: markdownPath, data: rewritten.body.trim() + '\n' }];
    appendAssetFiles(files, rewritten.used);
    return { body: rewritten.body, files, imageCount: rewritten.used.size };
  }

  async function buildSavedTopicsArchive(store = {}, requestAsset, onProgress) {
    const metas = buildSavedTopicMetas(store);
    const imageResult = await archiveMarkdownImagesQueued(metas, requestAsset, onProgress);
    const sections = metas.map(meta => meta.heading + '\n\n' + meta.contentMarkdown);
    const assets = mergeAssetMaps(store.assets || {}, imageResult.assets);
    return {
      ...buildMarkdownZip(sections.join('\n\n'), assets, 'linuxdo-stars.md'),
      failed: imageResult.failed,
    };
  }

  function buildSavedTopicMetas(store) {
    const metas = [];
    const topics = Object.values(store.bookmarks || {})
      .filter(topic => topic && !topic._deleted)
      .sort((a, b) => new Date(b.starredAt || 0) - new Date(a.starredAt || 0));

    for (const topic of topics) {
      if (topic.contentMarkdown) {
        metas.push({
          heading: '# ' + normalizeInline(topic.topicTitle || '未知标题'),
          contentMarkdown: topic.contentMarkdown,
        });
      }
      const posts = Object.values(topic.posts || {})
        .filter(post => post && !post._deleted && post.contentMarkdown)
        .sort((a, b) => Number(a.postNumber || 0) - Number(b.postNumber || 0));
      for (const post of posts) {
        const author = post.author ? ' @' + normalizeInline(post.author) : '';
        metas.push({
          heading: '## #' + (post.postNumber || '?') + author,
          contentMarkdown: post.contentMarkdown,
        });
      }
    }
    return metas;
  }

  async function archiveMarkdownImagesQueued(metas, requestAsset, onProgress) {
    const urls = collectMarkdownImageUrls(metas);
    const state = await fetchQueuedImageAssets(urls, requestAsset, onProgress);
    const assets = {};
    for (const meta of metas) {
      const rewritten = rewriteMarkdownImageUrls(meta.contentMarkdown, state.assetsByUrl);
      meta.contentMarkdown = rewritten.markdown;
      meta.assets = rewritten.assets;
      Object.assign(assets, mergeAssetMaps(assets, rewritten.assets));
    }
    return { assets, failed: state.failed };
  }

  function collectMarkdownImageUrls(metas) {
    return [...new Set(metas.flatMap(meta =>
      markdownImageMatches(meta.contentMarkdown).map(match => absolutizeUrl(markdownImageUrl(match)))
    ).filter(url => url && !isEmojiImageUrl(url)))];
  }

  function markdownImageMatches(markdown) {
    return [...(markdown || '').matchAll(/!\[([^\]]*)\]\(\s*(?:<([^>]+)>|(https?:\/\/[^)\s]+|\/[^)\s]+))(?:\s+["'][^)]*["'])?\s*\)/g)];
  }

  function markdownImageUrl(match) {
    return match[2] || match[3] || '';
  }

  function isEmojiImageUrl(url) {
    try {
      const imageUrl = new URL(url);
      return /(?:^|\/)images\/emoji\//i.test(imageUrl.pathname);
    } catch {
      return false;
    }
  }

  async function fetchQueuedImageAssets(urls, requestAsset, onProgress) {
    const state = { nextIndex: 0, completed: 0, failed: 0, assetsByUrl: new Map() };
    const fetchAsset = typeof requestAsset === 'function' ? requestAsset : async () => null;
    onProgress?.(0, urls.length);
    await Promise.all(Array.from({ length: Math.min(3, urls.length) }, () =>
      runImageQueueWorker(urls, state, fetchAsset, onProgress)
    ));
    return state;
  }

  async function runImageQueueWorker(urls, state, fetchAsset, onProgress) {
    while (state.nextIndex < urls.length) {
      const url = urls[state.nextIndex++];
      let asset = null;
      try {
        asset = await fetchAsset(url);
      } catch {
        // A failed request leaves the original URL in the Markdown.
        asset = null;
      }
      state.assetsByUrl.set(url, asset);
      state.completed += 1;
      if (!asset) state.failed += 1;
      onProgress?.(state.completed, urls.length);
    }
  }

  function rewriteMarkdownImageUrls(markdown, matchesByUrl) {
    const matches = markdownImageMatches(markdown);
    let cursor = 0;
    let rewritten = '';
    const assets = {};
    for (const match of matches) {
      const [full, alt] = match;
      const rawUrl = markdownImageUrl(match);
      const asset = matchesByUrl.get(absolutizeUrl(rawUrl));
      rewritten += markdown.slice(cursor, match.index);
      rewritten += asset ? '![' + alt + '](asset://' + asset.id + ')' : full;
      if (asset) Object.assign(assets, mergeAssetMaps(assets, { [asset.id]: asset }));
      cursor = match.index + full.length;
    }
    return { markdown: matches.length ? rewritten + markdown.slice(cursor) : markdown, assets };
  }

  function mergeAssetMaps(...assetMaps) {
    const merged = assetMaps.reduce((target, assetMap) => {
      for (const asset of Object.values(assetMap || {})) {
        if (!asset?.id) continue;
        const existing = target[asset.id];
        if (!existing) {
          target[asset.id] = { ...asset, originalUrls: assetUrls(asset) };
          continue;
        }
        target[asset.id] = {
          ...existing,
          originalUrls: [...new Set([...assetUrls(existing), ...assetUrls(asset)])],
        };
      }
      return target;
    }, {});
    return merged;
  }

  function assetUrls(asset) {
    return asset.originalUrls || (asset.originalUrl ? [asset.originalUrl] : []);
  }

  function rewriteAssetReferences(markdown, assets) {
    const used = new Map();
    const body = (markdown || '').replace(/!\[([^\]]*)\]\(asset:\/\/([A-Za-z0-9_-]+)\)/g, (full, alt, id) => {
      const asset = assets[id];
      const source = asset?.originalUrl || asset?.originalUrls?.[0];
      if (source && isEmojiImageUrl(source)) return '![' + alt + '](<' + source + '>)';
      if (!asset?.dataUrl) {
        return source ? '![' + alt + '](<' + source + '>)' : full;
      }
      const path = 'images/' + id + '.' + extensionForMime(asset.mimeType);
      used.set(id, { ...asset, path });
      const image = '![' + alt + '](' + path + ')';
      return image;
    });
    return { body, used };
  }

  function appendAssetFiles(files, usedAssets) {
    if (!usedAssets.size) return;
    const manifest = {};
    for (const [id, asset] of usedAssets) {
      files.push({ path: asset.path, data: dataUrlToBytes(asset.dataUrl) });
      manifest[id] = {
        path: asset.path,
        mimeType: asset.mimeType || 'application/octet-stream',
        originalUrl: asset.originalUrl || asset.originalUrls?.[0] || '',
        originalUrls: asset.originalUrls || (asset.originalUrl ? [asset.originalUrl] : []),
      };
    }
    files.push({
      path: 'images/original-urls.json',
      data: JSON.stringify(manifest, null, 2) + '\n',
    });
  }

  function toBytes(fileData) {
    if (fileData instanceof Uint8Array) return fileData;
    if (fileData instanceof ArrayBuffer) return new Uint8Array(fileData);
    if (typeof fileData === 'string') return new TextEncoder().encode(fileData);
    return new Uint8Array(fileData || []);
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function writeU16(view, offset, value) { view.setUint16(offset, value, true); }
  function writeU32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

  // ZIP "store" mode keeps already-compressed images intact and avoids an
  // extra dependency in the extension bundle.
  function createZip(files = []) {
    const encoder = new TextEncoder();
    const entries = files.filter(file => file?.path).map(file => {
      const name = String(file.path).replace(/^\/+/, '');
      const nameBytes = encoder.encode(name);
      const data = toBytes(file.data);
      return { nameBytes, data, crc: crc32(data) };
    });
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
      const local = createLocalHeader(entry);
      localParts.push(local, entry.data);

      const central = createCentralHeader(entry, offset);
      centralParts.push(central);
      offset += local.length + entry.data.length;
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const parts = [...localParts, ...centralParts, createZipEndRecord(entries.length, centralSize, offset)];
    return new Blob([joinByteParts(parts)], { type: 'application/zip' });
  }

  function createLocalHeader(entry) {
    const header = new Uint8Array(30 + entry.nameBytes.length);
    const view = new DataView(header.buffer);
    writeU32(view, 0, 0x04034b50);
    writeU16(view, 4, 20);
    writeU16(view, 6, 0x0800);
    writeU32(view, 14, entry.crc);
    writeU32(view, 18, entry.data.length);
    writeU32(view, 22, entry.data.length);
    writeU16(view, 26, entry.nameBytes.length);
    header.set(entry.nameBytes, 30);
    return header;
  }

  function createCentralHeader(entry, offset) {
    const header = new Uint8Array(46 + entry.nameBytes.length);
    const view = new DataView(header.buffer);
    writeU32(view, 0, 0x02014b50);
    writeU16(view, 4, 20);
    writeU16(view, 6, 20);
    writeU16(view, 8, 0x0800);
    writeU32(view, 16, entry.crc);
    writeU32(view, 20, entry.data.length);
    writeU32(view, 24, entry.data.length);
    writeU16(view, 28, entry.nameBytes.length);
    writeU32(view, 42, offset);
    header.set(entry.nameBytes, 46);
    return header;
  }

  function createZipEndRecord(entryCount, centralSize, centralOffset) {
    const record = new Uint8Array(22);
    const view = new DataView(record.buffer);
    writeU32(view, 0, 0x06054b50);
    writeU16(view, 8, entryCount);
    writeU16(view, 10, entryCount);
    writeU32(view, 12, centralSize);
    writeU32(view, 16, centralOffset);
    return record;
  }

  function joinByteParts(parts) {
    const totalSize = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(totalSize);
    let cursor = 0;
    for (const part of parts) {
      output.set(part, cursor);
      cursor += part.length;
    }
    return output;
  }

  root.LinuxDoMarkdown = {
    htmlToMarkdown,
    normalizeInline,
    normalizeMarkdown,
    dataUrlToBytes,
    extensionForMime,
    buildMarkdownZip,
    buildSavedTopicsArchive,
    archiveMarkdownImagesQueued,
    mergeAssetMaps,
    createZip,
  };
})(globalThis);
