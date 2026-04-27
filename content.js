/**
 * LinuxDo Star - Content Script
 * Injects star buttons into Discourse post action bars
 */

(function () {
  'use strict';

  const STAR_CLASS = 'ld-star-btn';
  const STAR_ACTIVE_CLASS = 'ld-star-active';

  // Star SVG matching Discourse's icon structure
  const STAR_SVG = `<svg class="ld-star-icon fa d-icon svg-icon svg-string" width="1em" height="1em" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
  </svg><span aria-hidden="true">\u200B</span>`;

  // ===================== DOM Utilities =====================
  function getTopicId() {
    const m = window.location.pathname.match(/\/t\/[^/]+\/(\d+)/);
    return m ? parseInt(m[1]) : null;
  }

  function getTopicSlug() {
    const m = window.location.pathname.match(/\/t\/([^/]+)\/\d+/);
    return m ? m[1] : 'topic';
  }

  function getTopicTitle() {
    for (const sel of ['#topic-title h1 a', '.fancy-title', '#topic-title h1', 'h1 .fancy-title']) {
      const el = document.querySelector(sel);
      if (el?.textContent?.trim()) return el.textContent.trim();
    }
    return document.title.split(' - ')[0]?.trim() || '未知标题';
  }

  function getTopicCategory() {
    for (const sel of ['.topic-category .badge-category__name', '.category-name', '.d-breadcrumbs .badge-category span']) {
      const el = document.querySelector(sel);
      if (el?.textContent?.trim()) return el.textContent.trim();
    }
    return '';
  }

  function getTopicTags() {
    // Discourse tags appear as links in .discourse-tags or .topic-header-extra
    const tagEls = document.querySelectorAll(
      '.discourse-tags .discourse-tag,' +
      '.topic-header-extra .discourse-tag,' +
      '#topic-title .discourse-tag,' +
      '.tag-list .discourse-tag'
    );
    const tags = [];
    tagEls.forEach(el => {
      const t = el.textContent.trim();
      if (t && !tags.includes(t)) tags.push(t);
    });
    return tags;
  }

  function getTopicMeta() {
    const id = getTopicId();
    return {
      title: getTopicTitle(),
      url: `https://linux.do/t/${getTopicSlug()}/${id}`,
      category: getTopicCategory(),
      tags: getTopicTags(),
    };
  }

  // ===================== Toast =====================
  function showToast(message, icon = '⭐') {
    document.querySelector('.ld-star-toast')?.remove();
    const toast = document.createElement('div');
    toast.className = 'ld-star-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.innerHTML = `<span class="ld-star-toast-icon">${icon}</span><span>${message}</span>`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('ld-star-toast-visible'));
    setTimeout(() => {
      toast.classList.remove('ld-star-toast-visible');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  // ===================== Collection Picker Popup =====================
  let activePopup = null;

  function closePopup() {
    if (activePopup) { activePopup.remove(); activePopup = null; }
    document.removeEventListener('click', onDocClick, true);
  }

  function onDocClick(e) {
    if (activePopup && !activePopup.contains(e.target) && !e.target.closest('.ld-star-btn')) {
      closePopup();
    }
  }

  async function showCollectionPicker(btn, { topicId, postNumber, topicMeta, postMeta }) {
    closePopup();

    const store = await StarStorage.getAll();
    const collections = Object.values(store.collections).sort((a, b) => (a.order || 0) - (b.order || 0));

    // Find which collection this item is already in
    const topicKey = `topic_${topicId}`;
    let currentColId = null;
    if (postNumber) {
      currentColId = store.bookmarks[topicKey]?.posts?.[`post_${postNumber}`]?.collectionId;
    } else {
      currentColId = store.bookmarks[topicKey]?.collectionId;
    }

    const popup = document.createElement('div');
    popup.className = 'ld-star-popup';

    const matchingCollections = [...collections]; // Will be filtered by search

    popup.innerHTML = `
      <div class="ld-star-popup-header">
        <span>收藏到</span>
        <span class="ld-star-popup-total">${collections.length} 个收藏夹</span>
      </div>
      <div class="ld-star-popup-search-wrap">
        <input class="ld-star-popup-search" placeholder="搜索收藏夹..." type="text">
      </div>
      <div class="ld-star-popup-list" id="ldPopupList"></div>
      <button class="ld-star-popup-item ld-star-popup-new" data-action="new-collection">
        <span class="ld-star-popup-icon">＋</span>
        <span class="ld-star-popup-name">新建收藏夹</span>
      </button>
    `;

    function renderList(filter = '') {
      const listEl = popup.querySelector('#ldPopupList');
      const q = filter.toLowerCase().trim();
      const filtered = q
        ? collections.filter(c => c.name.toLowerCase().includes(q) || (c.icon || '').includes(q))
        : collections;

      if (filtered.length === 0) {
        listEl.innerHTML = `<div class="ld-star-popup-empty">无匹配结果</div>`;
        return;
      }

      // Show recent/pinned first (default collection always first), then alphabetical
      const sorted = [...filtered].sort((a, b) => {
        if (a.id === 'default') return -1;
        if (b.id === 'default') return 1;
        // If one is the current collection, show it near top
        if (a.id === currentColId) return -1;
        if (b.id === currentColId) return 1;
        return a.name.localeCompare(b.name, 'zh-CN');
      });

      listEl.innerHTML = sorted.map(c => `
        <button class="ld-star-popup-item${c.id === currentColId ? ' active' : ''}" data-cid="${c.id}">
          <span class="ld-star-popup-icon">${c.icon || '📁'}</span>
          <span class="ld-star-popup-name">${c.name}</span>
          ${c.id === currentColId ? '<span class="ld-star-popup-check">✓</span>' : ''}
        </button>
      `).join('');
    }

    renderList();

    // Search filter
    popup.querySelector('.ld-star-popup-search').addEventListener('input', (e) => {
      renderList(e.target.value);
    });
    // Allow keyboard nav: Enter on search selects first visible item
    popup.querySelector('.ld-star-popup-search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = popup.querySelector('#ldPopupList .ld-star-popup-item');
        if (first) first.click();
      }
    });

    // Position near the button
    const rect = btn.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.top = (rect.bottom + 4) + 'px';
    popup.style.left = Math.max(8, rect.left - 80) + 'px';
    popup.style.zIndex = '99999';

    // Handle clicks on popup
    popup.addEventListener('click', async (e) => {
      e.stopPropagation();

      // New collection
      const newBtn = e.target.closest('[data-action="new-collection"]');
      if (newBtn) {
        newBtn.outerHTML = `
          <div class="ld-star-popup-input-row">
            <input class="ld-star-popup-input" placeholder="收藏夹名称" autofocus>
            <button class="ld-star-popup-input-ok">✓</button>
          </div>
        `;
        const input = popup.querySelector('.ld-star-popup-input');
        const ok = popup.querySelector('.ld-star-popup-input-ok');
        input?.focus();

        const doCreate = async () => {
          const name = input.value.trim();
          if (!name) return;
          const icons = ['📁','📚','💡','🔥','💼','🎯','🏷️','📌','🗂️','💻'];
          const icon = icons[Object.keys(store.collections).length % icons.length];
          const newId = await StarStorage.createCollection(name, icon, '#71717a');
          closePopup();
          // Auto-save to the new collection
          try {
            if (postNumber) {
              await StarStorage.togglePostStar(topicId, parseInt(postNumber), topicMeta, postMeta, newId);
            } else {
              await StarStorage.toggleTopicStar(topicId, topicMeta, newId);
            }
            btn.classList.add(STAR_ACTIVE_CLASS);
            showToast(`已收藏到「${name}」`);
            updateTopicStarState(topicId);
            try { chrome.runtime.sendMessage({ type: 'GET_BADGE_COUNT' }); } catch {}
          } catch (err) {
            if (err.message?.includes('Extension context invalidated')) showToast('扩展已更新，请刷新页面', '⚠️');
          }
        };

        ok?.addEventListener('click', doCreate);
        input?.addEventListener('keydown', (ke) => { if (ke.key === 'Enter') doCreate(); });
        return;
      }

      const item = e.target.closest('.ld-star-popup-item');
      if (!item) return;

      const collectionId = item.dataset.cid;
      closePopup();

      try {
        const topicKey = `topic_${topicId}`;
        const isAlreadyStarred = postNumber
          ? await StarStorage.isPostStarred(topicId, parseInt(postNumber))
          : await StarStorage.isTopicStarred(topicId);

        if (isAlreadyStarred) {
          // Already starred — move to the selected collection (don't toggle off)
          if (postNumber) {
            await StarStorage.moveToCollection(topicKey, collectionId, `post_${postNumber}`);
          } else {
            await StarStorage.moveToCollection(topicKey, collectionId, null);
          }
          btn.classList.add(STAR_ACTIVE_CLASS);
          const col = (await StarStorage.getAll()).collections[collectionId];
          showToast(`已移动到「${col?.name || '收藏夹'}」`);
        } else {
          // Not starred — star it into the selected collection
          if (postNumber) {
            await StarStorage.togglePostStar(topicId, parseInt(postNumber), topicMeta, postMeta, collectionId);
          } else {
            await StarStorage.toggleTopicStar(topicId, topicMeta, collectionId);
          }
          btn.classList.add(STAR_ACTIVE_CLASS);
          const col = (await StarStorage.getAll()).collections[collectionId];
          showToast(`已收藏到「${col?.name || '收藏夹'}」`);
        }

        updateTopicStarState(topicId);
        try { chrome.runtime.sendMessage({ type: 'GET_BADGE_COUNT' }); } catch {}
      } catch (err) {
        if (err.message?.includes('Extension context invalidated')) {
          showToast('扩展已更新，请刷新页面', '⚠️');
        }
      }
    });

    document.body.appendChild(popup);
    activePopup = popup;

    // Click outside to close
    setTimeout(() => document.addEventListener('click', onDocClick, true), 10);
  }

  // ===================== Create Star Button =====================
  function createStarButton({ isActive, ariaLabel, onDirectClick, onHoverPick }) {
    const btn = document.createElement('button');
    btn.className = `btn no-text btn-icon ${STAR_CLASS} btn-flat${isActive ? ` ${STAR_ACTIVE_CLASS}` : ''}`;
    btn.innerHTML = STAR_SVG;
    btn.setAttribute('aria-label', ariaLabel);
    btn.setAttribute('title', ariaLabel);
    btn.setAttribute('type', 'button');

    let hoverTimer = null;

    // Click: save to default collection directly
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearTimeout(hoverTimer);

      // If popup is open, close it
      if (activePopup) { closePopup(); return; }

      try {
        const newState = await onDirectClick();
        btn.classList.toggle(STAR_ACTIVE_CLASS, newState);
        btn.setAttribute('title', newState ? '取消收藏' : '收藏');

        if (newState) {
          btn.classList.add('ld-star-just-activated');
          setTimeout(() => btn.classList.remove('ld-star-just-activated'), 400);
        }
        showToast(newState ? '已收藏' : '已取消收藏', newState ? '⭐' : '☆');
        try { chrome.runtime.sendMessage({ type: 'GET_BADGE_COUNT' }); } catch {}
      } catch (err) {
        if (err.message?.includes('Extension context invalidated')) {
          showToast('扩展已更新，请刷新页面', '⚠️');
        }
      }
    });

    // Hover: show collection picker after delay
    btn.addEventListener('mouseenter', () => {
      hoverTimer = setTimeout(() => onHoverPick(btn), 500);
    });
    btn.addEventListener('mouseleave', () => {
      clearTimeout(hoverTimer);
    });

    return btn;
  }

  // ===================== Inject Stars =====================
  async function injectStars() {
    const topicId = getTopicId();
    if (!topicId) return;
    const topicMeta = getTopicMeta();

    const articles = document.querySelectorAll('.topic-post article[data-post-id]:not([data-ld-star-injected])');

    for (const article of articles) {
      article.setAttribute('data-ld-star-injected', 'true');

      const topicPost = article.closest('.topic-post');
      let postNumber = topicPost?.id?.replace('post_', '') || article.dataset.postNumber || topicPost?.dataset?.postNumber;

      if (!postNumber) {
        const link = article.querySelector('a.post-date, .post-number a');
        if (link) { const m = link.getAttribute('href')?.match(/\/(\d+)$/); if (m) postNumber = m[1]; }
      }
      if (!postNumber) {
        const all = document.querySelectorAll('.topic-post');
        const idx = Array.from(all).indexOf(topicPost);
        if (idx >= 0) postNumber = String(idx + 1);
      }
      if (!postNumber) continue;
      postNumber = String(postNumber);

      const authorEl = article.querySelector('.username a, .names .username, .first a');
      const contentEl = article.querySelector('.cooked');
      const author = authorEl?.textContent?.trim() || '';
      const excerpt = contentEl?.textContent?.trim().substring(0, 100) || '';
      const postMeta = { url: `https://linux.do/t/${getTopicSlug()}/${topicId}/${postNumber}`, author, excerpt };

      const isPostStarred = await StarStorage.isPostStarred(topicId, parseInt(postNumber));

      // Find Discourse action bar
      const actionBar =
        article.querySelector('.post-action-menu__row') ||
        article.querySelector('nav.post-controls .actions') ||
        article.querySelector('.post-menu-area .actions') ||
        article.querySelector('.post-controls .actions');
      if (!actionBar || actionBar.querySelector(`.${STAR_CLASS}`)) continue;

      const starBtn = createStarButton({
        isActive: isPostStarred,
        ariaLabel: isPostStarred ? '取消收藏' : '收藏',
        onDirectClick: async () => {
          const newState = await StarStorage.togglePostStar(topicId, parseInt(postNumber), topicMeta, postMeta, 'default');
          updateTopicStarState(topicId);
          return newState;
        },
        onHoverPick: (btn) => showCollectionPicker(btn, { topicId, postNumber, topicMeta, postMeta }),
      });

      // Insert before the first button (like Discourse's reaction button position)
      const first = actionBar.firstElementChild;
      if (first) actionBar.insertBefore(starBtn, first);
      else actionBar.appendChild(starBtn);
    }

    injectTopicStar(topicId, topicMeta);
  }

  // ===================== Topic Title Star =====================
  async function injectTopicStar(topicId, topicMeta) {
    // If star already exists and is in correct position, skip
    const existing = document.querySelector('.ld-star-topic-btn');
    if (existing) {
      // Verify it's still attached to DOM properly
      if (existing.parentNode && document.contains(existing)) return;
      // Otherwise remove orphan
      existing.remove();
    }

    // Find the topic title element
    const titleEl =
      document.querySelector('#topic-title h1') ||
      document.querySelector('.title-wrapper h1') ||
      document.querySelector('#topic-title .fancy-title');

    if (!titleEl) return;

    const isStarred = await StarStorage.isTopicStarred(topicId);

    const starBtn = createStarButton({
      isActive: isStarred,
      ariaLabel: isStarred ? '取消收藏帖子' : '收藏帖子',
      onDirectClick: () => StarStorage.toggleTopicStar(topicId, topicMeta, 'default'),
      onHoverPick: (btn) => showCollectionPicker(btn, { topicId, postNumber: null, topicMeta, postMeta: null }),
    });
    starBtn.classList.add('ld-star-topic-btn');
    starBtn.classList.remove('btn', 'no-text', 'btn-icon', 'btn-flat');

    // Append INSIDE h1 (inline with title text, not below it)
    titleEl.style.display = 'inline-flex';
    titleEl.style.alignItems = 'center';
    titleEl.style.gap = '6px';
    titleEl.appendChild(starBtn);
  }

  async function updateTopicStarState(topicId) {
    const topicBtn = document.querySelector('.ld-star-topic-btn');
    if (!topicBtn) return;
    try {
      const isStarred = await StarStorage.isTopicStarred(topicId);
      topicBtn.classList.toggle(STAR_ACTIVE_CLASS, isStarred);
    } catch {}
  }

  // ===================== Observer (robust for Discourse virtual scrolling) =====================

  // Strategy: Discourse recycles DOM nodes on scroll. We need multiple detection methods.

  function observeNewPosts() {
    // 1. MutationObserver: catches most new nodes
    const observer = new MutationObserver(() => {
      scheduleInject();
    });
    // Watch the entire topic area, not just post-stream (Discourse may replace it)
    observer.observe(document.querySelector('#main-outlet') || document.body, {
      childList: true,
      subtree: true,
    });

    // 2. Scroll-based polling: Discourse's virtual scroll recycles nodes
    //    Check on scroll if there are un-injected action bars
    let scrollTimer = null;
    const scrollTarget = document.querySelector('.ember-application') || window;
    scrollTarget.addEventListener('scroll', () => {
      if (scrollTimer) return;
      scrollTimer = setTimeout(() => {
        scrollTimer = null;
        checkForMissingStars();
      }, 300);
    }, { passive: true });

    // Also listen on the main content area
    const mainOutlet = document.querySelector('#main-outlet');
    if (mainOutlet) {
      mainOutlet.addEventListener('scroll', () => {
        if (scrollTimer) return;
        scrollTimer = setTimeout(() => {
          scrollTimer = null;
          checkForMissingStars();
        }, 300);
      }, { passive: true });
    }

    // 3. Periodic fallback: every 5s check for missing stars
    setInterval(checkForMissingStars, 5000);
  }

  let injectScheduled = false;
  function scheduleInject() {
    if (injectScheduled) return;
    injectScheduled = true;
    requestAnimationFrame(() => {
      injectScheduled = false;
      injectStars();
    });
  }

  function checkForMissingStars() {
    // 1. Check post action bars
    const actionBars = document.querySelectorAll(
      '.topic-post article[data-post-id] .post-action-menu__row,' +
      '.topic-post article[data-post-id] nav.post-controls .actions,' +
      '.topic-post article[data-post-id] .post-controls .actions'
    );
    for (const bar of actionBars) {
      if (!bar.querySelector(`.${STAR_CLASS}`)) {
        const article = bar.closest('article[data-post-id]');
        if (article) article.removeAttribute('data-ld-star-injected');
      }
    }

    // 2. Check topic title star — retry if missing
    const hasTitleStar = document.querySelector('.ld-star-topic-btn');
    const hasTitleEl = document.querySelector('#topic-title h1, #topic-title .fancy-title');

    let needsInject = !!document.querySelector('.topic-post article[data-post-id]:not([data-ld-star-injected])');

    // If title element exists but no star, trigger re-inject
    if (!hasTitleStar && hasTitleEl) {
      needsInject = true;
    }

    if (needsInject) {
      injectStars();
    }
  }

  function watchRouteChanges() {
    let lastUrl = location.href;

    function onUrlChange() {
      const newUrl = location.href;
      if (newUrl === lastUrl) return;
      lastUrl = newUrl;

      // Only act on topic pages (/t/xxx/123)
      if (!/\/t\/[^/]+\/\d+/.test(location.pathname)) {
        // Not a topic page — clean up any leftover stars
        document.querySelectorAll(`.${STAR_CLASS}`).forEach(el => el.remove());
        return;
      }

      // Topic page: wait for DOM to render, then inject
      setTimeout(() => {
        document.querySelectorAll('[data-ld-star-injected]').forEach(el => el.removeAttribute('data-ld-star-injected'));
        document.querySelectorAll(`.${STAR_CLASS}`).forEach(el => el.remove());
        closePopup();
        waitAndInject();
      }, 800);
    }

    // 1. Intercept pushState/replaceState (Discourse SPA navigation)
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (...args) {
      origPush.apply(this, args);
      onUrlChange();
    };
    history.replaceState = function (...args) {
      origReplace.apply(this, args);
      onUrlChange();
    };

    // 2. Popstate (browser back/forward)
    window.addEventListener('popstate', onUrlChange);

    // 3. Fallback: observe <title> changes (Discourse updates title on navigation)
    const titleEl = document.querySelector('title');
    if (titleEl) {
      const obs = new MutationObserver(onUrlChange);
      obs.observe(titleEl, { childList: true });
    }

    // 4. Periodic URL check (ultimate fallback for edge cases)
    setInterval(() => {
      if (location.href !== lastUrl) onUrlChange();
    }, 1000);
  }

  // ===================== Init =====================
  function isTopicPage() {
    return /\/t\/[^/]+\/\d+/.test(location.pathname);
  }

  function init() {
    // Always start route watching (for SPA navigation from homepage to topic)
    watchRouteChanges();

    // If already on a topic page, wait for posts and inject
    if (isTopicPage()) {
      waitAndInject();
    }
  }

  function waitAndInject() {
    const wait = setInterval(() => {
      if (document.querySelector('.topic-post article[data-post-id]')) {
        clearInterval(wait);
        injectStars();
        observeNewPosts();
        try { chrome.runtime.sendMessage({ type: 'GET_BADGE_COUNT' }); } catch {}
      }
    }, 300);
    setTimeout(() => clearInterval(wait), 15000);
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();
})();
