// ── Category helpers ──────────────────────────────────────────────────────────

const CAT_ICON = {
  tops: '👕', bottoms: '👖', shoes: '👟', outerwear: '🧥', accessories: '👒'
};
const CAT_COLOR = {
  tops: '#60a5fa', bottoms: '#818cf8', shoes: '#34d399',
  outerwear: '#fb923c', accessories: '#f472b6'
};

function catIcon(cat)  { return CAT_ICON[cat]  || '👗'; }
function catColor(cat) { return CAT_COLOR[cat] || '#6b7280'; }

// ── State ─────────────────────────────────────────────────────────────────────

let allItems          = [];
let currentFilter     = '';
let closetSearchQuery = '';
let selectedOutfitItems = new Set();
let selectedPhotoFile = null;
let currentDetailId   = null;

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  setupNav();
  setupFilters();
  setupClosetSearch();
  setupAddPanel();
  setupOutfitBuilder();
  setupItemDetailModal();
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
  if (view === 'closet') loadCloset();
  if (view === 'outfits') loadOutfits();
}

// ── Closet ────────────────────────────────────────────────────────────────────

function setupClosetSearch() {
  const input   = document.getElementById('closet-search');
  const clearBtn = document.getElementById('btn-clear-closet-search');

  input.addEventListener('input', () => {
    closetSearchQuery = input.value.toLowerCase();
    clearBtn.classList.toggle('hidden', !closetSearchQuery);
    filterAndRenderCloset();
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    closetSearchQuery = '';
    clearBtn.classList.add('hidden');
    filterAndRenderCloset();
    input.focus();
  });
}

function setupFilters() {
  document.querySelectorAll('.filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.cat;
      filterAndRenderCloset();
    });
  });
}

async function loadCloset() {
  renderSkeletons('items-grid', 6);
  try {
    allItems = await apiFetch('/items');
    filterAndRenderCloset();
  } catch {
    document.getElementById('items-grid').innerHTML =
      '<p class="empty-state">Failed to load closet.</p>';
  }
}

function filterAndRenderCloset() {
  let items = allItems;
  if (currentFilter) {
    items = items.filter(i => i.category === currentFilter);
  }
  if (closetSearchQuery) {
    items = items.filter(i =>
      i.name.toLowerCase().includes(closetSearchQuery) ||
      (i.color && i.color.toLowerCase().includes(closetSearchQuery)) ||
      (i.brand && i.brand.toLowerCase().includes(closetSearchQuery))
    );
  }
  renderItemGrid('items-grid', items, false);
}

// ── Item Grid ─────────────────────────────────────────────────────────────────

function renderSkeletons(containerId, count) {
  document.getElementById(containerId).innerHTML = Array.from({ length: count }, () => `
    <div class="item-card skeleton-card">
      <div class="skeleton sk-icon"></div>
      <div class="item-info">
        <div class="skeleton sk-line w70"></div>
        <div class="skeleton sk-line w45"></div>
        <div class="skeleton sk-badge"></div>
      </div>
    </div>`).join('');
}

