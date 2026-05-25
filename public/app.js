// ── Category helpers ──────────────────────────────────────────────────────────

const CAT_ICON = {
  tops: '👕', bottoms: '👖', shoes: '👟', outerwear: '🧥', accessories: '👒'
};
const CAT_COLOR = {
  tops: '#60a5fa', bottoms: '#818cf8', shoes: '#34d399',
  outerwear: '#fb923c', accessories: '#f472b6'
};

function catIcon(cat) { return CAT_ICON[cat] || '👗'; }
function catColor(cat) { return CAT_COLOR[cat] || '#6b7280'; }

// ── State ─────────────────────────────────────────────────────────────────────

let currentFilter = '';
let currentTagFilter = '';
let currentSort = 'newest';
let currentSearch = '';
let selectedOutfitItems = new Set();
let selectedPhotoFile = null;
let identifiedImageUrl = null;
let suggestOccasion = '';
let suggestResult = null;
let detailItemId = null;
let detailOutfitId = null;
let _pendingRatingId = null; // outfit ID waiting for a post-wear star rating

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  setupNav();
  setupFilters();
  setupSortAndSearch();
  setupAddItem();
  setupOutfitBuilder();
  setupSuggestModal();
  setupItemDetail();
  setupOutfitDetail();
  setupRatingSheet();
  loadCloset();
  initWeatherWidget(); // Feature: weather-aware daily outfit suggestion
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
});

// ── Navigation ────────────────────────────────────────────────────────────────

function setupNav() {
  // Wire up top nav tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });
  // Wire up mobile bottom nav buttons
  document.querySelectorAll('.bottom-nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
}

function switchView(view) {
  // Sync top nav tabs
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  // Sync bottom nav items (mobile)
  document.querySelectorAll('.bottom-nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  if (view === 'closet') loadCloset();
  if (view === 'outfits') loadOutfits();
  if (view === 'stats') loadStats();
  if (view === 'add') {
    showPanel('panel-camera');
    document.getElementById('btn-show-camera').classList.add('active-option');
    document.getElementById('btn-show-search').classList.remove('active-option');
  }
}

// ── Sort & Search ─────────────────────────────────────────────────────────────

let aiSearchActive = false;
let aiSearchResults = null;

function setupSortAndSearch() {
  const searchEl = document.getElementById('closet-search');
  const sortEl   = document.getElementById('closet-sort');
  const clearBtn = document.getElementById('btn-clear-search');
  const aiBtn    = document.getElementById('btn-smart-search');

  let searchTimer;
  searchEl.addEventListener('input', () => {
    clearBtn.classList.toggle('hidden', !searchEl.value);
    // Typing cancels any active AI search
    if (aiSearchActive) {
      aiSearchActive = false;
      aiSearchResults = null;
      hideBanner();
    }
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      currentSearch = searchEl.value.trim();
      loadCloset();
    }, 180);
  });

  searchEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') runAiSearch();
  });

  aiBtn.addEventListener('click', runAiSearch);

  clearBtn.addEventListener('click', () => {
    searchEl.value = '';
    currentSearch = '';
    aiSearchActive = false;
    aiSearchResults = null;
    clearBtn.classList.add('hidden');
    hideBanner();
    loadCloset();
  });

  sortEl.addEventListener('change', () => {
    currentSort = sortEl.value;
    loadCloset();
  });
}

async function runAiSearch() {
  const query = document.getElementById('closet-search').value.trim();
  if (!query) return;

  const aiBtn = document.getElementById('btn-smart-search');
  aiBtn.textContent = '⏳';
  aiBtn.disabled = true;

  try {
    const data = await apiFetch('/items/smart-search', {
      method: 'POST',
      body: JSON.stringify({ query })
    });
    aiSearchActive = true;
    aiSearchResults = data.items;

    const id = data.identified;
    const productLabel = id ? `${id.brand ? id.brand + ' ' : ''}${id.name}` : query;

    if (data.items.length > 0) {
      // Found in closet
      showBanner(`✨ <strong>${esc(productLabel)}</strong> — ${data.items.length} match${data.items.length !== 1 ? 'es' : ''} in your closet`);
      renderItemGrid('items-grid', data.items, false);
    } else if (id) {
      // Not in closet but product identified — offer to add it
      showBannerWithAdd(productLabel, id);
      document.getElementById('items-grid').innerHTML =
        `<p class="empty-state"><span class="empty-state-icon">🔍</span><strong>${esc(productLabel)}</strong> isn't in your closet yet.</p>`;
    } else {
      showBanner(`✨ No matches found for "${esc(query)}"`);
      renderItemGrid('items-grid', [], false);
    }
  } catch {
    showToast('AI search failed — try again', true);
  } finally {
    aiBtn.textContent = '✨';
    aiBtn.disabled = false;
  }
}

function showBannerWithAdd(label, identified) {
  const el = document.getElementById('ai-search-banner');
  el.innerHTML = `✨ Identified: <strong>${esc(label)}</strong> — not in your closet &nbsp;
    <button class="btn-banner-add" id="btn-add-identified">+ Add to Closet</button>`;
  el.classList.remove('hidden');

  document.getElementById('btn-add-identified').addEventListener('click', () => {
    // Pre-fill the Add Item search with the identified product name
    switchView('add');
    document.getElementById('btn-show-search').click();
    const searchInput = document.getElementById('search-input');
    searchInput.value = `${identified.brand ? identified.brand + ' ' : ''}${identified.name}`;
    // Auto-trigger search
    document.getElementById('btn-do-search').click();
  });
}

function showBanner(html) {
  const el = document.getElementById('ai-search-banner');
  el.innerHTML = html;
  el.classList.remove('hidden');
}

function hideBanner() {
  document.getElementById('ai-search-banner').classList.add('hidden');
}

function applySort(items) {
  const arr = [...items];
  switch (currentSort) {
    case 'oldest': return arr.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
    case 'name':   return arr.sort((a, b) => a.name.localeCompare(b.name));
    case 'worn':   return arr.sort((a, b) => (b.wearCount || 0) - (a.wearCount || 0));
    case 'never':  return arr.filter(i => !i.wearCount).concat(arr.filter(i => i.wearCount));
    default:       return arr.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }
}

function applySearch(items) {
  if (!currentSearch) return items;

  // Fuse.js fuzzy search — handles typos, partial words, multi-field
  const fuse = new Fuse(items, {
    keys: [
      { name: 'name',     weight: 0.40 },
      { name: 'brand',    weight: 0.22 },
      { name: 'color',    weight: 0.14 },
      { name: 'material', weight: 0.12 },
      { name: 'category', weight: 0.07 },
      { name: 'tags',     weight: 0.05 }
    ],
    threshold: 0.4,
    ignoreLocation: true,
    minMatchCharLength: 2,
    includeScore: true
  });

  const results = fuse.search(currentSearch);
  return results.map(r => r.item);
}

// ── Closet ────────────────────────────────────────────────────────────────────

function setupFilters() {
  document.querySelectorAll('.filter[data-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter[data-cat]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.cat;
      loadCloset();
    });
  });

  document.querySelectorAll('.filter[data-tag]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter[data-tag]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTagFilter = btn.dataset.tag;
      loadCloset();
    });
  });
}

