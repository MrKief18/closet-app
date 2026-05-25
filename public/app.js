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

// ── State ────────────────────────────────────────────────────────────────────

let currentFilter = '';
let currentTagFilter = '';
let selectedOutfitItems = new Set();
let selectedPhotoFile = null;
let identifiedImageUrl = null;
let suggestOccasion = '';
let suggestResult = null;

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  setupNav();
  setupFilters();
  setupAddItem();
  setupOutfitBuilder();
  setupSuggestModal();
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
  const params = [];
  if (currentFilter) params.push(`category=${encodeURIComponent(currentFilter)}`);
  if (currentTagFilter) params.push(`tag=${encodeURIComponent(currentTagFilter)}`);
  const url = '/items' + (params.length ? '?' + params.join('&') : '');
  try {
    const items = await apiFetch(url);
    renderItemGrid('items-grid', items, false);
  } catch {
    document.getElementById('items-grid').innerHTML = '<p class="empty-state">Failed to load closet.</p>';
  }
}

function renderItemGrid(containerId, items, selectable) {
  const grid = document.getElementById(containerId);
  if (!items.length) {
    grid.innerHTML = `<p class="empty-state">${selectable ? 'No items in closet.' : 'Your closet is empty — add some clothes!'}</p>`;
    return;
  }
  grid.innerHTML = items.map(item => {
    const color = catColor(item.category);
    const meta = [item.color, item.size, item.brand].filter(Boolean).join(' · ');
    const thumb = item.imageUrl
      ? `<img class="item-img" src="${esc(item.imageUrl)}" alt="${esc(item.name)}">`
      : `<div class="item-icon" style="background:${color}22">${catIcon(item.category)}</div>`;
    const tags = (item.tags || []).map(t => `<span class="tag-chip">${esc(t)}</span>`).join('');
    const wearInfo = item.wearCount ? `<div class="item-wear">worn ${item.wearCount}×</div>` : '';
    return `
      <div class="item-card" data-id="${item.id}" data-category="${item.category}">
        ${thumb}
        <div class="item-info">
          <div class="item-name">${esc(item.name)}</div>
          <div class="item-meta">${esc(meta)}</div>
          <span class="item-cat-badge" style="background:${color}22;color:${color}">${item.category}</span>
          ${tags ? `<div class="item-tags">${tags}</div>` : ''}
          ${wearInfo}
        </div>
        ${selectable ? '' : `
          <button class="btn-wear" data-id="${item.id}" title="Log as worn today">✓</button>
          <button class="btn-delete" data-id="${item.id}" title="Remove">×</button>
        `}
      </div>`;
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
  }
}

async function deleteItem(id) {
  try {
    await apiFetch(`/items/${id}`, { method: 'DELETE' });
    showToast('Item removed');
    loadCloset();
  } catch (e) {
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

// ── Outfits ───────────────────────────────────────────────────────────────────

async function loadOutfits() {
  try {
    const outfits = await apiFetch('/outfits');
    const list = document.getElementById('outfits-list');
    if (!outfits.length) {
      list.innerHTML = '<p class="empty-state">No outfits saved yet — build one!</p>';
      return;
    }
    list.innerHTML = outfits.map(o => `
      <div class="outfit-card" data-id="${o.id}">
        <div>
          <div class="outfit-name">${esc(o.name)}</div>
          <div class="outfit-items">
            ${(o.items || []).map(i => `<span class="outfit-chip">${esc(i.name || '?')}</span>`).join('')}
          </div>
        </div>
        <button class="btn-delete-outfit" data-id="${o.id}" title="Delete">×</button>
      </div>`).join('');

    list.querySelectorAll('.btn-delete-outfit').forEach(btn => {
      btn.addEventListener('click', () => deleteOutfit(btn.dataset.id));
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
    const grid = document.getElementById('modal-items-grid');
    grid.innerHTML = '';
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
  // Panel toggles
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

  // Camera flow
  const cameraInput = document.getElementById('camera-input');
  document.getElementById('btn-choose-photo').addEventListener('click', () => cameraInput.click());
  cameraInput.addEventListener('change', onPhotoSelected);
  document.getElementById('btn-analyze').addEventListener('click', analyzePhoto);

  // Search flow
  document.getElementById('btn-do-search').addEventListener('click', doSearch);
  document.getElementById('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
  });

  // Form actions
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
    name,
    category: document.getElementById('f-category').value,
    color,
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

// ── Stats ─────────────────────────────────────────────────────────────────────

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
      <div class="stat-card"><div class="stat-num">${d.wornThisMonth}</div><div class="stat-label">Worn This Month</div></div>
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
        <span>${catIcon(i.category)}</span>
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
    await apiFetch('/outfits', { method: 'POST', body: JSON.stringify({ name: suggestResult.name, itemIds: suggestResult.itemIds }) });
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
