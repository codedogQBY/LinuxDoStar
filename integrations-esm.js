/**
 * External save targets for the background service worker.
 * Network requests stay here so page scripts never need CORS workarounds.
 */

const SETTINGS_KEY = 'linuxdo_settings';
const NOTION_VERSION = '2022-06-28';
const FEISHU_BASES = {
  feishu: 'https://open.feishu.cn',
  lark: 'https://open.larksuite.com',
};
const feishuTokenCache = new Map();

const DEFAULT_SETTINGS = {
  obsidianVault: '',
  obsidianFolder: '',
  obsidianDownloadImages: false,
  obsidianRestApiKey: '',
  obsidianRestApiPort: 27123,
  notionToken: '',
  notionDatabaseId: '',
  notionTitleProperty: '标题',
  notionUrlProperty: '链接',
  notionAuthorProperty: '作者',
  notionCategoryProperty: '分类',
  notionTagsProperty: '标签',
  notionDateProperty: '保存日期',
  notionCommentCountProperty: '评论数',
  feishuApiDomain: 'feishu',
  feishuAppId: '',
  feishuAppSecret: '',
  feishuAppToken: '',
  feishuTableId: '',
  feishuUploadContent: true,
  feishuUploadMarkdown: false,
};

export async function saveExternal(data, targets = []) {
  const settings = await getSettings();
  const selected = normalizeTargets(targets);
  const results = await Promise.all(selected.map(async target => {
    try {
      if (target === 'notion') await saveToNotion(data, settings);
      if (target === 'feishu') await saveToFeishu(data, settings);
      return { target, ok: true };
    } catch (error) {
      return { target, ok: false, error: error.message || '保存失败' };
    }
  }));
  return { results };
}

export async function testExternal(target, settings = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  try {
    if (target === 'notion') {
      const database = normalizeNotionId(merged.notionDatabaseId);
      if (!merged.notionToken || !database) throw new Error('请填写 Notion Token 和 Database ID');
      await notionRequest(`/v1/databases/${database}`, merged.notionToken, { method: 'GET' }, '读取 Notion 数据库');
    } else if (target === 'feishu') {
      await getFeishuToken(merged);
    } else if (target === 'obsidian') {
      await testObsidianRest(merged);
    } else {
      throw new Error('不支持的保存目标');
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || '连接失败' };
  }
}

export async function saveObsidianMedia({ assets = [], folder, apiKey, port = 27123 }) {
  if (!apiKey || !assets.length) return { paths: {}, failed: 0 };
  const baseUrl = await findObsidianBaseUrl(port, apiKey);
  const paths = {};
  let failed = 0;
  for (const asset of assets) {
    if (!asset?.id || !asset.dataUrl) continue;
    const filename = `${asset.id}.${extensionForMime(asset.mimeType)}`;
    const relativePath = `${folder || 'LinuxDo'}/media/${filename}`;
    try {
      const response = await fetch(`${baseUrl}/vault/${encodePath(relativePath)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': asset.mimeType || 'application/octet-stream',
        },
        body: dataUrlToBytes(asset.dataUrl),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      paths[asset.id] = `media/${filename}`;
    } catch {
      failed += 1;
    }
  }
  return { paths, failed };
}

async function saveToNotion(data, settings) {
  const token = String(settings.notionToken || '').trim();
  const databaseId = normalizeNotionId(settings.notionDatabaseId);
  if (!token || !databaseId) throw new Error('请先配置 Notion Token 和 Database ID');

  const database = await notionRequest(`/v1/databases/${databaseId}`, token, { method: 'GET' }, '读取 Notion 数据库');
  const schema = database.properties || {};
  const urlProperty = findProperty(schema, settings.notionUrlProperty, ['url'])
    || findProperty(schema, 'URL', ['url'])
    || findProperty(schema, 'Link', ['url']);
  const properties = buildNotionProperties(schema, data, settings);
  const children = markdownToNotionBlocks(data.markdown || '');
  const existing = urlProperty
    ? await findNotionPage(token, databaseId, urlProperty.name, data.url)
    : null;
  if (existing) await notionRequest(`/v1/pages/${existing.id}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ archived: true }),
  }, '归档旧 Notion 页面');

  const chunks = chunk(children, 100);
  const page = await notionRequest('/v1/pages', token, {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties,
      children: chunks.shift() || [{ type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: ' ' } }] } }],
    }),
  }, '创建 Notion 页面');
  for (const blockChunk of chunks) {
    await notionRequest(`/v1/blocks/${page.id}/children`, token, {
      method: 'PATCH',
      body: JSON.stringify({ children: blockChunk }),
    }, '追加 Notion 内容');
    await wait(350);
  }
  return { id: page.id };
}

