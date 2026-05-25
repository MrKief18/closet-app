const express = require('express');
const fs = require('fs');
const path = require('path');
const { searchItem } = require('../services/ai');

const router = express.Router();
const DB_PATH = path.join(__dirname, '../data/closet.json');

// Helper: read items from JSON file
function readItems() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

// Helper: write items to JSON file
function writeItems(items) {
  fs.writeFileSync(DB_PATH, JSON.stringify(items, null, 2));
}

// GET /items — list all clothing items, optional ?category= filter
router.get('/', (req, res) => {
  let items = readItems();
  if (req.query.category) {
    items = items.filter(i => i.category.toLowerCase() === req.query.category.toLowerCase());
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

    if (req.query.save === 'true') {
      const items = readItems();
      const newItem = {
        id: Date.now().toString(),
        ...details,
        addedAt: new Date().toISOString()
      };
      items.push(newItem);
      writeItems(items);
      return res.status(201).json({ query: q, details, saved: newItem });
    }

    res.json({ query: q, details });
  } catch (err) {
    res.status(500).json({ error: 'Search failed', detail: err.message });
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
  const { name, category, color, size, brand, imageUrl } = req.body;
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
  const allowed = ['name', 'category', 'color', 'size', 'brand', 'imageUrl'];
  allowed.forEach(field => {
    if (req.body[field] !== undefined) items[idx][field] = req.body[field];
  });
  writeItems(items);
  res.json(items[idx]);
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
