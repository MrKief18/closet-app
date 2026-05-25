const express = require('express');
const path = require('path');
const { readJSON, writeJSON } = require('../services/db');
const { suggestOutfit, verdictOutfit } = require('../services/ai');

const router = express.Router();
const OUTFITS_PATH = path.join(__dirname, '../data/outfits.json');
const CLOSET_PATH = path.join(__dirname, '../data/closet.json');

function readOutfits() { return readJSON(OUTFITS_PATH); }
function writeOutfits(outfits) { writeJSON(OUTFITS_PATH, outfits); }
function readItems() { return readJSON(CLOSET_PATH); }

// Resolve item IDs to full item objects; flag any missing IDs
function populateItems(itemIds) {
  const allItems = readItems();
  return itemIds.map(id => allItems.find(i => i.id === id) || { id, error: 'item not found' });
}

// GET /outfits — list all outfits with populated items and average rating
router.get('/', (req, res) => {
  const outfits = readOutfits();
  const populated = outfits.map(o => {
    // Compute average rating across all stored ratings for this outfit
    const avgRating = o.ratings?.length
      ? Math.round((o.ratings.reduce((s, r) => s + r.rating, 0) / o.ratings.length) * 10) / 10
      : null;
    return { ...o, items: populateItems(o.itemIds), avgRating };
  });
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
    ratings: [],           // stores { rating, date } objects added via POST /:id/rate
    createdAt: new Date().toISOString()
  };
  outfits.push(newOutfit);
  writeOutfits(outfits);
  res.status(201).json({ ...newOutfit, items: populateItems(itemIds) });
});

// POST /outfits/suggest — Claude picks an outfit based on occasion
router.post('/suggest', async (req, res) => {
  const { occasion } = req.body;
  if (!occasion) return res.status(400).json({ error: 'occasion is required' });
  const items = readItems();
  if (items.length < 2) return res.status(400).json({ error: 'Add more items to your closet first' });
  try {
    const suggestion = await suggestOutfit(items, occasion);
    const allIds = new Set(items.map(i => i.id));
    suggestion.itemIds = (suggestion.itemIds || []).filter(id => allIds.has(id));
    res.json(suggestion);
  } catch (err) {
    res.status(500).json({ error: 'Suggestion failed', detail: err.message });
  }
});

// POST /outfits/verdict — Claude judges whether the selected items make a good outfit
// Body: { itemIds: ["id1", "id2", ...] }
router.post('/verdict', async (req, res) => {
  const { itemIds } = req.body;
  if (!Array.isArray(itemIds) || itemIds.length < 2) {
    return res.status(400).json({ error: 'Send at least 2 itemIds' });
  }
  const allItems = readItems();
  const items = itemIds.map(id => allItems.find(i => i.id === id)).filter(Boolean);
  if (items.length < 2) return res.status(400).json({ error: 'Items not found' });
  try {
    const result = await verdictOutfit(items);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Verdict failed', detail: err.message });
  }
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

// POST /outfits/:id/wear — log every item in the outfit as worn today
router.post('/:id/wear', (req, res) => {
  const outfits = readOutfits();
  const outfitIdx = outfits.findIndex(o => o.id === req.params.id);
  if (outfitIdx === -1) return res.status(404).json({ error: 'Outfit not found' });
  const outfit = outfits[outfitIdx];

  const items = readItems();
  const now = new Date();
  const localDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const weather = req.body?.weather || null;

  let wornCount = 0;
  for (const id of outfit.itemIds) {
    const idx = items.findIndex(i => i.id === id);
    if (idx === -1) continue;
    items[idx].wearCount = (items[idx].wearCount || 0) + 1;
    items[idx].lastWorn = now.toISOString();
    if (!Array.isArray(items[idx].wearHistory)) items[idx].wearHistory = [];
    items[idx].wearHistory.push({ date: localDate, weather });
    if (items[idx].category !== 'shoes') items[idx].isDirty = true;
    wornCount++;
  }
  writeJSON(CLOSET_PATH, items);

  // Record the outfit wear event with full timestamp for calendar display
  if (!Array.isArray(outfit.wearEvents)) outfit.wearEvents = [];
  outfit.wearEvents.push({ timestamp: now.toISOString(), date: localDate, itemIds: [...outfit.itemIds], weather });
  writeOutfits(outfits);

  res.json({ wornCount });
});

// POST /outfits/:id/rate — append a 1-5 star rating for this outfit
router.post('/:id/rate', (req, res) => {
  const { rating } = req.body; // expected 1-5
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'rating must be 1-5' });
  }
  const outfits = readOutfits();
  const idx = outfits.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Outfit not found' });
  if (!Array.isArray(outfits[idx].ratings)) outfits[idx].ratings = [];
  outfits[idx].ratings.push({
    rating: parseInt(rating),
    date: new Date().toISOString().slice(0, 10)
  });
  writeOutfits(outfits);
  res.json(outfits[idx]);
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
