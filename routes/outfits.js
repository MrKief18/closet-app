const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const OUTFITS_PATH = path.join(__dirname, '../data/outfits.json');
const CLOSET_PATH = path.join(__dirname, '../data/closet.json');

function readOutfits() {
  return JSON.parse(fs.readFileSync(OUTFITS_PATH, 'utf8'));
}

function writeOutfits(outfits) {
  fs.writeFileSync(OUTFITS_PATH, JSON.stringify(outfits, null, 2));
}

function readItems() {
  return JSON.parse(fs.readFileSync(CLOSET_PATH, 'utf8'));
}

// Resolve item IDs to full item objects; flag any missing IDs
function populateItems(itemIds) {
  const allItems = readItems();
  return itemIds.map(id => allItems.find(i => i.id === id) || { id, error: 'item not found' });
}

// GET /outfits — list all outfits with populated items
router.get('/', (req, res) => {
  const outfits = readOutfits();
  const populated = outfits.map(o => ({ ...o, items: populateItems(o.itemIds) }));
  res.json(populated);
});

// GET /outfits/:id — get a single outfit with populated items
router.get('/:id', (req, res) => {
  const outfits = readOutfits();
  const outfit = outfits.find(o => o.id === req.params.id);
  if (!outfit) return res.status(404).json({ error: 'Outfit not found' });
  res.json({ ...outfit, items: populateItems(outfit.itemIds) });
});

// POST /outfits — create a new outfit
// Body: { name, itemIds: ["id1", "id2", ...] }
router.post('/', (req, res) => {
  const { name, itemIds } = req.body;
  if (!name || !Array.isArray(itemIds) || itemIds.length === 0) {
    return res.status(400).json({ error: 'name and a non-empty itemIds array are required' });
  }

  // Validate that every referenced item exists in the closet
  const allItems = readItems();
  const missing = itemIds.filter(id => !allItems.find(i => i.id === id));
  if (missing.length > 0) {
    return res.status(400).json({ error: 'Some item IDs were not found in the closet', missing });
  }

  const outfits = readOutfits();
  const newOutfit = {
    id: Date.now().toString(),
    name,
    itemIds,
    createdAt: new Date().toISOString()
  };
  outfits.push(newOutfit);
  writeOutfits(outfits);
  res.status(201).json({ ...newOutfit, items: populateItems(itemIds) });
});

// PATCH /outfits/:id — rename an outfit or swap its item list
router.patch('/:id', (req, res) => {
  const outfits = readOutfits();
  const idx = outfits.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Outfit not found' });

  if (req.body.name !== undefined) outfits[idx].name = req.body.name;

  if (req.body.itemIds !== undefined) {
    if (!Array.isArray(req.body.itemIds) || req.body.itemIds.length === 0) {
      return res.status(400).json({ error: 'itemIds must be a non-empty array' });
    }
    const allItems = readItems();
    const missing = req.body.itemIds.filter(id => !allItems.find(i => i.id === id));
    if (missing.length > 0) {
      return res.status(400).json({ error: 'Some item IDs were not found in the closet', missing });
    }
    outfits[idx].itemIds = req.body.itemIds;
  }

  writeOutfits(outfits);
  res.json({ ...outfits[idx], items: populateItems(outfits[idx].itemIds) });
});

// DELETE /outfits/:id — remove a saved outfit
router.delete('/:id', (req, res) => {
  const outfits = readOutfits();
  const idx = outfits.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Outfit not found' });
  const [removed] = outfits.splice(idx, 1);
  writeOutfits(outfits);
  res.json({ message: 'Outfit deleted', outfit: removed });
});

module.exports = router;