function buildNotionProperties(schema, data, settings) {
  const properties = {};
  const title = findProperty(schema, settings.notionTitleProperty, ['title']) || firstProperty(schema, 'title');
  if (!title) throw new Error('Notion 数据库没有标题属性');
  properties[title.name] = { title: [{ type: 'text', text: { content: truncate(data.title || 'LinuxDo 帖子', 2000) } }] };

  const url = findProperty(schema, settings.notionUrlProperty, ['url'])
    || findProperty(schema, 'URL', ['url'])
    || findProperty(schema, 'Link', ['url']);
  if (url && data.url) properties[url.name] = { url: data.url };
  const author = findProperty(schema, settings.notionAuthorProperty, ['rich_text']);
  if (author && data.author) properties[author.name] = richTextProperty(data.author);
  const category = findProperty(schema, settings.notionCategoryProperty, ['select', 'multi_select', 'rich_text']);
  if (category && data.category) properties[category.name] = typedCategory(category.type, data.category);
  const tags = findProperty(schema, settings.notionTagsProperty, ['multi_select', 'rich_text']);
  if (tags && data.tags?.length) {
    properties[tags.name] = tags.type === 'multi_select'
      ? { multi_select: data.tags.slice(0, 20).map(tag => ({ name: truncate(tag, 100) })) }
      : richTextProperty(data.tags.join(', '));
  }
  const savedDate = findProperty(schema, settings.notionDateProperty, ['date']);
  if (savedDate) properties[savedDate.name] = { date: { start: (data.savedAt || new Date().toISOString()).slice(0, 10) } };
  const commentCount = findProperty(schema, settings.notionCommentCountProperty, ['number']);
  if (commentCount) properties[commentCount.name] = { number: Number(data.commentCount || 0) };
  return properties;
}

function typedCategory(type, value) {
  if (type === 'select') return { select: { name: truncate(value, 100) } };
  if (type === 'multi_select') return { multi_select: [{ name: truncate(value, 100) }] };
  return richTextProperty(value);
}

async function findNotionPage(token, databaseId, property, url) {
  const data = await notionRequest(`/v1/databases/${databaseId}/query`, token, {
    method: 'POST',
    body: JSON.stringify({ filter: { property, url: { equals: url } }, page_size: 1 }),
  }, '查询 Notion 页面');
  return data.results?.[0] || null;
}