async function loadCloset() {
  if (aiSearchActive) return; // AI search result is already rendered

  // Feature 3: archived view fetches all items and filters to archived only
  if (currentFilter === 'archived') {
    try {
      let items = await apiFetch('/items?includeArchived=true');
      items = items.filter(i => i.isArchived);
      items = applySearch(applySort(items));
      renderItemGrid('items-grid', items, false);
    } catch {
      document.getElementById('items-grid').innerHTML = '<p class="empty-state">Failed to load closet.</p>';
    }
    return;
  }

  const params = [];
  if (currentFilter) params.push(`category=${encodeURIComponent(currentFilter)}`);
  if (currentTagFilter) params.push(`tag=${encodeURIComponent(currentTagFilter)}`);
  const url = '/items' + (params.length ? '?' + params.join('&') : '');
  try {
    let items = await apiFetch(url);
    items = applySearch(applySort(items));

    // Show full empty state when closet is truly empty (no filter/search active)
    if (!items.length && !currentFilter && !currentTagFilter && !currentSearch) {
      document.getElementById('items-grid').innerHTML = `
        <div class="empty-state-full">
          <div class="empty-state-emoji">👕</div>
          <h2 class="empty-state-title">Your closet is empty</h2>
          <p class="empty-state-desc">Add your first item by taking a photo or describing it — Claude will identify the brand, color, and category automatically.</p>
          <div class="empty-state-actions">
            <button class="btn-primary empty-cta" data-action="camera">📷 Take a Photo</button>
            <button class="btn-secondary empty-cta" data-action="search">🔍 Search an Item</button>
          </div>
        </div>`;
      // Wire up CTA buttons
      document.querySelector('.empty-cta[data-action="camera"]').addEventListener('click', () => {
        switchView('add');
        document.getElementById('btn-show-camera').click();
      });
      document.querySelector('.empty-cta[data-action="search"]').addEventListener('click', () => {
        switchView('add');
        document.getElementById('btn-show-search').click();
      });
      return;
    }

    renderItemGrid('items-grid', items, false);
  } catch {
    document.getElementById('items-grid').innerHTML = '<p class="empty-state">Failed to load closet.</p>';
  }
}

function renderItemGrid(containerId, items, selectable) {
  const grid = document.getElementById(containerId);
  if (!items.length) {
    grid.innerHTML = `<p class="empty-state"><span class="empty-state-icon">👗</span>${selectable ? 'No items in closet.' : 'Your closet is empty — add some clothes!'}</p>`;
    return;
  }
  grid.innerHTML = items.map(item => {
    const color = catColor(item.category);
    const meta = [item.color, item.size, item.brand].filter(Boolean).join(' · ');
    const tags = (item.tags || []).map(t => `<span class="tag-chip">${esc(t)}</span>`).join('');
    const wearInfo = item.wearCount ? `<div class="item-wear">worn ${item.wearCount}×</div>` : '';
    const actionBtns = selectable ? '' : `
      <button class="btn-wear" data-id="${item.id}" title="Log as worn today">✓</button>
      <button class="btn-delete" data-id="${item.id}" title="Remove">×</button>`;
    // Feature 1: dirty badge overlay and dim class
    const dirtyClass = item.isDirty ? ' item-dirty' : '';
    const dirtyBadge = item.isDirty ? `<div class="item-dirty-badge" title="Needs washing">🧺</div>` : '';
    // Feature 3: archived dim class
    const archivedClass = item.isArchived ? ' item-archived' : '';

    if (item.imageUrl) {
      return `
        <div class="item-card has-image${dirtyClass}${archivedClass}" data-id="${item.id}" data-category="${item.category}">
          <img class="item-img" src="${esc(item.imageUrl)}" alt="${esc(item.name)}">
          <div class="item-overlay">
            <div class="item-name">${esc(item.name)}</div>
            <div class="item-meta">${esc(meta)}</div>
            <span class="item-cat-badge" style="background:${color}33;color:${color}">${item.category}</span>
            ${tags ? `<div class="item-tags">${tags}</div>` : ''}
            ${wearInfo}
          </div>
          ${dirtyBadge}
          ${actionBtns}
        </div>`;
    } else {
      return `
        <div class="item-card${dirtyClass}${archivedClass}" data-id="${item.id}" data-category="${item.category}">
          <div class="item-icon" style="background:${color}18">${catIcon(item.category)}</div>
          <div class="item-info">
            <div class="item-name">${esc(item.name)}</div>
            <div class="item-meta">${esc(meta)}</div>
            <span class="item-cat-badge" style="background:${color}18;color:${color}">${item.category}</span>
            ${tags ? `<div class="item-tags">${tags}</div>` : ''}
            ${wearInfo}
            ${selectable ? '' : `<button class="btn-find-img" data-id="${item.id}">🔍 Find Image</button>`}
          </div>
          ${dirtyBadge}
          ${actionBtns}
        </div>`;
    }
  }).join('');

  if (selectable) {
    grid.querySelectorAll('.item-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        if (selectedOutfitItems.has(id)) {
          selectedOutfitItems.delete(id);
          card.classList.remove('selected');
        } else {
          selectedOutfitItems.add(id);
          card.classList.add('selected');
        }
      });
    });
  } else {
    grid.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); deleteItem(btn.dataset.id); });
    });
    grid.querySelectorAll('.btn-wear').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); wearItem(btn.dataset.id); });
    });
    grid.querySelectorAll('.btn-find-img').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); findImageForItem(btn); });
    });
    grid.querySelectorAll('.item-card').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        openItemDetail(card.dataset.id);
      });
    });
  }
}

async function deleteItem(id) {
  try {
    await apiFetch(`/items/${id}`, { method: 'DELETE' });
    showToast('Item removed');
    loadCloset();
  } catch {
    showToast('Failed to remove item', true);
  }
}

async function wearItem(id) {
  try {
    await apiFetch(`/items/${id}/wear`, { method: 'POST' });
    showToast('Logged as worn today!');
    loadCloset();
  } catch {
    showToast('Failed to log wear', true);
  }
}

async function findImageForItem(btn) {
  const id = btn.dataset.id;
  btn.disabled = true;
  btn.textContent = 'Searching…';
  try {
    await apiFetch(`/items/${id}/image`, { method: 'POST' });
    showToast('Image found!');
    loadCloset();
  } catch {
    showToast('No image found for this item', true);
    btn.disabled = false;
    btn.textContent = '🔍 Find Image';
  }
}

// ── Item Detail Modal ─────────────────────────────────────────────────────────

let selectedImageUrl = null; // tracks image chosen in picker

