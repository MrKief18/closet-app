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
  loadCloset();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
});

// ── Navigation ────────────────────────────────────────────────────────────────

function setupNav() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });
}

function switchView(view) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
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
    showBanner(`✨ AI Search: "${query}" — ${data.items.length} result${data.items.length !== 1 ? 's' : ''}`);
    renderItemGrid('items-grid', data.items, false);
  } catch {
    showToast('AI search failed — try again', true);
  } finally {
    aiBtn.textContent = '✨';
    aiBtn.disabled = false;
  }
}

function showBanner(text) {
  const el = document.getElementById('ai-search-banner');
  el.textContent = text;
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
      { name: 'name',     weight: 0.45 },
      { name: 'brand',    weight: 0.25 },
      { name: 'color',    weight: 0.15 },
      { name: 'category', weight: 0.08 },
      { name: 'tags',     weight: 0.07 }
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
  const params = [];
  if (currentFilter) params.push(`category=${encodeURIComponent(currentFilter)}`);
  if (currentTagFilter) params.push(`tag=${encodeURIComponent(currentTagFilter)}`);
  const url = '/items' + (params.length ? '?' + params.join('&') : '');
  try {
    let items = await apiFetch(url);
    items = applySearch(applySort(items));
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

    if (item.imageUrl) {
      return `
        <div class="item-card has-image" data-id="${item.id}" data-category="${item.category}">
          <img class="item-img" src="${esc(item.imageUrl)}" alt="${esc(item.name)}">
          <div class="item-overlay">
            <div class="item-name">${esc(item.name)}</div>
            <div class="item-meta">${esc(meta)}</div>
            <span class="item-cat-badge" style="background:${color}33;color:${color}">${item.category}</span>
            ${tags ? `<div class="item-tags">${tags}</div>` : ''}
            ${wearInfo}
          </div>
          ${actionBtns}
        </div>`;
    } else {
      return `
        <div class="item-card" data-id="${item.id}" data-category="${item.category}">
          <div class="item-icon" style="background:${color}18">${catIcon(item.category)}</div>
          <div class="item-info">
            <div class="item-name">${esc(item.name)}</div>
            <div class="item-meta">${esc(meta)}</div>
            <span class="item-cat-badge" style="background:${color}18;color:${color}">${item.category}</span>
            ${tags ? `<div class="item-tags">${tags}</div>` : ''}
            ${wearInfo}
            ${selectable ? '' : `<button class="btn-find-img" data-id="${item.id}">🔍 Find Image</button>`}
          </div>
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
    closeItemDetail();
    wearItem(detailItemId);
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
    tags,
    imageUrl: selectedImageUrl || null
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

    document.getElementById('detail-name').textContent = item.name;
    const badge = document.getElementById('detail-cat-badge');
    badge.textContent = item.category;
    badge.style.background = color + '22';
    badge.style.color = color;

    document.getElementById('detail-color').textContent = item.color || '—';
    document.getElementById('detail-size').textContent = item.size || '—';
    document.getElementById('detail-brand').textContent = item.brand || '—';

    const wearText = item.wearCount
      ? `${item.wearCount}× ${item.lastWorn ? '· ' + new Date(item.lastWorn).toLocaleDateString() : ''}`
      : 'Never worn';
    document.getElementById('detail-wear').textContent = wearText;

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
      list.innerHTML = '<p class="empty-state"><span class="empty-state-icon">👔</span>No outfits saved yet — build one!</p>';
      return;
    }
    list.innerHTML = outfits.map(o => {
      const strip = (o.items || []).slice(0, 4).map(i =>
        i.imageUrl
          ? `<img class="outfit-strip-img" src="${esc(i.imageUrl)}" alt="${esc(i.name || '')}">`
          : `<div class="outfit-strip-icon" style="background:${catColor(i.category)}18">${catIcon(i.category)}</div>`
      ).join('');

      return `
        <div class="outfit-card" data-id="${o.id}">
          <div class="outfit-image-strip">${strip || '<div class="outfit-strip-icon" style="background:var(--surface2);flex:1">👔</div>'}</div>
          <div class="outfit-card-body">
            <span class="outfit-name">${esc(o.name)}</span>
            <span class="outfit-item-count">${(o.items || []).length} items</span>
            <button class="btn-delete-outfit" data-id="${o.id}" title="Delete">×</button>
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.outfit-card').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('.btn-delete-outfit')) return;
        openOutfitDetail(card.dataset.id);
      });
    });
    list.querySelectorAll('.btn-delete-outfit').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); deleteOutfit(btn.dataset.id); });
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
  document.getElementById('btn-outfit-detail-delete').addEventListener('click', () => {
    close();
    deleteOutfit(detailOutfitId);
  });
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
  const loadingEl = document.getElementById('search-loading');
  const errEl = document.getElementById('search-error');
  const searchBtn = document.getElementById('btn-do-search');
  errEl.classList.add('hidden');
  loadingEl.classList.remove('hidden');
  searchBtn.disabled = true;

  try {
    const data = await apiFetch(`/items/search?q=${encodeURIComponent(q)}`);
    identifiedImageUrl = data.imageUrl || null;
    populateIdentifiedForm(data.details);
  } catch (e) {
    errEl.textContent = e.message || 'Search failed.';
    errEl.classList.remove('hidden');
  } finally {
    loadingEl.classList.add('hidden');
    searchBtn.disabled = false;
  }
}

function populateIdentifiedForm(details) {
  document.getElementById('f-name').value = details.name || '';
  document.getElementById('f-color').value = details.color || '';
  document.getElementById('f-size').value = details.size || '';
  document.getElementById('f-brand').value = details.brand || '';
  const catSelect = document.getElementById('f-category');
  if (details.category) {
    [...catSelect.options].forEach(o => { o.selected = o.value === details.category; });
  }
  document.getElementById('identified-form').classList.remove('hidden');
  document.getElementById('save-error').classList.add('hidden');
}

function resetIdentifiedForm() {
  ['f-name','f-color','f-size','f-brand'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('f-category').selectedIndex = 0;
  document.getElementById('identified-form').classList.add('hidden');
  document.getElementById('image-preview-wrap').classList.add('hidden');
  document.getElementById('btn-analyze').classList.add('hidden');
  document.getElementById('camera-input').value = '';
  document.getElementById('search-input').value = '';
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
    imageUrl: identifiedImageUrl || null,
    tags
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

function renderStats(d) {
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
    </div>`;
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
