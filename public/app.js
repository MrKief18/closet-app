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
let selectedOutfitItems = new Set();
let selectedPhotoFile = null;
let identifiedImageUrl = null;

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  setupNav();
  setupFilters();
  setupAddItem();
  setupOutfitBuilder();
  loadCloset();
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
  if (view === 'closet') loadCloset(currentFilter);
  if (view === 'outfits') loadOutfits();
}

// ── Closet ────────────────────────────────────────────────────────────────────

function setupFilters() {
  document.querySelectorAll('.filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.cat;
      loadCloset(currentFilter);
    });
  });
}

async function loadCloset(category = '') {
  const url = category ? `/items?category=${encodeURIComponent(category)}` : '/items';
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
    return `
      <div class="item-card" data-id="${item.id}" data-category="${item.category}">
        ${thumb}
        <div class="item-info">
          <div class="item-name">${esc(item.name)}</div>
          <div class="item-meta">${esc(meta)}</div>
          <span class="item-cat-badge" style="background:${color}22;color:${color}">${item.category}</span>
        </div>
        ${selectable ? '' : `<button class="btn-delete" data-id="${item.id}" title="Remove">×</button>`}
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
  }
}

async function deleteItem(id) {
  try {
    await apiFetch(`/items/${id}`, { method: 'DELETE' });
    showToast('Item removed');
    loadCloset(currentFilter);
  } catch (e) {
    showToast('Failed to remove item', true);
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
  });
  document.getElementById('btn-show-search').addEventListener('click', () => {
    showPanel('panel-search');
    resetIdentifiedForm();
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

  const body = {
    name,
    category: document.getElementById('f-category').value,
    color,
    size: document.getElementById('f-size').value.trim() || null,
    brand: document.getElementById('f-brand').value.trim() || null,
    imageUrl: identifiedImageUrl || null
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