function setupItemDetail() {
  document.getElementById('btn-close-detail').addEventListener('click', closeItemDetail);
  document.getElementById('item-detail-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeItemDetail();
  });

  // View mode actions
  document.getElementById('btn-detail-wear').addEventListener('click', () => {
    const id = detailItemId; // capture before closeItemDetail nulls it
    closeItemDetail();
    wearItem(id);
  });

  // Feature 1: Mark Clean button — resets dirty flag and refreshes
  document.getElementById('btn-detail-clean').addEventListener('click', async () => {
    try {
      await apiFetch(`/items/${detailItemId}/clean`, { method: 'POST' });
      showToast('Marked as clean!');
      closeItemDetail();
      loadCloset();
    } catch {
      showToast('Failed to update item', true);
    }
  });

  // Feature 3: Archive / Unarchive button — toggles seasonal storage state
  document.getElementById('btn-detail-archive').addEventListener('click', async () => {
    const item = window._detailItem;
    if (!item) return;
    const endpoint = item.isArchived ? 'unarchive' : 'archive';
    const toastMsg = item.isArchived ? 'Back in closet!' : 'Moved to storage';
    try {
      await apiFetch(`/items/${detailItemId}/${endpoint}`, { method: 'POST' });
      showToast(toastMsg);
      closeItemDetail();
      loadCloset();
    } catch {
      showToast('Failed to update item', true);
    }
  });

  document.getElementById('btn-detail-find-img').addEventListener('click', async () => {
    const btn = document.getElementById('btn-detail-find-img');
    btn.disabled = true;
    btn.textContent = 'Searching…';
    try {
      await apiFetch(`/items/${detailItemId}/image`, { method: 'POST' });
      showToast('Image found!');
      closeItemDetail();
      loadCloset();
    } catch {
      showToast('No image found', true);
      btn.disabled = false;
      btn.textContent = '🔍 Find Image';
    }
  });
  document.getElementById('btn-detail-delete').addEventListener('click', () => {
    closeItemDetail();
    deleteItem(detailItemId);
  });

  // Edit toggle
  document.getElementById('btn-detail-edit').addEventListener('click', enterEditMode);
  document.getElementById('btn-detail-cancel-edit').addEventListener('click', exitEditMode);
  document.getElementById('btn-detail-save').addEventListener('click', saveItemEdits);

  // Image picker
  document.getElementById('btn-load-images').addEventListener('click', loadImagePicker);
}

function enterEditMode() {
  const item = window._detailItem;
  if (!item) return;

  // Pre-fill inputs
  document.getElementById('edit-name').value = item.name || '';
  document.getElementById('edit-color').value = item.color || '';
  document.getElementById('edit-size').value = item.size || '';
  document.getElementById('edit-brand').value = item.brand || '';
  document.getElementById('edit-material').value = item.material || '';
  document.getElementById('edit-price').value = item.purchasePrice || ''; // Feature 2: price paid
  const catSelect = document.getElementById('edit-category');
  [...catSelect.options].forEach(o => { o.selected = o.value === item.category; });

  // Pre-check tags
  document.querySelectorAll('.edit-tag-check').forEach(cb => {
    cb.checked = (item.tags || []).includes(cb.value);
  });

  // Reset image picker
  selectedImageUrl = item.imageUrl || null;
  document.getElementById('image-picker-grid').classList.add('hidden');
  document.getElementById('image-picker-grid').innerHTML = '';
  document.getElementById('image-picker-loading').classList.add('hidden');
  document.getElementById('btn-load-images').textContent = 'Browse Images';

  document.getElementById('detail-edit-error').classList.add('hidden');
  document.getElementById('detail-view').classList.add('hidden');
  document.getElementById('detail-edit').classList.remove('hidden');
}

function exitEditMode() {
  document.getElementById('detail-edit').classList.add('hidden');
  document.getElementById('detail-view').classList.remove('hidden');
}

async function loadImagePicker() {
  const btn = document.getElementById('btn-load-images');
  const grid = document.getElementById('image-picker-grid');
  const loading = document.getElementById('image-picker-loading');

  btn.disabled = true;
  btn.textContent = 'Loading…';
  grid.classList.add('hidden');
  loading.classList.remove('hidden');

  try {
    const data = await apiFetch(`/items/${detailItemId}/images`);
    loading.classList.add('hidden');

    if (!data.images.length) {
      btn.textContent = 'No images found';
      btn.disabled = false;
      return;
    }

    grid.innerHTML = data.images.map((url, i) =>
      `<img class="image-picker-thumb${selectedImageUrl === url ? ' selected' : ''}"
            src="${esc(url)}" data-url="${esc(url)}" alt="Option ${i + 1}"
            onerror="this.style.display='none'">`
    ).join('');

    grid.querySelectorAll('.image-picker-thumb').forEach(img => {
      img.addEventListener('click', () => {
        grid.querySelectorAll('.image-picker-thumb').forEach(t => t.classList.remove('selected'));
        img.classList.add('selected');
        selectedImageUrl = img.dataset.url;
        // Live-preview the selection on the modal image
        const detailImg = document.getElementById('detail-img');
        detailImg.src = selectedImageUrl;
        detailImg.classList.remove('hidden');
        document.getElementById('detail-icon').classList.add('hidden');
      });
    });

    grid.classList.remove('hidden');
    btn.textContent = 'Refresh';
    btn.disabled = false;
  } catch {
    loading.classList.add('hidden');
    btn.textContent = 'Browse Images';
    btn.disabled = false;
    showToast('Could not load images', true);
  }
}

async function saveItemEdits() {
  const name = document.getElementById('edit-name').value.trim();
  const color = document.getElementById('edit-color').value.trim();
  const errEl = document.getElementById('detail-edit-error');
  errEl.classList.add('hidden');

  if (!name || !color) {
    errEl.textContent = 'Name and color are required.';
    errEl.classList.remove('hidden');
    return;
  }

  const tags = [...document.querySelectorAll('.edit-tag-check:checked')].map(cb => cb.value);
  const body = {
    name,
    category: document.getElementById('edit-category').value,
    color,
    size: document.getElementById('edit-size').value.trim() || null,
    brand: document.getElementById('edit-brand').value.trim() || null,
    material: document.getElementById('edit-material').value.trim() || null,
    tags,
    imageUrl: selectedImageUrl || null,
    purchasePrice: parseFloat(document.getElementById('edit-price').value) || null // Feature 2: cost-per-wear
  };

  const saveBtn = document.getElementById('btn-detail-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  try {
    await apiFetch(`/items/${detailItemId}`, { method: 'PATCH', body: JSON.stringify(body) });
    showToast('Changes saved!');
    closeItemDetail();
    loadCloset();
  } catch (e) {
    errEl.textContent = e.message || 'Failed to save.';
    errEl.classList.remove('hidden');
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Changes';
  }
}

