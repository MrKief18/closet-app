const express = require('express');
const path = require('path');
const { searchItem, findProductImage, findProductImages, smartSearch } = require('../services/ai');
const { readJSON, writeJSON } = require('../services/db');

const router = express.Router();
const DB_PATH = path.join(__dirname, '../data/closet.json');

function readItems() { return readJSON(DB_PATH); }
function writeItems(items) { writeJSON(DB_PATH, items); }

// GET /items — list all clothing items; optional ?category= and ?tag= filters
router.get('/', (req, res) => {
  let items = readItems();
  if (req.query.category) {
    items = items.filter(i => i.category.toLowerCase() === req.query.category.toLowerCase());
  }
  if (req.query.tag) {
    items = items.filter(i => (i.tags || []).includes(req.query.tag.toLowerCase()));
  }
  res.json(items);
});

// GET /items/search?q= — use Claude to look up clothing details from a text query
// Add ?save=true to auto-add the result to the closet
router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query parameter q is required' });
  try {
    const details = await searchItem(q);
    const imageUrl = await findProductImage(details);

    if (req.query.save === 'true') {
      const items = readItems();
      const newItem = {
        id: Date.now().toString(),
        ...details,
        imageUrl: imageUrl || null,
        addedAt: new Date().toISOString()
      };
      items.push(newItem);
      writeItems(items);
      return res.status(201).json({ query: q, details, imageUrl, saved: newItem });
    }

    res.json({ query: q, details, imageUrl });
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
    if (!items.length) return res.json({ items: [] });
    const result = await smartSearch(query, items);
    const matched = (result.ids || []).map(id => items.find(i => i.id === id)).filter(Boolean);
    res.json({ items: matched });
  } catch (err) {
    res.status(500).json({ error: 'Smart search failed', detail: err.message });
  }
});

// GET /items/:id — get a single item by id
router.get('/:id', (req, res) => {
  const items = readItems();
  const item = items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(item);
});

// POST /items — add a new clothing item
// Body: { name, category, color, size, brand? }
router.post('/', (req, res) => {
  const { name, category, color, size, brand, imageUrl, tags } = req.body;
  if (!name || !category || !color || !size) {
    return res.status(400).json({ error: 'name, category, color, and size are required' });
  }
  const items = readItems();
  const newItem = {
    id: Date.now().toString(),
    name,
    category,
    color,
    size,
    brand: brand || null,
    imageUrl: imageUrl || null,
    tags: Array.isArray(tags) ? tags : [],
    wearCount: 0,
    lastWorn: null,
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
  const allowed = ['name', 'category', 'color', 'size', 'brand', 'imageUrl', 'tags'];
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
  items[idx].wearCount = (items[idx].wearCount || 0) + 1;
  items[idx].lastWorn = new Date().toISOString();
  writeItems(items);
  res.json(items[idx]);
});

// GET /items/:id/images — return multiple image options for user selection
router.get('/:id/images', async (req, res) => {
  const items = readItems();
  const item = items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  try {
    const images = await findProductImages(item, 6);
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
