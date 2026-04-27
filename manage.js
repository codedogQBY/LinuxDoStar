/**
 * LinuxDo Star - Management Page
 * Cards collapsed by default, click to expand.
 */

let store = { collections: {}, bookmarks: {} };
let currentView = 'all';
let currentSort = 'newest';
const expanded = new Set();

document.addEventListener('DOMContentLoaded', async () => {
  store = await StarStorage.getAll();
  renderNav(); render(); bind();
});

async function reload() { store = await StarStorage.getAll(); renderNav(); render(); }

// ==================== Bind ====================
function bind() {
  $('searchInput').addEventListener('input', debounce(render, 150));
  $('sortSelect').addEventListener('change', e => { currentSort = e.target.value; render(); });
  $('exportBtn').addEventListener('click', () => {
    if (!Object.keys(store.bookmarks).length) return;
    dl(JSON.stringify({ exportedAt: new Date().toISOString(), v: '1.2', data: store }, null, 2),
      `linuxdo-stars-${new Date().toISOString().slice(0, 10)}.json`);
  });
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', handleImport);
  $('clearBtn').addEventListener('click', () => {
    if (!Object.keys(store.bookmarks).length) return;
    showConfirm('清空全部收藏？不可恢复', async () => { store.bookmarks = {}; await StarStorage.save(store); reload(); });
  });
  $('newColBtn').addEventListener('click', createCol);
  $('navList').addEventListener('click', handleNav);
  $('content').addEventListener('click', handleContent);
  $('panelClose').addEventListener('click', closePanel);
  $('overlay').addEventListener('click', closePanel);
}

// ==================== Nav ====================
function renderNav() {
  const cols = Object.values(store.collections).sort((a, b) => (a.order || 0) - (b.order || 0));
  const counts = { all: 0 };
  for (const bk of Object.values(store.bookmarks)) {
    const c = bk.collectionId || 'default';
    counts[c] = (counts[c] || 0) + 1;
    counts.all++;
  }
  let nP = 0;
  Object.values(store.bookmarks).forEach(b => nP += Object.keys(b.posts || {}).length);
  $('totalText').textContent = `${counts.all} 帖 · ${nP} 评`;

  $('navList').innerHTML = `
    <button class="nav-item${currentView === 'all' ? ' active' : ''}" data-view="all">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      全部 <span class="nav-count">${counts.all || 0}</span>
    </button>
    ${cols.map(c => `
      <button class="nav-item${currentView === c.id ? ' active' : ''}" data-view="${c.id}">
        <span class="nav-icon">${c.icon || '📁'}</span>
        ${h(c.name)}
        <span class="nav-count">${counts[c.id] || 0}</span>
        ${c.id !== 'default' ? `<span class="nav-edit" data-act="edit-col" data-cid="${c.id}">⋯</span>` : ''}
      </button>
    `).join('')}
  `;
}

function handleNav(e) {
  const edit = e.target.closest('[data-act="edit-col"]');
  if (edit) { e.stopPropagation(); editCol(edit.dataset.cid); return; }
  const item = e.target.closest('.nav-item');
  if (item) { currentView = item.dataset.view; renderNav(); render(); }
}

async function createCol() {
  const name = prompt('收藏夹名称：');
  if (!name?.trim()) return;
  const icons = ['📁','📚','💡','🔥','💼','🎯','🏷️','📌','🗂️','💻'];
  await StarStorage.createCollection(name.trim(), icons[Object.keys(store.collections).length % icons.length]);
  await reload();
}

function editCol(cid) {
  const col = store.collections[cid];
  if (!col) return;
  $('panelTitle').textContent = '编辑收藏夹';
  const allIcons = ['📁','📚','💡','🔥','💼','🎯','🏷️','📌','🗂️','💻','⭐','❤️','🎨','🔖','📝','🧪','🎓','🌐','🛠️','📊'];
  $('panelBody').innerHTML = `
    <div class="field"><div class="field-label">名称</div><input class="note-input" id="editName" value="${h(col.name)}" style="min-height:auto;height:34px;"></div>
    <div class="field"><div class="field-label">图标</div>
      <div class="icon-grid" id="iconGrid">${allIcons.map(i => `<button class="icon-opt${i === col.icon ? ' active' : ''}" data-i="${i}">${i}</button>`).join('')}</div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;">
      <button class="btn-primary" id="saveCol">保存</button>
      <button class="btn-outline btn-sm btn-danger" id="delCol">删除收藏夹</button>
    </div>
  `;
  let icon = col.icon;
  $('iconGrid').onclick = e => { const b = e.target.closest('.icon-opt'); if (!b) return; document.querySelectorAll('.icon-opt').forEach(x => x.classList.remove('active')); b.classList.add('active'); icon = b.dataset.i; };
  $('saveCol').onclick = async () => { const n = $('editName').value.trim(); if (!n) return; await StarStorage.updateCollection(cid, { name: n, icon }); closePanel(); reload(); };
  $('delCol').onclick = async () => { await StarStorage.deleteCollection(cid); if (currentView === cid) currentView = 'all'; closePanel(); reload(); };
  showPanel();
}