async function openItemDetail(id) {
  detailItemId = id;
  // Reset to view mode each time
  document.getElementById('detail-edit').classList.add('hidden');
  document.getElementById('detail-view').classList.remove('hidden');
  try {
    const item = await apiFetch(`/items/${id}`);
    window._detailItem = item;
    const color = catColor(item.category);

    const img = document.getElementById('detail-img');
    const icon = document.getElementById('detail-icon');
    const wrap = document.getElementById('detail-image-wrap');

    if (item.imageUrl) {
      img.src = item.imageUrl;
      img.alt = item.name;
      img.classList.remove('hidden');
      icon.classList.add('hidden');
    } else {
      img.classList.add('hidden');
      icon.textContent = catIcon(item.category);
      icon.classList.remove('hidden');
      wrap.style.background = color + '18';
    }

    const findBtn = document.getElementById('btn-detail-find-img');
    findBtn.classList.toggle('hidden', !!item.imageUrl);
    findBtn.disabled = false;
    findBtn.textContent = '🔍 Find Image';

    // Feature 1: show "Mark Clean" button only when item is dirty
    document.getElementById('btn-detail-clean').classList.toggle('hidden', !item.isDirty);

    // Feature 3: update archive button text based on current archived state
    document.getElementById('btn-detail-archive').textContent = item.isArchived ? '📤 Bring Back' : '📦 Store Away';

    document.getElementById('detail-name').textContent = item.name;
    const badge = document.getElementById('detail-cat-badge');
    badge.textContent = item.category;
    badge.style.background = color + '22';
    badge.style.color = color;

    document.getElementById('detail-color').textContent = item.color || '—';
    document.getElementById('detail-size').textContent = item.size || '—';
    document.getElementById('detail-brand').textContent = item.brand || '—';
    document.getElementById('detail-material').textContent = item.material || '—';

    // Feature 2: compute and display cost-per-wear in the Value meta field
    const cpwEl = document.getElementById('detail-cpw');
    if (item.purchasePrice && item.wearCount > 0) {
      cpwEl.textContent = `$${(item.purchasePrice / item.wearCount).toFixed(2)} / wear`;
    } else if (item.purchasePrice) {
      cpwEl.textContent = 'never worn yet';
    } else {
      cpwEl.textContent = '—';
    }

    const history = item.wearHistory || [];
    const wearEl = document.getElementById('detail-wear');
    if (!history.length) {
      wearEl.textContent = 'Never worn';
    } else {
      const latest = new Date(history[history.length - 1] + 'T12:00:00').toLocaleDateString();
      wearEl.innerHTML = `${history.length}× &nbsp;<span class="wear-history-toggle" id="wear-toggle-btn">Last: ${esc(latest)} ▾</span>`;
      document.getElementById('wear-toggle-btn').addEventListener('click', () => {
        const existing = document.getElementById('wear-history-list');
        if (existing) { existing.remove(); return; }
        const list = document.createElement('div');
        list.id = 'wear-history-list';
        list.className = 'wear-history-list';
        list.innerHTML = [...history].reverse().map(date => {
          const d = new Date(date + 'T12:00:00');
          return `<div class="wear-history-date">${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>`;
        }).join('');
        wearEl.after(list);
      });
    }

    document.getElementById('detail-tags').innerHTML =
      (item.tags || []).map(t => `<span class="tag-chip">${esc(t)}</span>`).join('');

    document.getElementById('item-detail-modal').classList.remove('hidden');
  } catch {
    showToast('Failed to load item', true);
  }
}

function closeItemDetail() {
  document.getElementById('item-detail-modal').classList.add('hidden');
  detailItemId = null;
}

// ── Outfits ───────────────────────────────────────────────────────────────────