function renderItemGrid(containerId, items, selectable) {
  const grid = document.getElementById(containerId);
  if (!items.length) {
    grid.innerHTML = `<p class="empty-state">${
      selectable ? 'No items in closet.' : 'Your closet is empty — add some clothes!'
    }</p>`;
    return;
  }
  grid.innerHTML = items.map(item => {
    const color = catColor(item.category);
    const meta  = [item.color, item.size, item.brand].filter(Boolean).join(' · ');
    return `
      <div class="item-card" data-id="${item.id}">
        <div class="item-icon" style="background:${color}22">${catIcon(item.category)}</div>
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
    grid.querySelectorAll('.item-card').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('.btn-delete')) return;
        const item = allItems.find(i => i.id === card.dataset.id);
        if (item) openItemDetail(item);
      });
    });
    grid.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        deleteItem(btn.dataset.id);
      });
    });
  }
}

async function deleteItem(id) {
  try {
    await apiFetch(`/items/${id}`, { method: 'DELETE' });
    showToast('Item removed');
    allItems = allItems.filter(i => i.id !== id);
    filterAndRenderCloset();
  } catch {
    showToast('Failed to remove item', true);
  }
}

// ── Item Detail Modal ─────────────────────────────────────────────────────────

function setupItemDetailModal() {
  document.getElementById('btn-close-detail').addEventListener('click', closeItemDetail);
  document.getElementById('btn-close-detail2').addEventListener('click', closeItemDetail);
  document.getElementById('btn-detail-delete').addEventListener('click', () => {
    if (currentDetailId) deleteItemFromDetail(currentDetailId);
  });
  document.getElementById('item-detail-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeItemDetail();
  });
}

function openItemDetail(item) {
  currentDetailId = item.id;
  const color = catColor(item.category);

  const iconEl = document.getElementById('detail-icon');
  iconEl.textContent = catIcon(item.category);
  iconEl.style.background = `${color}22`;

  document.getElementById('detail-name').textContent = item.name;

  const badge = document.getElementById('detail-badge');
  badge.textContent = item.category;
  badge.style.background = `${color}22`;
  badge.style.color = color;

  document.getElementById('detail-color').textContent = item.color || '—';
  document.getElementById('detail-size').textContent  = item.size  || '—';
  document.getElementById('detail-brand').textContent = item.brand || '—';
  document.getElementById('detail-added').textContent = item.addedAt
    ? new Date(item.addedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : '—';

  document.getElementById('item-detail-modal').classList.remove('hidden');
}

function closeItemDetail() {
  document.getElementById('item-detail-modal').classList.add('hidden');
  currentDetailId = null;
}

async function deleteItemFromDetail(id) {
  try {
    await apiFetch(`/items/${id}`, { method: 'DELETE' });
    closeItemDetail();
    showToast('Item removed');
    allItems = allItems.filter(i => i.id !== id);
    filterAndRenderCloset();
  } catch {
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
    document.getElementById('outfits-list').innerHTML =
      '<p class="empty-state">Failed to load outfits.</p>';
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
    renderItemGrid('modal-items-grid', items, true);
  } catch {
    document.getElementById('modal-items-grid').innerHTML =
      '<p class="empty-state">Could not load items.</p>';
  }
}

function closeOutfitModal() {
  document.getElementById('outfit-modal').classList.add('hidden');
}

async function saveOutfit() {
  const name   = document.getElementById('outfit-name-input').value.trim();
  const errEl  = document.getElementById('outfit-error');
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

// ── Add Item Panel ────────────────────────────────────────────────────────────

function setupAddPanel() {
  setupDropZone();

  document.getElementById('item-query').addEventListener('input', updateIdentifyBtn);
  document.getElementById('btn-identify').addEventListener('click', doIdentify);
  document.getElementById('item-query').addEventListener('keydown', e => {
    if (e.key === 'Enter') doIdentify();
  });

  document.getElementById('btn-save-item').addEventListener('click', saveIdentifiedItem);
  document.getElementById('btn-discard').addEventListener('click', () => {
    resetAddPanel();
    document.getElementById('identified-form').classList.add('hidden');
  });
}

// Drop zone setup
function setupDropZone() {
  const zone  = document.getElementById('drop-zone');
  const input = document.getElementById('photo-input');

  zone.addEventListener('click', e => {
    if (!e.target.closest('#btn-clear-photo')) input.click();
  });
  zone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over'); });
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) setPhoto(file);
  });

  input.addEventListener('change', () => {
    if (input.files[0]) setPhoto(input.files[0]);
  });

  document.getElementById('btn-clear-photo').addEventListener('click', e => {
    e.stopPropagation();
    clearPhoto();
  });
}

function setPhoto(file) {
  selectedPhotoFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('preview-img').src = e.target.result;
    document.getElementById('drop-default').classList.add('hidden');
    document.getElementById('drop-preview').classList.remove('hidden');
    updateIdentifyBtn();
  };
  reader.readAsDataURL(file);
}

function clearPhoto() {
  selectedPhotoFile = null;
  document.getElementById('preview-img').src = '';
  document.getElementById('drop-default').classList.remove('hidden');
  document.getElementById('drop-preview').classList.add('hidden');
  document.getElementById('photo-input').value = '';
  updateIdentifyBtn();
}

function updateIdentifyBtn() {
  const hasPhoto = !!selectedPhotoFile;
  const hasText  = !!document.getElementById('item-query').value.trim();
  document.getElementById('btn-identify').disabled = !hasPhoto && !hasText;
}

// Core identify action — photo + optional text, or text only
async function doIdentify() {
  const query     = document.getElementById('item-query').value.trim();
  const loadingEl = document.getElementById('identify-loading');
  const errEl     = document.getElementById('identify-error');
  const btn       = document.getElementById('btn-identify');

  if (!selectedPhotoFile && !query) return;

  errEl.classList.add('hidden');
  loadingEl.classList.remove('hidden');
  btn.disabled = true;

  try {
    let details;
    if (selectedPhotoFile) {
      const formData = new FormData();
      formData.append('image', selectedPhotoFile);
      if (query) formData.append('query', query);
      const res  = await fetch('/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analysis failed');
      details = data.identified;
    } else {
      const data = await apiFetch(`/items/search?q=${encodeURIComponent(query)}`);
      details = data.details;
    }
    populateIdentifiedForm(details);
  } catch (e) {
    errEl.textContent = e.message || 'Identification failed.';
    errEl.classList.remove('hidden');
  } finally {
    loadingEl.classList.add('hidden');
    updateIdentifyBtn();
  }
}

function populateIdentifiedForm(details) {
  document.getElementById('f-name').value  = details.name  || '';
  document.getElementById('f-color').value = details.color || '';
  document.getElementById('f-size').value  = details.size  || '';
  document.getElementById('f-brand').value = details.brand || '';
  const catSelect = document.getElementById('f-category');
  if (details.category) {
    [...catSelect.options].forEach(o => { o.selected = o.value === details.category; });
  }
  document.getElementById('identified-form').classList.remove('hidden');
  document.getElementById('save-error').classList.add('hidden');
  document.getElementById('identified-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function resetAddPanel() {
  ['f-name', 'f-color', 'f-size', 'f-brand'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('f-category').selectedIndex = 0;
  document.getElementById('item-query').value = '';
  document.getElementById('identify-error').classList.add('hidden');
  clearPhoto();
}

async function saveIdentifiedItem() {
  const name  = document.getElementById('f-name').value.trim();
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
    size:  document.getElementById('f-size').value.trim()  || null,
    brand: document.getElementById('f-brand').value.trim() || null
  };

  const saveBtn = document.getElementById('btn-save-item');
  try {
    saveBtn.disabled = true;
    await apiFetch('/items', { method: 'POST', body: JSON.stringify(body) });
    showToast('Item added to closet!');
    resetAddPanel();
    document.getElementById('identified-form').classList.add('hidden');
    switchView('closet');
  } catch (e) {
    errEl.textContent = e.message || 'Failed to save item.';
    errEl.classList.remove('hidden');
  } finally {
    saveBtn.disabled = false;
  }
}

// ── API helper ────────────────────────────────────────────────────────────────

async function apiFetch(url, options = {}) {
  const res  = await fetch(url, {
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
  el.style.borderColor = isError ? 'var(--red)' : '';
  el.style.color = isError ? 'var(--red)' : '';
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

// ── Escape HTML ───────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