// ==================== Content ====================
function handleContent(e) {
  // Toggle card
  const head = e.target.closest('.card-head');
  if (head && !e.target.closest('.card-btn')) {
    const card = head.closest('.card');
    const k = card.dataset.key;
    card.classList.toggle('open');
    expanded.has(k) ? expanded.delete(k) : expanded.add(k);
    return;
  }

  const act = e.target.closest('[data-act]');
  if (!act) {
    // Open post link
    const pr = e.target.closest('.post-row');
    if (pr?.dataset.url && !e.target.closest('.card-btn')) window.open(pr.dataset.url, '_blank');
    return;
  }

  e.stopPropagation();
  const a = act.dataset.act;

  if (a === 'del-t') {
    delete store.bookmarks[act.dataset.key];
    StarStorage.save(store).then(reload);
  } else if (a === 'del-p') {
    const { tkey, pkey } = act.dataset;
    if (store.bookmarks[tkey]?.posts?.[pkey]) {
      delete store.bookmarks[tkey].posts[pkey];
      if (!store.bookmarks[tkey].starred && !Object.keys(store.bookmarks[tkey].posts).length) delete store.bookmarks[tkey];
      StarStorage.save(store).then(reload);
    }
  } else if (a === 'detail-t') {
    openTopicDetail(act.dataset.key);
  } else if (a === 'detail-p') {
    openPostDetail(act.dataset.tkey, act.dataset.pkey);
  } else if (a === 'move') {
    openMove(act.dataset.tkey, act.dataset.pkey);
  }
}

// ==================== Render ====================
const CHEVRON = `<svg class="card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>`;
const X = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const EYE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const FOLDER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;