function markdownToNotionBlocks(markdown) {
  const blocks = [];
  const lines = String(markdown || '').replace(/\r/g, '').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (/^```/.test(line)) {
      const language = line.slice(3).trim() || 'plain text';
      const code = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) code.push(lines[index++]);
      blocks.push({ type: 'code', code: { language: notionLanguage(language), rich_text: [{ type: 'text', text: { content: truncate(code.join('\n'), 2000) } }] } });
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const type = `heading_${heading[1].length}`;
      blocks.push({ type, [type]: { rich_text: richText(heading[2]) } });
      continue;
    }
    if (/^\s*---+\s*$/.test(line)) {
      blocks.push({ type: 'divider', divider: {} });
      continue;
    }
    const image = line.match(/^!\[([^\]]*)\]\(<([^>]+)>\)$/) || line.match(/^!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)$/);
    if (image && /^https?:/i.test(image[2])) {
      blocks.push({ type: 'image', image: { type: 'external', external: { url: image[2] } } });
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      blocks.push({ type: 'quote', quote: { rich_text: richText(quote[1]) } });
      continue;
    }
    const list = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    if (list) {
      const type = /^\s*\d+\./.test(line) ? 'numbered_list_item' : 'bulleted_list_item';
      blocks.push({ type, [type]: { rich_text: richText(list[1]) } });
      continue;
    }
    blocks.push({ type: 'paragraph', paragraph: { rich_text: richText(line) } });
  }
  return blocks;
}

function richText(value) {
  const text = stripMarkdown(String(value || ''));
  return [{ type: 'text', text: { content: truncate(text || ' ', 2000) } }];
}

function richTextProperty(value) {
  return { rich_text: [{ type: 'text', text: { content: truncate(String(value || ' '), 2000) } }] };
}

function stripMarkdown(value) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function notionLanguage(language) {
  const aliases = { js: 'javascript', ts: 'typescript', sh: 'bash', shell: 'bash', yml: 'yaml', md: 'markdown', txt: 'plain text' };
  const value = aliases[language.toLowerCase()] || language.toLowerCase();
  const supported = new Set(['plain text', 'javascript', 'typescript', 'bash', 'yaml', 'markdown', 'python', 'json', 'html', 'css', 'java', 'c', 'c++', 'c#', 'go', 'rust', 'sql', 'swift', 'kotlin', 'ruby', 'php', 'powershell']);
  return supported.has(value) ? value : 'plain text';
}

async function saveToFeishu(data, settings) {
  const required = ['feishuAppId', 'feishuAppSecret', 'feishuAppToken', 'feishuTableId'];
  if (required.some(key => !String(settings[key] || '').trim())) throw new Error('请完整填写飞书 App ID、Secret、app_token 和 table_id');
  const token = await getFeishuToken(settings);
  const base = feishuBase(settings.feishuApiDomain);
  let existing = null;
  try {
    existing = await findFeishuRecord(base, token, settings, data.url, data.title);
  } catch (error) {
    console.warn('[LinuxDo Star] 飞书去重查询失败，将创建新记录', error);
  }
  const fields = {
    标题: truncate(data.title || 'LinuxDo 帖子', 500),
    链接: { link: data.url, text: truncate(data.title || data.url, 500) },
    作者: truncate(data.author || '', 500),
    保存时间: Date.now(),
    评论数: Number(data.commentCount || 0),
  };
  if (settings.feishuUploadContent !== false) fields.正文 = sanitizeFeishuContent(data.markdown);
  if (settings.feishuUploadMarkdown) {
    const tokenResult = await uploadFeishuMarkdown(base, token, settings.feishuAppToken, data.title, data.markdown);
    fields.附件 = [{ file_token: tokenResult }];
  }
  const endpoint = existing
    ? `${base}/open-apis/bitable/v1/apps/${settings.feishuAppToken}/tables/${settings.feishuTableId}/records/${existing.record_id}`
    : `${base}/open-apis/bitable/v1/apps/${settings.feishuAppToken}/tables/${settings.feishuTableId}/records`;
  const result = await requestJson(endpoint, {
    method: existing ? 'PUT' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  }, existing ? '更新飞书记录' : '创建飞书记录');
  if (result.code !== 0) throw new Error(`飞书保存失败：${result.msg || result.code}`);
  return result.data?.record || result.data;
}

async function findFeishuRecord(base, token, settings, url, title) {
  const endpoint = `${base}/open-apis/bitable/v1/apps/${settings.feishuAppToken}/tables/${settings.feishuTableId}/records/search`;
  const result = await requestJson(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filter: { conjunction: 'and', conditions: [{ field_name: '标题', operator: 'contains', value: [truncate(title, 500)] }] },
      page_size: 20,
    }),
  }, '查询飞书记录');
  if (result.code !== 0) throw new Error(result.msg || '查询飞书记录失败');
  return (result.data?.items || []).find(item => {
    const link = item.fields?.链接;
    return (typeof link === 'object' ? link.link : link) === url;
  }) || null;
}

async function getFeishuToken(settings) {
  const domain = settings.feishuApiDomain || 'feishu';
  const cacheKey = `${domain}:${settings.feishuAppId}`;
  const cached = feishuTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 300000) return cached.token;
  const base = feishuBase(domain);
  const result = await requestJson(`${base}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: settings.feishuAppId.trim(), app_secret: settings.feishuAppSecret.trim() }),
  }, '获取飞书访问令牌');
  if (result.code !== 0 || !result.tenant_access_token) throw new Error(`获取飞书令牌失败：${result.msg || result.code}`);
  feishuTokenCache.set(cacheKey, { token: result.tenant_access_token, expiresAt: Date.now() + Number(result.expire || 7200) * 1000 });
  return result.tenant_access_token;
}