async function loadOutfits() {
  try {
    const outfits = await apiFetch('/outfits');
    const list = document.getElementById('outfits-list');
    if (!outfits.length) {
      list.innerHTML = `
        <div class="empty-state-full">
          <div class="empty-state-emoji">👔</div>
          <h2 class="empty-state-title">No outfits yet</h2>
          <p class="empty-state-desc">Build your first outfit by picking items from your closet, or let AI suggest one based on the occasion.</p>
          <div class="empty-state-actions">
            <button class="btn-primary empty-cta" id="es-btn-new-outfit">+ Build Outfit</button>
            <button class="btn-secondary empty-cta" id="es-btn-suggest">✨ AI Suggest</button>
          </div>
        </div>`;
      // Wire up CTA buttons to the existing header buttons
      document.getElementById('es-btn-new-outfit').addEventListener('click', () => document.getElementById('btn-new-outfit').click());
      document.getElementById('es-btn-suggest').addEventListener('click', () => document.getElementById('btn-new-suggest').click());
      return;
    }
    list.innerHTML = outfits.map(o => {
      const strip = (o.items || []).slice(0, 4).map(i =>
        i.imageUrl
          ? `<img class="outfit-strip-img" src="${esc(i.imageUrl)}" alt="${esc(i.name || '')}">`
          : `<div class="outfit-strip-icon" style="background:${catColor(i.category)}18">${catIcon(i.category)}</div>`
      ).join('');

      // Show average star rating if any ratings have been submitted
      const avgBadge = o.avgRating
        ? `<span class="outfit-avg-rating" title="${o.avgRating} avg rating">${'★'.repeat(Math.round(o.avgRating))} ${o.avgRating}</span>`
        : '';

      return `
        <div class="outfit-card" data-id="${o.id}">
          <div class="outfit-image-strip">${strip || '<div class="outfit-strip-icon" style="background:var(--surface2);flex:1">👔</div>'}</div>
          <div class="outfit-card-body">
            <span class="outfit-name">${esc(o.name)}</span>
            <span class="outfit-item-count">${(o.items || []).length} items</span>
            ${avgBadge}
            <div class="outfit-card-actions">
              <button class="btn-wear-outfit" data-id="${o.id}" title="Log all items as worn today">✓ Wore This</button>
              <button class="btn-delete-outfit" data-id="${o.id}" title="Delete">×</button>
            </div>
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.outfit-card').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('.btn-delete-outfit') || e.target.closest('.btn-wear-outfit')) return;
        openOutfitDetail(card.dataset.id);
      });
    });
    list.querySelectorAll('.btn-delete-outfit').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); deleteOutfit(btn.dataset.id); });
    });
    list.querySelectorAll('.btn-wear-outfit').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); wearOutfit(btn.dataset.id, btn); });
    });
  } catch {
    document.getElementById('outfits-list').innerHTML = '<p class="empty-state">Failed to load outfits.</p>';
  }
}

async function deleteOutfit(id) {
  try {
    await apiFetch(`/outfits/${id}`, { method: 'DELETE' });
    showToast('Outfit deleted');
    loadOutfits();
  } catch {
    showToast('Failed to delete outfit', true);
  }
}

async function wearOutfit(id, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const { wornCount } = await apiFetch(`/outfits/${id}/wear`, { method: 'POST' });
    showToast(`Logged ${wornCount} item${wornCount !== 1 ? 's' : ''} as worn today!`);
    loadOutfits();
    // Prompt for a rating — skip button dismisses, rating is optional
    showRatingSheet(id);
  } catch {
    showToast('Failed to log wear', true);
    if (btn) { btn.disabled = false; btn.textContent = '✓ Wore This'; }
  }
}

// ── Outfit Detail Modal ───────────────────────────────────────────────────────

function setupOutfitDetail() {
  const close = () => {
    document.getElementById('outfit-detail-modal').classList.add('hidden');
    detailOutfitId = null;
  };
  document.getElementById('btn-close-outfit-detail').addEventListener('click', close);
  document.getElementById('btn-close-outfit-detail2').addEventListener('click', close);
  document.getElementById('outfit-detail-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) close();
  });
  document.getElementById('btn-outfit-detail-wear').addEventListener('click', () => {
    const id = detailOutfitId;
    close();
    wearOutfit(id);
  });
  document.getElementById('btn-outfit-detail-delete').addEventListener('click', () => {
    close();
    deleteOutfit(detailOutfitId);
  });
}

// ── Post-wear Rating Sheet ────────────────────────────────────────────────────

function showRatingSheet(outfitId) {
  _pendingRatingId = outfitId;
  // Reset all stars to unlit before showing the sheet
  document.querySelectorAll('.star-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('rating-modal').classList.remove('hidden');
}

function closeRatingSheet() {
  document.getElementById('rating-modal').classList.add('hidden');
  _pendingRatingId = null;
}

function setupRatingSheet() {
  const stars = document.querySelectorAll('.star-btn');

  // Hover — light up stars up to the hovered one
  stars.forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      const val = parseInt(btn.dataset.val);
      stars.forEach(s => s.classList.toggle('active', parseInt(s.dataset.val) <= val));
    });
  });

  // Mouse leaves the overlay — reset star highlight
  document.getElementById('rating-modal').addEventListener('mouseleave', () => {
    stars.forEach(b => b.classList.remove('active'));
  });

  // Click a star — submit rating, close sheet, refresh outfit list
  stars.forEach(btn => {
    btn.addEventListener('click', async () => {
      const val = parseInt(btn.dataset.val);
      if (!_pendingRatingId) return;
      try {
        await apiFetch(`/outfits/${_pendingRatingId}/rate`, {
          method: 'POST',
          body: JSON.stringify({ rating: val })
        });
        showToast(`Rated ${val} star${val !== 1 ? 's' : ''}!`);
      } catch {
        showToast('Could not save rating', true);
      }
      closeRatingSheet();
      loadOutfits(); // refresh cards so avgRating badge updates
    });
  });

  // Skip — dismiss the sheet without rating
  document.getElementById('btn-skip-rating').addEventListener('click', () => closeRatingSheet());
}

async function openOutfitDetail(id) {
  detailOutfitId = id;
  try {
    const outfits = await apiFetch('/outfits');
    const outfit = outfits.find(o => o.id === id);
    if (!outfit) return;

    document.getElementById('outfit-detail-name').textContent = outfit.name;
    document.getElementById('btn-outfit-detail-delete').dataset.id = id;

    const items = outfit.items || [];
    document.getElementById('outfit-detail-grid').innerHTML = items.map(i => `
      <div class="outfit-detail-item">
        ${i.imageUrl
          ? `<img src="${esc(i.imageUrl)}" alt="${esc(i.name || '')}">`
          : `<div class="outfit-detail-item-icon" style="background:${catColor(i.category)}18">${catIcon(i.category)}</div>`
        }
        <div class="outfit-detail-item-name">${esc(i.name || '')}</div>
      </div>`).join('');

    document.getElementById('outfit-detail-chips').innerHTML = items.map(i => `
      <span class="outfit-detail-chip">${catIcon(i.category)} ${esc(i.name || '')}</span>`).join('');

    document.getElementById('outfit-detail-modal').classList.remove('hidden');
  } catch {
    showToast('Failed to load outfit', true);
  }
}

// ── Outfit Builder Modal ──────────────────────────────────────────────────────

function setupOutfitBuilder() {
  document.getElementById('btn-new-outfit').addEventListener('click', openOutfitModal);
  document.getElementById('btn-cancel-outfit').addEventListener('click', closeOutfitModal);
  document.getElementById('btn-save-outfit').addEventListener('click', saveOutfit);
  document.getElementById('outfit-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeOutfitModal();
  });
}

async function openOutfitModal() {
  selectedOutfitItems = new Set();
  document.getElementById('outfit-name-input').value = '';
  document.getElementById('outfit-error').classList.add('hidden');
  document.getElementById('outfit-modal').classList.remove('hidden');

  try {
    const items = await apiFetch('/items');
    renderItemGrid('modal-items-grid', items, true);
  } catch {
    document.getElementById('modal-items-grid').innerHTML = '<p class="empty-state">Could not load items.</p>';
  }
}

function closeOutfitModal() {
  document.getElementById('outfit-modal').classList.add('hidden');
}

async function saveOutfit() {
  const name = document.getElementById('outfit-name-input').value.trim();
  const errEl = document.getElementById('outfit-error');
  errEl.classList.add('hidden');

  if (!name) { errEl.textContent = 'Please enter an outfit name.'; errEl.classList.remove('hidden'); return; }
  if (selectedOutfitItems.size === 0) { errEl.textContent = 'Select at least one item.'; errEl.classList.remove('hidden'); return; }

  try {
    await apiFetch('/outfits', {
      method: 'POST',
      body: JSON.stringify({ name, itemIds: [...selectedOutfitItems] })
    });
    closeOutfitModal();
    showToast('Outfit saved!');
    loadOutfits();
  } catch (e) {
    errEl.textContent = e.message || 'Failed to save outfit.';
    errEl.classList.remove('hidden');
  }
}

// ── Add Item ──────────────────────────────────────────────────────────────────

function setupAddItem() {
  document.getElementById('btn-show-camera').addEventListener('click', () => {
    showPanel('panel-camera');
    resetIdentifiedForm();
    document.getElementById('btn-show-camera').classList.add('active-option');
    document.getElementById('btn-show-search').classList.remove('active-option');
  });
  document.getElementById('btn-show-search').addEventListener('click', () => {
    showPanel('panel-search');
    resetIdentifiedForm();
    document.getElementById('btn-show-search').classList.add('active-option');
    document.getElementById('btn-show-camera').classList.remove('active-option');
  });

  const cameraInput = document.getElementById('camera-input');
  document.getElementById('btn-choose-photo').addEventListener('click', () => cameraInput.click());
  cameraInput.addEventListener('change', onPhotoSelected);
  document.getElementById('btn-analyze').addEventListener('click', analyzePhoto);

  document.getElementById('btn-do-search').addEventListener('click', doSearch);
  document.getElementById('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
  });

  document.getElementById('btn-save-item').addEventListener('click', saveIdentifiedItem);
  document.getElementById('btn-discard').addEventListener('click', () => {
    resetIdentifiedForm();
    document.getElementById('identified-form').classList.add('hidden');
  });
}

function showPanel(id) {
  ['panel-camera', 'panel-search'].forEach(p => {
    document.getElementById(p).classList.toggle('hidden', p !== id);
  });
}

function onPhotoSelected() {
  const file = document.getElementById('camera-input').files[0];
  if (!file) return;
  selectedPhotoFile = file;

  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('preview-img').src = e.target.result;
    document.getElementById('image-preview-wrap').classList.remove('hidden');
    document.getElementById('btn-analyze').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

async function analyzePhoto() {
  if (!selectedPhotoFile) return;
  const loadingEl = document.getElementById('camera-loading');
  const errEl = document.getElementById('camera-error');
  const analyzeBtn = document.getElementById('btn-analyze');
  errEl.classList.add('hidden');
  loadingEl.classList.remove('hidden');
  analyzeBtn.disabled = true;

  try {
    const formData = new FormData();
    formData.append('image', selectedPhotoFile);
    const res = await fetch('/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Analysis failed');
    identifiedImageUrl = data.imageUrl || null;
    populateIdentifiedForm(data.identified);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  } finally {
    loadingEl.classList.add('hidden');
    analyzeBtn.disabled = false;
  }
}

async function doSearch() {
  const q = document.getElementById('search-input').value.trim();
  if (!q) return;
  const loadingEl  = document.getElementById('search-loading');
  const errEl      = document.getElementById('search-error');
  const searchBtn  = document.getElementById('btn-do-search');
  const shoppingEl = document.getElementById('shopping-results');
  errEl.classList.add('hidden');
  shoppingEl.classList.add('hidden');
  document.getElementById('identified-form').classList.add('hidden');
  loadingEl.classList.remove('hidden');
  searchBtn.disabled = true;

  try {
    const data = await apiFetch(`/items/search?q=${encodeURIComponent(q)}`);

    if (data.variants && data.variants.length > 0) {
      renderColorVariants(data.variants, data.details);
    }
    if (data.products && data.products.length > 0) {
      renderShoppingResults(data.products, data.details, data.imageUrl);
    }
    if (!data.variants?.length && !data.products?.length) {
      identifiedImageUrl = data.imageUrl || null;
      populateIdentifiedForm(data.details);
    }
  } catch (e) {
    errEl.textContent = e.message || 'Search failed.';
    errEl.classList.remove('hidden');
  } finally {
    loadingEl.classList.add('hidden');
    searchBtn.disabled = false;
  }
}

function renderColorVariants(variants, details) {
  const grid = document.getElementById('color-variants-grid');
  const wrapper = document.getElementById('color-variants');

  grid.innerHTML = variants.map((v, i) => `
    <div class="color-variant-card" data-idx="${i}">
      ${v.imageUrl
        ? `<img class="color-variant-img" src="${esc(v.imageUrl)}" alt="${esc(v.color)}"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : ''
      }
      <div class="color-variant-placeholder" style="${v.imageUrl ? 'display:none' : ''}">${catIcon(details.category)}</div>
      <div class="color-variant-name">${esc(v.color)}</div>
    </div>`).join('');

  wrapper.classList.remove('hidden');

  grid.querySelectorAll('.color-variant-card').forEach((card, idx) => {
    card.addEventListener('click', () => {
      grid.querySelectorAll('.color-variant-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');

      const v = variants[idx];
      identifiedImageUrl = v.imageUrl || null;
      populateIdentifiedForm({ ...details, color: v.color });

      // Re-fetch shopping results specific to this color
      fetchColorShopping(details, v.color);
    });
  });

  // Auto-select the first card
  grid.querySelector('.color-variant-card')?.click();
}

async function fetchColorShopping(details, color) {
  const shoppingEl = document.getElementById('shopping-results');
  const loadingEl  = document.getElementById('search-loading');
  shoppingEl.classList.add('hidden');
  loadingEl.classList.remove('hidden');

  const q = [details.brand, details.name, color].filter(Boolean).join(' ');
  try {
    const data = await apiFetch(`/items/shopping?q=${encodeURIComponent(q)}`);
    loadingEl.classList.add('hidden');
    if (data.products && data.products.length > 0) {
      renderShoppingResults(data.products, details, null);
    } else {
      shoppingEl.classList.add('hidden');
    }
  } catch {
    loadingEl.classList.add('hidden');
  }
}

function renderShoppingResults(products, fallbackDetails, fallbackImageUrl) {
  const grid = document.getElementById('shopping-grid');
  const shoppingEl = document.getElementById('shopping-results');

  grid.innerHTML = products.map((p, i) => `
    <div class="shopping-card" data-idx="${i}">
      ${p.thumbnail
        ? `<img class="shopping-card-img" src="${esc(p.thumbnail)}" alt="${esc(p.title)}" onerror="this.parentElement.querySelector('.shopping-card-img-placeholder').style.display='flex';this.style.display='none'">`
        : ''
      }
      <div class="shopping-card-img-placeholder" style="${p.thumbnail ? 'display:none' : ''}">👗</div>
      <div class="shopping-card-body">
        <div class="shopping-card-title">${esc(p.title)}</div>
        <div class="shopping-card-meta">
          ${p.price ? `<span class="shopping-card-price">${esc(p.price)}</span>` : ''}
          ${p.source ? `<span> · ${esc(p.source)}</span>` : ''}
        </div>
      </div>
    </div>`).join('');

  shoppingEl.classList.remove('hidden');

  // Click a card to select it and populate the form
  grid.querySelectorAll('.shopping-card').forEach((card, idx) => {
    card.addEventListener('click', () => {
      grid.querySelectorAll('.shopping-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');

      const p = products[idx];
      identifiedImageUrl = p.thumbnail || fallbackImageUrl || null;

      // Use Claude's identified details but override with the product's real title
      const details = { ...fallbackDetails, name: p.title };
      populateIdentifiedForm(details);
    });
  });

  // Auto-select the first card
  grid.querySelector('.shopping-card')?.click();
}

function populateIdentifiedForm(details) {
  document.getElementById('f-name').value = details.name || '';
  document.getElementById('f-color').value = details.color || '';
  document.getElementById('f-size').value = details.size || '';
  document.getElementById('f-brand').value = details.brand || '';
  document.getElementById('f-material').value = details.material || '';
  document.getElementById('f-price').value = ''; // Feature 2: price always blank on AI fill — user enters manually
  const catSelect = document.getElementById('f-category');
  if (details.category) {
    [...catSelect.options].forEach(o => { o.selected = o.value === details.category; });
  }
  document.getElementById('identified-form').classList.remove('hidden');
  document.getElementById('save-error').classList.add('hidden');
}

function resetIdentifiedForm() {
  ['f-name','f-color','f-size','f-brand','f-material','f-price'].forEach(id => { document.getElementById(id).value = ''; }); // f-price: Feature 2
  document.getElementById('f-category').selectedIndex = 0;
  document.getElementById('identified-form').classList.add('hidden');
  document.getElementById('image-preview-wrap').classList.add('hidden');
  document.getElementById('btn-analyze').classList.add('hidden');
  document.getElementById('camera-input').value = '';
  document.getElementById('search-input').value = '';
  document.getElementById('color-variants').classList.add('hidden');
  document.getElementById('color-variants-grid').innerHTML = '';
  document.getElementById('shopping-results').classList.add('hidden');
  document.getElementById('shopping-grid').innerHTML = '';
  document.querySelectorAll('.tag-check').forEach(cb => { cb.checked = false; });
  selectedPhotoFile = null;
  identifiedImageUrl = null;
}

async function saveIdentifiedItem() {
  const name = document.getElementById('f-name').value.trim();
  const color = document.getElementById('f-color').value.trim();
  const errEl = document.getElementById('save-error');
  errEl.classList.add('hidden');

  if (!name || !color) {
    errEl.textContent = 'Name and color are required.';
    errEl.classList.remove('hidden');
    return;
  }

  const tags = [...document.querySelectorAll('.tag-check:checked')].map(cb => cb.value);
  const body = {
    name, category: document.getElementById('f-category').value, color,
    size: document.getElementById('f-size').value.trim() || null,
    brand: document.getElementById('f-brand').value.trim() || null,
    material: document.getElementById('f-material').value.trim() || null,
    imageUrl: identifiedImageUrl || null,
    tags,
    purchasePrice: parseFloat(document.getElementById('f-price').value) || null // Feature 2: cost-per-wear
  };

  try {
    const saveBtn = document.getElementById('btn-save-item');
    saveBtn.disabled = true;
    await apiFetch('/items', { method: 'POST', body: JSON.stringify(body) });
    showToast('Item added to closet!');
    resetIdentifiedForm();
    showPanel('');
    switchView('closet');
  } catch (e) {
    errEl.textContent = e.message || 'Failed to save item.';
    errEl.classList.remove('hidden');
  } finally {
    document.getElementById('btn-save-item').disabled = false;
  }
}

// ── Stats ──────────────────────────────────────────────────────────────────────

async function loadStats() {
  try {
    const data = await apiFetch('/stats');
    renderStats(data);
  } catch {
    document.getElementById('stats-content').innerHTML = '<p class="empty-state">Failed to load stats.</p>';
  }
}

// ── Calendar state ────────────────────────────────────────────────────────────

let _calWearLog = {};
let _calYear  = new Date().getFullYear();
let _calMonth = new Date().getMonth(); // 0-based

function renderStats(d) {
  // Show full empty state when there are no items yet
  if (!d.totalItems) {
    document.getElementById('stats-content').innerHTML = `
      <div class="empty-state-full">
        <div class="empty-state-emoji">📊</div>
        <h2 class="empty-state-title">No data yet</h2>
        <p class="empty-state-desc">Add items to your closet and log what you wear — your stats, wear calendar, and insights will appear here.</p>
        <div class="empty-state-actions">
          <button class="btn-primary empty-cta" data-action="camera">Start Adding Items</button>
        </div>
      </div>`;
    document.querySelector('#stats-content .empty-cta[data-action="camera"]').addEventListener('click', () => {
      switchView('add');
      document.getElementById('btn-show-camera').click();
    });
    return;
  }

  const cats = Object.entries(d.byCategory).sort((a, b) => b[1] - a[1]);
  const maxCat = cats[0]?.[1] || 1;

  document.getElementById('stats-content').innerHTML = `
    <div class="stat-cards">
      <div class="stat-card"><div class="stat-num">${d.totalItems}</div><div class="stat-label">Items</div></div>
      <div class="stat-card"><div class="stat-num">${d.totalOutfits}</div><div class="stat-label">Outfits</div></div>
      <div class="stat-card"><div class="stat-num">${d.neverWorn}</div><div class="stat-label">Never Worn</div></div>
      <div class="stat-card"><div class="stat-num">${d.wornThisMonth}</div><div class="stat-label">This Month</div></div>
    </div>
    <div class="stats-panels">
      <div class="stats-panel">
        <h3>By Category</h3>
        ${cats.map(([cat, count]) => `
          <div class="cat-bar-row">
            <span class="cat-bar-label">${cat}</span>
            <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${Math.round(count / maxCat * 100)}%;background:${catColor(cat)}"></div></div>
            <span class="cat-bar-count">${count}</span>
          </div>`).join('')}
      </div>
      ${d.mostWorn.length ? `
        <div class="stats-panel">
          <h3>Most Worn</h3>
          ${d.mostWorn.map(i => `
            <div class="most-worn-row">
              <span>${catIcon(i.category)}</span>
              <span class="most-worn-name">${esc(i.name)}</span>
              <span class="most-worn-count">${i.wearCount}×</span>
            </div>`).join('')}
        </div>` : ''}
    </div>
    <div class="stats-section">
      <h3>Wear Calendar</h3>
      <div id="wear-calendar"></div>
      <div id="calendar-day-detail" class="calendar-day-detail hidden"></div>
    </div>
    <div class="stats-section">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <h3>Wardrobe Analysis</h3>
        <button id="btn-analyze-gaps" class="btn-secondary" style="font-size:12px;padding:6px 12px">Analyze ✨</button>
      </div>
      <div id="gap-analysis-result"></div>
    </div>`;

  // Initialise calendar
  _calWearLog = d.wearLog || {};
  _calYear  = new Date().getFullYear();
  _calMonth = new Date().getMonth();
  renderCalendar();

  // Wire up the wardrobe gap analysis button (rendered into stats-content above)
  document.getElementById('btn-analyze-gaps').addEventListener('click', async () => {
    const btn = document.getElementById('btn-analyze-gaps');
    const resultEl = document.getElementById('gap-analysis-result');
    btn.disabled = true;
    btn.textContent = 'Analyzing…';
    resultEl.innerHTML = '<p class="loading">Analyzing your wardrobe…</p>';

    try {
      const data = await apiFetch('/stats/gaps');
      if (data.message) {
        resultEl.innerHTML = `<p class="empty-state">${esc(data.message)}</p>`;
        return;
      }

      // Color-code gap priority labels
      const priorityColor = { high: 'var(--red)', medium: 'var(--blue)', low: 'var(--text2)' };
      resultEl.innerHTML = `
        <div class="gap-score-row">
          <div class="gap-score">${data.score}</div>
          <div>
            <div class="gap-score-label">${esc(data.scoreLabel)}</div>
            <div class="gap-score-sub">out of 100</div>
          </div>
        </div>
        ${data.strengths?.length ? `<p class="gap-strength">✓ ${esc(data.strengths[0])}</p>` : ''}
        <div class="gap-list">
          ${(data.gaps || []).map(g => `
            <div class="gap-item">
              <div class="gap-priority" style="background:${priorityColor[g.priority] || 'var(--muted)'}22;color:${priorityColor[g.priority] || 'var(--muted)'}">
                ${g.priority}
              </div>
              <div>
                <div class="gap-item-name">${esc(g.item)}</div>
                <div class="gap-item-reason">${esc(g.reason)}</div>
              </div>
            </div>`).join('')}
        </div>
        ${data.tip ? `<p class="gap-tip">💡 ${esc(data.tip)}</p>` : ''}`;
    } catch {
      resultEl.innerHTML = '<p class="error-msg">Analysis failed — try again</p>';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Analyze ✨';
    }
  });
}

function renderCalendar() {
  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const today = new Date().toISOString().slice(0,10);
  const firstDay = new Date(_calYear, _calMonth, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(_calYear, _calMonth + 1, 0).getDate();
  const monthLabel = new Date(_calYear, _calMonth, 1)
    .toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  let cells = '';
  // Blank cells before the 1st
  for (let i = 0; i < firstDay; i++) cells += `<div class="cal-cell cal-blank"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${_calYear}-${String(_calMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const hasWear = !!_calWearLog[dateStr];
    const isToday = dateStr === today;
    cells += `<div class="cal-cell${hasWear ? ' cal-has-wear' : ''}${isToday ? ' cal-today' : ''}"
      data-date="${dateStr}" role="button" tabindex="${hasWear ? 0 : -1}">
      <span class="cal-day-num">${day}</span>
      ${hasWear ? `<span class="cal-dot"></span>` : ''}
    </div>`;
  }

  document.getElementById('wear-calendar').innerHTML = `
    <div class="cal-header">
      <button class="cal-nav" id="cal-prev">‹</button>
      <span class="cal-month-label">${esc(monthLabel)}</span>
      <button class="cal-nav" id="cal-next">›</button>
    </div>
    <div class="cal-grid">
      ${DAYS.map(d => `<div class="cal-weekday">${d}</div>`).join('')}
      ${cells}
    </div>`;

  document.getElementById('cal-prev').addEventListener('click', () => {
    if (_calMonth === 0) { _calMonth = 11; _calYear--; } else _calMonth--;
    renderCalendar();
    document.getElementById('calendar-day-detail').classList.add('hidden');
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    if (_calMonth === 11) { _calMonth = 0; _calYear++; } else _calMonth++;
    renderCalendar();
    document.getElementById('calendar-day-detail').classList.add('hidden');
  });

  document.querySelectorAll('.cal-cell.cal-has-wear').forEach(cell => {
    cell.addEventListener('click', () => showCalendarDay(cell.dataset.date));
  });
}

function showCalendarDay(dateStr) {
  // Highlight selected
  document.querySelectorAll('.cal-cell').forEach(c => c.classList.toggle('cal-selected', c.dataset.date === dateStr));

  const items = _calWearLog[dateStr] || [];
  const d = new Date(dateStr + 'T12:00:00');
  const label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  // Capture item IDs in the closure so the async handler always uses this day's IDs
  const wornIds = items.map(it => it.id);

  const el = document.getElementById('calendar-day-detail');
  el.innerHTML = `
    <div class="cal-detail-date">${esc(label)}</div>
    <div class="wear-log-items">
      ${items.map(it => `
        <div class="wear-log-item">
          ${it.imageUrl
            ? `<img src="${esc(it.imageUrl)}" class="wear-log-thumb" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
            : ''}
          <div class="wear-log-icon" style="${it.imageUrl ? 'display:none' : ''}">${catIcon(it.category)}</div>
          <span class="wear-log-name">${esc(it.name)}</span>
        </div>`).join('')}
    </div>
    ${wornIds.length ? `<button class="btn-wear-again" data-date="${esc(dateStr)}">&#8635; Wear Again</button>` : ''}`;
  el.classList.remove('hidden');

  // Wire up Wear Again — logs all items from that day as worn today, then refreshes stats
  const wearAgainBtn = el.querySelector('.btn-wear-again');
  if (wearAgainBtn) {
    wearAgainBtn.addEventListener('click', async () => {
      wearAgainBtn.disabled = true;
      wearAgainBtn.textContent = '…';
      let count = 0;
      for (const id of wornIds) {
        try {
          await apiFetch(`/items/${id}/wear`, { method: 'POST' });
          count++;
        } catch {}
      }
      showToast(`Logged ${count} item${count !== 1 ? 's' : ''} as worn!`);
      loadStats();
    });
  }
}

// ── Suggest Outfit Modal ──────────────────────────────────────────────────────

function setupSuggestModal() {
  document.getElementById('btn-new-suggest').addEventListener('click', openSuggestModal);
  document.getElementById('btn-cancel-suggest').addEventListener('click', closeSuggestModal);
  document.getElementById('btn-cancel-suggest2').addEventListener('click', closeSuggestModal);
  document.getElementById('btn-try-again').addEventListener('click', () => {
    document.getElementById('suggest-result').classList.add('hidden');
    document.getElementById('suggest-occasions').classList.remove('hidden');
    document.getElementById('btn-cancel-suggest').closest('.modal-actions').classList.remove('hidden');
  });
  document.getElementById('btn-save-suggestion').addEventListener('click', saveSuggestion);
  document.getElementById('suggest-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeSuggestModal();
  });
  document.querySelectorAll('.occasion-btn').forEach(btn => {
    btn.addEventListener('click', () => requestSuggestion(btn.dataset.occasion));
  });
}

function openSuggestModal() {
  suggestResult = null;
  document.getElementById('suggest-occasions').classList.remove('hidden');
  document.getElementById('suggest-loading').classList.add('hidden');
  document.getElementById('suggest-result').classList.add('hidden');
  document.getElementById('suggest-modal').classList.remove('hidden');
}

function closeSuggestModal() {
  document.getElementById('suggest-modal').classList.add('hidden');
}

async function requestSuggestion(occasion) {
  suggestOccasion = occasion;
  document.getElementById('suggest-occasions').classList.add('hidden');
  document.getElementById('suggest-loading').classList.remove('hidden');
  document.getElementById('suggest-result').classList.add('hidden');
  document.getElementById('suggest-save-error').classList.add('hidden');

  try {
    const data = await apiFetch('/outfits/suggest', { method: 'POST', body: JSON.stringify({ occasion }) });
    suggestResult = data;

    document.getElementById('suggest-outfit-name').textContent = data.name;
    document.getElementById('suggest-reasoning').textContent = data.reasoning || '';

    const allItems = await apiFetch('/items');
    const picked = (data.itemIds || []).map(id => allItems.find(i => i.id === id)).filter(Boolean);

    document.getElementById('suggest-items-list').innerHTML = picked.map(i => `
      <div class="suggest-item-row">
        ${i.imageUrl
          ? `<img class="suggest-item-thumb" src="${esc(i.imageUrl)}" alt="${esc(i.name)}">`
          : `<div class="suggest-item-thumb suggest-item-thumb-icon" style="background:${catColor(i.category)}18">${catIcon(i.category)}</div>`
        }
        <span class="suggest-item-name">${esc(i.name)}</span>
        <span class="item-cat-badge" style="background:${catColor(i.category)}22;color:${catColor(i.category)}">${i.category}</span>
      </div>`).join('');

    document.getElementById('suggest-loading').classList.add('hidden');
    document.getElementById('suggest-result').classList.remove('hidden');
  } catch {
    document.getElementById('suggest-loading').classList.add('hidden');
    document.getElementById('suggest-occasions').classList.remove('hidden');
    showToast('Suggestion failed — try again', true);
  }
}

async function saveSuggestion() {
  if (!suggestResult) return;
  const errEl = document.getElementById('suggest-save-error');
  errEl.classList.add('hidden');
  try {
    await apiFetch('/outfits', {
      method: 'POST',
      body: JSON.stringify({ name: suggestResult.name, itemIds: suggestResult.itemIds })
    });
    closeSuggestModal();
    showToast('Outfit saved!');
    loadOutfits();
  } catch (e) {
    errEl.textContent = e.message || 'Failed to save';
    errEl.classList.remove('hidden');
  }
}

// ── API helper ────────────────────────────────────────────────────────────────

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ── Toast ─────────────────────────────────────────────────────────────────────

let toastTimer;
function showToast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.borderColor = isError ? '#f87171' : '';
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
}

// ── Escape HTML ───────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