function render() {
  const q = $('searchInput').value.toLowerCase().trim();
  const box = $('content');

  let items = [];
  for (const [key, bk] of Object.entries(store.bookmarks)) {
    if (currentView !== 'all' && (bk.collectionId || 'default') !== currentView) continue;
    let match = !q;
    if (q) {
      if (bk.topicTitle?.toLowerCase().includes(q)) match = true;
      if ((bk.tags || []).some(t => t.toLowerCase().includes(q))) match = true;
      if (bk.note?.toLowerCase().includes(q)) match = true;
      if (Object.values(bk.posts || {}).some(p => p.author?.toLowerCase().includes(q) || p.excerpt?.toLowerCase().includes(q))) match = true;
    }
    if (match) items.push({ key, ...bk });
  }

  items.sort((a, b) => {
    if (currentSort === 'newest') return new Date(b.starredAt || 0) - new Date(a.starredAt || 0);
    if (currentSort === 'oldest') return new Date(a.starredAt || 0) - new Date(b.starredAt || 0);
    return (a.topicTitle || '').localeCompare(b.topicTitle || '', 'zh-CN');
  });

  if (!items.length) {
    box.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg><h3>${q ? '无匹配' : '暂无收藏'}</h3><p>在 linux.do 帖子页点击 ★ 收藏</p></div>`;
    return;
  }

  box.innerHTML = items.map(t => {
    const posts = Object.entries(t.posts || {}).map(([pk, pv]) => ({ pk, ...pv })).sort((a, b) => new Date(b.starredAt || 0) - new Date(a.starredAt || 0));
    const isOpen = expanded.has(t.key);
    const colName = (store.collections[t.collectionId] || store.collections.default)?.name || '';

    return `<div class="card${isOpen ? ' open' : ''}" data-key="${t.key}">
      <div class="card-head">
        ${CHEVRON}
        <svg class="card-star" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
        <div class="card-body">
          <div class="card-title"><a href="${h(t.topicUrl)}" target="_blank">${h(t.topicTitle || '未知')}</a></div>
          <div class="card-meta">
            ${t.category ? `<span class="tag">${h(t.category)}</span>` : ''}
            ${currentView === 'all' ? `<span class="tag">${h(colName)}</span>` : ''}
            ${(t.tags || []).map(tg => `<span class="tag tag-note">${h(tg)}</span>`).join('')}
            ${t.note ? '<span class="tag tag-note">📝</span>' : ''}
            <span class="card-time">${ft(t.starredAt)}</span>
            ${posts.length ? `<span class="tag">${posts.length} 评论</span>` : ''}
          </div>
        </div>
        <div class="card-actions">
          <button class="card-btn" data-act="move" data-tkey="${t.key}" title="移动">${FOLDER}</button>
          <button class="card-btn" data-act="detail-t" data-key="${t.key}" title="详情">${EYE}</button>
          <button class="card-btn del" data-act="del-t" data-key="${t.key}" title="删除">${X}</button>
        </div>
      </div>
      ${posts.length ? `<div class="card-posts">${posts.map(p => `
        <div class="post-row" data-url="${at(p.postUrl)}">
          <span class="post-num">#${p.postNumber}</span>
          <div class="post-info">
            <span class="post-author">@${h(p.author || '?')}</span>
            <div class="post-excerpt">${h(p.excerpt || '')}</div>
            ${p.note ? `<div class="post-note">${h(p.note)}</div>` : ''}
            <div class="post-time">${ft(p.starredAt)}</div>
          </div>
          <div class="post-actions">
            <button class="card-btn" data-act="detail-p" data-tkey="${t.key}" data-pkey="${p.pk}" title="详情">${EYE}</button>
            <button class="card-btn del" data-act="del-p" data-tkey="${t.key}" data-pkey="${p.pk}" title="删除">${X}</button>
          </div>
        </div>`).join('')}</div>` : ''}
    </div>`;
  }).join('');
}

// ==================== Panel: Detail / Move ====================
function showPanel() { $('panel').classList.add('open'); $('overlay').classList.add('open'); }
function closePanel() { $('panel').classList.remove('open'); $('overlay').classList.remove('open'); }

function openTopicDetail(key) {
  const t = store.bookmarks[key]; if (!t) return;
  const colName = (store.collections[t.collectionId] || store.collections.default)?.name || '';
  $('panelTitle').textContent = '帖子详情';
  $('panelBody').innerHTML = `
    <div class="field"><div class="field-label">标题</div><div class="field-value"><a href="${h(t.topicUrl)}" target="_blank">${h(t.topicTitle)}</a></div></div>
    <div class="field"><div class="field-label">收藏夹</div><div class="field-value">${h(colName)}</div></div>
    <div class="field"><div class="field-label">分类</div><div class="field-value">${h(t.category) || '—'}</div></div>
    <div class="field"><div class="field-label">收藏时间</div><div class="field-value">${t.starredAt ? new Date(t.starredAt).toLocaleString('zh-CN') : '—'}</div></div>
    <div class="field"><div class="field-label">评论</div><div class="field-value">${Object.keys(t.posts || {}).length} 条</div></div>
    <div class="field"><div class="field-label">标签</div>
      <div class="tag-wrap">${(t.tags || []).map(tg => `<span class="tag-pill">${h(tg)}<span class="tag-pill-x" data-tag="${h(tg)}">×</span></span>`).join('')}<input class="tag-field-input" id="tagIn" placeholder="回车添加"></div>
    </div>
    <div class="field"><div class="field-label">备注</div><textarea class="note-input" id="noteIn" placeholder="写点备注...">${h(t.note || '')}</textarea></div>
    <button class="btn-primary" id="saveBtn">保存</button>
  `;
  bindTagNote(key, 'topic');
  showPanel();
}

function openPostDetail(tkey, pkey) {
  const t = store.bookmarks[tkey]; const p = t?.posts?.[pkey]; if (!p) return;
  $('panelTitle').textContent = `#${p.postNumber} 评论详情`;
  $('panelBody').innerHTML = `
    <div class="field"><div class="field-label">帖子</div><div class="field-value"><a href="${h(t.topicUrl)}" target="_blank">${h(t.topicTitle)}</a></div></div>
    <div class="field"><div class="field-label">作者</div><div class="field-value">@${h(p.author)}</div></div>
    <div class="field"><div class="field-label">内容</div><div class="field-value">${h(p.excerpt)}</div></div>
    <div class="field"><div class="field-label">链接</div><div class="field-value"><a href="${h(p.postUrl)}" target="_blank">打开原文 →</a></div></div>
    <div class="field"><div class="field-label">收藏时间</div><div class="field-value">${p.starredAt ? new Date(p.starredAt).toLocaleString('zh-CN') : '—'}</div></div>
    <div class="field"><div class="field-label">标签</div>
      <div class="tag-wrap">${(p.tags || []).map(tg => `<span class="tag-pill">${h(tg)}<span class="tag-pill-x" data-tag="${h(tg)}">×</span></span>`).join('')}<input class="tag-field-input" id="tagIn" placeholder="回车添加"></div>
    </div>
    <div class="field"><div class="field-label">备注</div><textarea class="note-input" id="noteIn" placeholder="写点备注...">${h(p.note || '')}</textarea></div>
    <button class="btn-primary" id="saveBtn">保存</button>
  `;
  bindTagNote(tkey, 'post', pkey);
  showPanel();
}

function bindTagNote(key, type, pkey) {
  const target = type === 'topic' ? store.bookmarks[key] : store.bookmarks[key]?.posts?.[pkey];
  if (!target) return;

  $('panelBody').querySelectorAll('.tag-pill-x').forEach(x => x.onclick = async () => {
    target.tags = (target.tags || []).filter(t => t !== x.dataset.tag);
    await StarStorage.save(store);
    if (type === 'topic') openTopicDetail(key); else openPostDetail(key, pkey);
  });

  $('tagIn').onkeydown = async e => {
    if (e.key !== 'Enter' || !e.target.value.trim()) return;
    e.preventDefault();
    if (!target.tags) target.tags = [];
    const v = e.target.value.trim();
    if (!target.tags.includes(v)) target.tags.push(v);
    await StarStorage.save(store);
    if (type === 'topic') openTopicDetail(key); else openPostDetail(key, pkey);
  };

  $('saveBtn').onclick = async () => {
    target.note = $('noteIn').value.trim();
    await StarStorage.save(store);
    closePanel(); render();
  };
}

function openMove(tkey, pkey) {
  const cols = Object.values(store.collections).sort((a, b) => (a.order || 0) - (b.order || 0));
  const cur = pkey ? store.bookmarks[tkey]?.posts?.[pkey]?.collectionId : store.bookmarks[tkey]?.collectionId;
  $('panelTitle').textContent = '移动到收藏夹';
  $('panelBody').innerHTML = `<div class="move-list">${cols.map(c => `
    <button class="move-item${c.id === (cur || 'default') ? ' active' : ''}" data-cid="${c.id}">
      <span>${c.icon || '📁'}</span><span>${h(c.name)}</span>
      ${c.id === (cur || 'default') ? '<span class="move-check">✓</span>' : ''}
    </button>`).join('')}</div>`;
  $('panelBody').onclick = async e => {
    const item = e.target.closest('.move-item'); if (!item) return;
    await StarStorage.moveToCollection(tkey, item.dataset.cid, pkey || null);
    await reload(); closePanel();
  };
  showPanel();
}

// ==================== Import / Confirm ====================
async function handleImport(e) {
  const f = e.target.files[0]; if (!f) return;
  try {
    const j = JSON.parse(await f.text()); const imp = j.data || j; let n = 0;
    if (imp.collections) Object.assign(store.collections, imp.collections);
    const bks = imp.bookmarks || imp;
    for (const [k, v] of Object.entries(bks)) {
      if (!k.startsWith('topic_')) continue;
      if (!store.bookmarks[k]) { store.bookmarks[k] = v; n++; }
      else { for (const [pk, pv] of Object.entries(v.posts || {})) { if (!store.bookmarks[k].posts[pk]) { store.bookmarks[k].posts[pk] = pv; n++; } } }
    }
    await StarStorage.save(store); reload(); alert(`导入成功！新增 ${n} 条`);
  } catch { alert('文件格式错误'); }
  e.target.value = '';
}

function showConfirm(msg, onYes) {
  document.querySelectorAll('.inline-confirm').forEach(el => el.remove());
  const d = document.createElement('div'); d.className = 'inline-confirm';
  d.innerHTML = `<span>${h(msg)}</span><button class="yes">确认</button><button class="no">取消</button>`;
  d.querySelector('.yes').onclick = () => { d.remove(); onYes(); };
  d.querySelector('.no').onclick = () => d.remove();
  $('content').prepend(d);
}

// ==================== Utils ====================
function $(id) { return document.getElementById(id); }
function h(t) { if (!t) return ''; const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
function at(t) { return (t || '').replace(/"/g, '&quot;'); }
function ft(s) { if (!s) return ''; const d = Date.now() - new Date(s).getTime(); if (d < 6e4) return '刚刚'; if (d < 36e5) return `${~~(d / 6e4)}分钟前`; if (d < 864e5) return `${~~(d / 36e5)}小时前`; if (d < 6048e5) return `${~~(d / 864e5)}天前`; const dt = new Date(s); return `${dt.getMonth() + 1}/${dt.getDate()}`; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function dl(c, f) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([c], { type: 'application/json' })); a.download = f; a.click(); URL.revokeObjectURL(a.href); }