async function uploadFeishuMarkdown(base, token, appToken, title, markdown) {
  const safeName = truncate(String(title || 'linuxdo-post').replace(/[\\/:*?"<>|]/g, '-'), 80) + '.md';
  const blob = new Blob([String(markdown || '')], { type: 'text/markdown;charset=utf-8' });
  const form = new FormData();
  form.append('file', blob, safeName);
  form.append('file_name', safeName);
  form.append('parent_type', 'bitable_file');
  form.append('parent_node', appToken);
  form.append('size', String(blob.size));
  const result = await requestJson(`${base}/open-apis/drive/v1/medias/upload_all`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  }, '上传飞书 Markdown 附件');
  if (result.code !== 0 || !result.data?.file_token) throw new Error(`上传飞书附件失败：${result.msg || result.code}`);
  return result.data.file_token;
}

function sanitizeFeishuContent(markdown) {
  return truncate(String(markdown || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt) => alt ? `[图片: ${alt}]` : '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n'), 100000);
}

async function notionRequest(path, token, options, context) {
  const headers = { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, ...(options.headers || {}) };
  return requestJson(`https://api.notion.com${path}`, { ...options, headers }, context);
}

async function requestJson(url, options, context) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      if (attempt === 2) throw error;
      lastError = error;
      await wait(800 * (attempt + 1));
      continue;
    }
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
    if (response.ok) return payload;
    const retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
    if (!retryable || attempt === 2) {
      throw new Error(`${context}失败：${payload.message || payload.msg || `HTTP ${response.status}`}`);
    }
    const retryAfter = Number(response.headers.get('Retry-After'));
    await wait(Number.isFinite(retryAfter) ? retryAfter * 1000 : 800 * (attempt + 1));
    lastError = new Error(`${context}失败：HTTP ${response.status}`);
  }
  throw lastError || new Error(`${context}失败`);
}

async function testObsidianRest(settings) {
  if (!settings.obsidianRestApiKey) throw new Error('请填写 Obsidian Local REST API Key');
  await findObsidianBaseUrl(settings.obsidianRestApiPort, settings.obsidianRestApiKey);
}

async function findObsidianBaseUrl(port, apiKey) {
  const candidates = [`http://127.0.0.1:${Number(port) || 27123}`, `https://127.0.0.1:${(Number(port) || 27123) + 1}`];
  for (const base of candidates) {
    try {
      const response = await fetch(`${base}/`, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (response.ok || response.status === 401 || response.status === 403) {
        if (!response.ok) throw new Error('Obsidian API Key 无效');
        return base;
      }
    } catch (error) {
      if (error.message === 'Obsidian API Key 无效') throw error;
    }
  }
  throw new Error('无法连接 Obsidian Local REST API，请确认插件已启动');
}

function normalizeTargets(targets) {
  const selected = Array.isArray(targets) ? targets : [];
  return [...new Set(selected.filter(target => ['notion', 'feishu'].includes(target)))];
}

async function getSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...(result[SETTINGS_KEY] || {}),
  };
}

function findProperty(schema, preferred, types) {
  const entries = Object.entries(schema || {});
  const exact = entries.find(([name, info]) => name === preferred && types.includes(info.type));
  if (exact) return { name: exact[0], type: exact[1].type };
  const normalized = String(preferred || '').toLowerCase().trim();
  const fuzzy = entries.find(([name, info]) => types.includes(info.type) && normalized && name.toLowerCase().includes(normalized));
  return fuzzy ? { name: fuzzy[0], type: fuzzy[1].type } : null;
}

function firstProperty(schema, type) {
  const entry = Object.entries(schema || {}).find(([, info]) => info.type === type);
  return entry ? { name: entry[0], type: entry[1].type } : null;
}

function normalizeNotionId(value) { return String(value || '').replace(/-/g, '').trim(); }
function feishuBase(domain) { return FEISHU_BASES[domain] || FEISHU_BASES.feishu; }
function chunk(items, size) { const chunks = []; for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size)); return chunks; }
function truncate(value, max) { return String(value || '').slice(0, max); }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function encodePath(path) { return path.split('/').map(encodeURIComponent).join('/'); }
function extensionForMime(mime = '') { return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif' })[mime.toLowerCase().split(';')[0]] || 'bin'; }
function dataUrlToBytes(dataUrl) {
  const comma = String(dataUrl).indexOf(',');
  if (comma < 0) return new Uint8Array();
  const meta = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  if (!/;base64/i.test(meta)) return new TextEncoder().encode(decodeURIComponent(body));
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
