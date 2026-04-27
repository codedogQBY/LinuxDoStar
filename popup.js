/**
 * LinuxDo Star - Popup
 * Compact preview with collapsible collections & posts
 */

let store = { collections: {}, bookmarks: {} };
const openCols = new Set();   // open collection ids
const openTopics = new Set(); // open topic keys (showing posts)

document.addEventListener('DOMContentLoaded', async () => {
  store = await StarStorage.getAll();
  render();
  bind();
  loadSyncStatus();
});

async function loadSyncStatus() {
  try {
    const cfg = await chrome.runtime.sendMessage({ type: 'SYNC_GET_CONFIG' });
    const el = $('syncIndicator');
    if (cfg.token && cfg.gistId) {
      el.className = `sync-indicator ${cfg.status || 'synced'}`;
      el.title = cfg.status === 'synced' ? '已同步' : cfg.status === 'syncing' ? '同步中' : cfg.status === 'error' ? '同步失败' : '已连接';
    } else {
      el.className = 'sync-indicator';
      el.title = '未配置同步';
    }
  } catch {}
}

function bind() {
  $('search').addEventListener('input', debounce(render, 120));
  $('openManage').addEventListener('click', openManagePage);
  $('openManage2').addEventListener('click', openManagePage);
  $('exportBtn').addEventListener('click', doExport);
  $('list').addEventListener('click', handleClick);
}

function openManagePage() { chrome.tabs.create({ url: chrome.runtime.getURL('manage.html') }); }

function doExport() {
  if (!Object.keys(store.bookmarks).length) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), v: '1.2', data: store }, null, 2)], { type: 'application/json' }));
  a.download = `linuxdo-stars-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); URL.revokeObjectURL(a.href);
}

// ==================== Click Handler ====================
async function handleClick(e) {
  const t = e.target;

  // Toggle collection
  const colH = t.closest('.col-header');
  if (colH) {
    const g = colH.closest('.col-group');
    const cid = g.dataset.cid;
    g.classList.toggle('open');
    openCols.has(cid) ? openCols.delete(cid) : openCols.add(cid);
    return;
  }

  // Toggle posts
  const pt = t.closest('.posts-toggle');
  if (pt) {
    const key = pt.dataset.key;
    const list = pt.nextElementSibling;
    pt.classList.toggle('open');
    list?.classList.toggle('open');
    openTopics.has(key) ? openTopics.delete(key) : openTopics.add(key);
    return;
  }

  // Delete topic
  const dtBtn = t.closest('[data-act="del-t"]');
  if (dtBtn) {
    e.stopPropagation();
    await StarStorage.softDeleteTopic(dtBtn.dataset.key);
    store = await StarStorage.getAll();
    render();
    return;
  }

  // Delete post
  const dpBtn = t.closest('[data-act="del-p"]');
  if (dpBtn) {
    e.stopPropagation();
    const { tkey, pkey } = dpBtn.dataset;
    await StarStorage.softDeletePost(tkey, pkey);
    store = await StarStorage.getAll();
    render();
    return;
  }

  // Open topic
  const tr = t.closest('.topic-title');
  if (tr?.dataset.url) { chrome.tabs.create({ url: tr.dataset.url }); return; }

  // Open post
  const pi = t.closest('.post-item');
  if (pi?.dataset.url && !t.closest('.post-del')) {
    chrome.tabs.create({ url: pi.dataset.url });
  }
}

// ==================== Render ====================
const CHEVRON = `<svg class="col-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>`;
const X_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

