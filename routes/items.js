const express = require('express');
const path = require('path');
const fs = require('fs');
const { searchItem, searchItemOnline, findProductImage, findProductImages, smartSearch } = require('../services/ai');
const { readJSON, writeJSON } = require('../services/db');

const router = express.Router();
const DB_PATH = path.join(__dirname, '../data/closet.json');

function readItems() { return readJSON(DB_PATH); }
function writeItems(items) { writeJSON(DB_PATH, items); }

// GET /items — list all clothing items; optional ?category=, ?tag=, ?includeArchived= filters
router.get('/', (req, res) => {
  let items = readItems();
  // By default, hide archived items; pass ?includeArchived=true to see them all
  if (req.query.includeArchived !== 'true') {
    items = items.filter(i => !i.isArchived);
  }
  if (req.query.category) {
    items = items.filter(i => i.category.toLowerCase() === req.query.category.toLowerCase());
  }
  if (req.query.tag) {
    items = items.filter(i => (i.tags || []).includes(req.query.tag.toLowerCase()));
  }
  res.json(items);
});

// GET /items/shopping?q= — Google Shopping results for an exact query string (color-specific re-fetch)
router.get('/shopping', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q is required' });
  const serpKey = process.env.SERPAPI_KEY;
  if (!serpKey) return res.json({ products: [] });
  try {
    const url = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(q)}&num=6&api_key=${serpKey}`;
    const r = await fetch(url);
    if (!r.ok) return res.json({ products: [] });
    const data = await r.json();
    const products = (data.shopping_results || []).slice(0, 6).map(p => ({
      title: p.title, price: p.price || null,
      source: p.source || null, thumbnail: p.thumbnail || null, link: p.link || null
    }));
    res.json({ products });
  } catch (err) {
    res.status(500).json({ error: 'Shopping search failed', detail: err.message });
  }
});

// GET /items/search?q= — identify product from description + return Google Shopping results
router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query parameter q is required' });
  try {
    const { details, variants, products } = await searchItemOnline(q);

    // Best image: first variant's image → first shopping thumbnail → image search fallback
    const imageUrl = variants[0]?.imageUrl || products[0]?.thumbnail || await findProductImage(details);

    if (req.query.save === 'true') {
      const items = readItems();
      const newItem = {
        id: Date.now().toString(),
        ...details,
        imageUrl: imageUrl || null,
        tags: [], wearCount: 0, lastWorn: null,
        addedAt: new Date().toISOString()
      };
      items.push(newItem);
      writeItems(items);
      return res.status(201).json({ query: q, details, variants, imageUrl, products, saved: newItem });
    }

    res.json({ query: q, details, variants, imageUrl, products });
  } catch (err) {
    res.status(500).json({ error: 'Search failed', detail: err.message });
  }
});

// POST /items/smart-search — Claude-powered natural language search
router.post('/smart-search', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query is required' });
  try {
    const items = readItems();
    const result = await smartSearch(query, items.length ? items : []);
    const matched = (result.ids || []).map(id => items.find(i => i.id === id)).filter(Boolean);
    res.json({ items: matched, identified: result.identified || null });
  } catch (err) {
    res.status(500).json({ error: 'Smart search failed', detail: err.message });
  }
});

// POST /items/clean-all — mark every item as clean (isDirty = false)
router.post('/clean-all', (req, res) => {
  const items = readItems();
  let count = 0;
  items.forEach(i => { if (i.isDirty) { i.isDirty = false; count++; } });
  writeItems(items);
  res.json({ cleaned: count });
});

// GET /items/:id — get a single item by id
router.get('/:id', (req, res) => {
  const items = readItems();
  const item = items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(item);
});

// POST /items — add a new clothing item
// Body: { name, category, color, size, brand?, material?, purchasePrice? }
router.post('/', (req, res) => {
  const { name, category, color, size, brand, material, imageUrl, tags, purchasePrice } = req.body;
  if (!name || !category || !color) {
    return res.status(400).json({ error: 'name, category, and color are required' });
  }
  const items = readItems();
  const newItem = {
    id: Date.now().toString(),
    name,
    category,
    color,
    size: size || null,
    brand: brand || null,
    material: material || null,
    imageUrl: imageUrl || null,
    tags: Array.isArray(tags) ? tags : [],
    wearCount: 0,
    lastWorn: null,
    purchasePrice: purchasePrice || null, // Feature 2: cost-per-wear tracking
    isDirty: false,                        // Feature 1: dirty/clean state
    isArchived: false,                     // Feature 3: archive/seasonal storage
    addedAt: new Date().toISOString()
  };
  items.push(newItem);
  writeItems(items);
  res.status(201).json(newItem);
});

// PATCH /items/:id — update an existing item
router.patch('/:id', (req, res) => {
  const items = readItems();
  const idx = items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Item not found' });
  // purchasePrice added for Feature 2 (cost-per-wear)
  const allowed = ['name', 'category', 'color', 'size', 'brand', 'material', 'imageUrl', 'tags', 'purchasePrice'];
  allowed.forEach(field => {
    if (req.body[field] !== undefined) items[idx][field] = req.body[field];
  });
  writeItems(items);
  res.json(items[idx]);
});

// POST /items/:id/wear — log the item as worn today
router.post('/:id/wear', (req, res) => {
  const items = readItems();
  const idx = items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Item not found' });
  const now = new Date();
  items[idx].wearCount = (items[idx].wearCount || 0) + 1;
  items[idx].lastWorn = now.toISOString();
  if (!Array.isArray(items[idx].wearHistory)) items[idx].wearHistory = [];
  const localDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const weather = req.body?.weather || null;
  items[idx].wearHistory.push({ date: localDate, weather });
  items[idx].isDirty = true;
  writeItems(items);
  res.json(items[idx]);
});

// POST /items/:id/dirty — mark item as dirty (needs washing)
router.post('/:id/dirty', (req, res) => {
  const items = readItems();
  const idx = items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Item not found' });
  items[idx].isDirty = true;
  writeItems(items);
  res.json(items[idx]);
});

// POST /items/:id/clean — mark item as clean (freshly washed)
router.post('/:id/clean', (req, res) => {
  const items = readItems();
  const idx = items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Item not found' });
  items[idx].isDirty = false;
  writeItems(items);
  res.json(items[idx]);
});

// POST /items/:id/archive — move item to seasonal storage
router.post('/:id/archive', (req, res) => {
  const items = readItems();
  const idx = items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Item not found' });
  items[idx].isArchived = true;
  writeItems(items);
  res.json(items[idx]);
});

// POST /items/:id/unarchive — bring item back from storage
router.post('/:id/unarchive', (req, res) => {
  const items = readItems();
  const idx = items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Item not found' });
  items[idx].isArchived = false;
  writeItems(items);
  res.json(items[idx]);
});

// GET /items/:id/images — return 6 image options; ?page=N fetches the next set
router.get('/:id/images', async (req, res) => {
  const items = readItems();
  const item = items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const page = Math.max(0, parseInt(req.query.page) || 0);
  try {
    const images = await findProductImages(item, 6, page * 6);
    res.json({ images });
  } catch (err) {
    res.status(500).json({ error: 'Image search failed', detail: err.message });
  }
});

// POST /items/:id/image — fetch and attach a product image for an existing item
router.post('/:id/image', async (req, res) => {
  const items = readItems();
  const idx = items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Item not found' });
  try {
    const imageUrl = await findProductImage(items[idx]);
    if (!imageUrl) return res.status(404).json({ error: 'No image found for this item' });
    items[idx].imageUrl = imageUrl;
    writeItems(items);
    res.json(items[idx]);
  } catch (err) {
    res.status(500).json({ error: 'Image search failed', detail: err.message });
  }
});

// POST /items/:id/removebg — call remove.bg API to strip the background from an item's product image.
// Result is saved as a PNG file in public/bg-removed/ and the URL is cached on the item.
// Subsequent calls return the cached URL instantly (no re-processing).
router.post('/:id/removebg', async (req, res) => {
  const items = readItems();
  const idx = items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Item not found' });
  const item = items[idx];

  if (!item.imageUrl) return res.status(400).json({ error: 'Item has no image' });
  if (item.bgRemovedUrl) return res.json({ bgRemovedUrl: item.bgRemovedUrl }); // already done

  const apiKey = process.env.REMOVE_BG_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'REMOVE_BG_API_KEY not configured' });

  try {
    const r = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `image_url=${encodeURIComponent(item.imageUrl)}&size=auto`
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return res.status(r.status).json({ error: 'remove.bg error', detail: err });
    }

    const buf = Buffer.from(await r.arrayBuffer());
    const dir = path.join(__dirname, '../public/bg-removed');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${item.id}.png`), buf);

    const bgRemovedUrl = `/bg-removed/${item.id}.png`;
    items[idx].bgRemovedUrl = bgRemovedUrl;
    writeItems(items);
    res.json({ bgRemovedUrl });
  } catch (err) {
    res.status(500).json({ error: 'Background removal failed', detail: err.message });
  }
});

// DELETE /items/:id — remove an item from the closet
router.delete('/:id', (req, res) => {
  const items = readItems();
  const idx = items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Item not found' });
  const [removed] = items.splice(idx, 1);
  writeItems(items);
  res.json({ message: 'Item removed', item: removed });
});

module.exports = router;