function render() {
  const q = $('search').value.toLowerCase().trim();
  const box = $('list');
  const bks = store.bookmarks || {};
  const cols = store.collections || {};

  // Stats
  let nT = 0, nP = 0;
  Object.values(bks).forEach(b => {
    if (b._deleted) return;
    if (b.starred) nT++;
    nP += Object.keys(b.posts || {}).filter(k => !b.posts[k]._deleted).length;
  });
  $('stats').textContent = (nT || nP) ? `${nT} 帖 · ${nP} 评` : '';

  // Group by collection
  const groups = {};
  for (const [key, bk] of Object.entries(bks)) {
    if (bk._deleted) continue; // Skip tombstones
    const cid = bk.collectionId || 'default';
    if (!groups[cid]) groups[cid] = [];
    let match = !q;
    if (q && bk.topicTitle?.toLowerCase().includes(q)) match = true;
    if (q && Object.values(bk.posts || {}).some(p => p.author?.toLowerCase().includes(q) || p.excerpt?.toLowerCase().includes(q))) match = true;
    if (match) groups[cid].push({ key, ...bk });
  }

  const sortedCols = Object.values(cols).sort((a, b) => (a.order || 0) - (b.order || 0));
  let html = '';

  for (const col of sortedCols) {
    const items = (groups[col.id] || []).sort((a, b) => new Date(b.starredAt || 0) - new Date(a.starredAt || 0));
    if (!items.length) continue;

    const isOpen = openCols.has(col.id);

    html += `<div class="col-group${isOpen ? ' open' : ''}" data-cid="${col.id}">
      <div class="col-header">
        ${CHEVRON}
        <span class="col-icon">${col.icon || '📁'}</span>
        <span class="col-name">${h(col.name)}</span>
        <span class="col-count">${items.length}</span>
      </div>
      <div class="col-body">
        ${items.map(t => renderTopic(t, q)).join('')}
      </div>
    </div>`;
  }

  if (!html) {
    box.innerHTML = `<div class="empty">
      <svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
      <div class="empty-title">${q ? '无匹配' : '暂无收藏'}</div>
      <div class="empty-desc">点击帖子中的 ★ 开始收藏</div>
    </div>`;
  } else {
    box.innerHTML = html;
  }
}

function renderTopic(t, q) {
  const posts = Object.entries(t.posts || {})
    .map(([pk, pv]) => ({ pk, ...pv }))
    .filter(p => !p._deleted) // Skip tombstones
    .filter(p => !q || p.author?.toLowerCase().includes(q) || p.excerpt?.toLowerCase().includes(q))
    .sort((a, b) => new Date(b.starredAt || 0) - new Date(a.starredAt || 0));

  const totalPosts = posts.length;
  const isPostsOpen = openTopics.has(t.key);

  return `<div class="topic-item">
    <div class="topic-row">
      <svg class="topic-star" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
      <div class="topic-info">
        <div class="topic-title" data-url="${a(t.topicUrl)}">${h(t.topicTitle || '未知标题')}</div>
        <div class="topic-meta">
          ${t.category ? `<span class="badge">${h(t.category)}</span>` : ''}
          ${(t.tags || []).slice(0, 3).map(tg => `<span class="badge badge-tag">${h(tg)}</span>`).join('')}${(t.tags || []).length > 3 ? `<span class="badge">+${(t.tags || []).length - 3}</span>` : ''}
          <span class="badge">${ft(t.starredAt)}</span>
          ${totalPosts ? `<span class="badge">${totalPosts} 评</span>` : ''}
        </div>
      </div>
      <div class="topic-actions">
        <button class="btn-tiny del" data-act="del-t" data-key="${t.key}" title="删除">${X_SVG}</button>
      </div>
    </div>
    ${totalPosts ? `
      <button class="posts-toggle${isPostsOpen ? ' open' : ''}" data-key="${t.key}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
        ${totalPosts} 条评论
      </button>
      <div class="post-list${isPostsOpen ? ' open' : ''}">
        ${posts.slice(0, 10).map(p => `
          <div class="post-item" data-url="${a(p.postUrl)}">
            <span class="post-num">#${p.postNumber}</span>
            <div class="post-info">
              <span class="post-author">@${h(p.author || '?')}</span>
              <div class="post-excerpt">${h(p.excerpt || '')}</div>
            </div>
            <button class="post-del" data-act="del-p" data-tkey="${t.key}" data-pkey="${p.pk}" title="删除">${X_SVG}</button>
          </div>
        `).join('')}
        ${totalPosts > 10 ? `<div style="padding:2px 12px 4px 44px;font-size:10px;color:#a1a1aa;">还有 ${totalPosts - 10} 条</div>` : ''}
      </div>
    ` : ''}
  </div>`;
}

// Utils
function $(id) { return document.getElementById(id); }
function h(t) { if (!t) return ''; const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
function a(t) { return (t || '').replace(/"/g, '&quot;'); }
function ft(s) { if (!s) return ''; const d = Date.now() - new Date(s).getTime(); if (d < 6e4) return '刚刚'; if (d < 36e5) return `${~~(d / 6e4)}分钟前`; if (d < 864e5) return `${~~(d / 36e5)}小时前`; if (d < 6048e5) return `${~~(d / 864e5)}天前`; const dt = new Date(s); return `${dt.getMonth() + 1}/${dt.getDate()}`; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
