const express = require('express');
const path = require('path');
const { readJSON } = require('../services/db');
const { analyzeWardrobeGaps } = require('../services/ai');

const router = express.Router();
const CLOSET_PATH = path.join(__dirname, '../data/closet.json');
const OUTFITS_PATH = path.join(__dirname, '../data/outfits.json');

router.get('/', (req, res) => {
  const items = readJSON(CLOSET_PATH);
  const outfits = readJSON(OUTFITS_PATH);

  const byCategory = {};
  const byColor = {};
  let neverWorn = 0;
  let wornThisMonth = 0;
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  for (const item of items) {
    byCategory[item.category] = (byCategory[item.category] || 0) + 1;
    const color = (item.color || 'unknown').split(/\s+/)[0].toLowerCase();
    byColor[color] = (byColor[color] || 0) + 1;
    if (!item.lastWorn) neverWorn++;
    else if (new Date(item.lastWorn) >= cutoff) wornThisMonth++;
  }

  const mostWorn = [...items]
    .filter(i => (i.wearCount || 0) > 0)
    .sort((a, b) => (b.wearCount || 0) - (a.wearCount || 0))
    .slice(0, 5)
    .map(({ name, category, wearCount }) => ({ name, category, wearCount }));

  // Build wear log: group every wear entry by date, sorted newest-first
  const wearLogMap = {};
  for (const item of items) {
    for (const date of (item.wearHistory || [])) {
      if (!wearLogMap[date]) wearLogMap[date] = [];
      wearLogMap[date].push({ id: item.id, name: item.name, category: item.category, imageUrl: item.imageUrl || null });
    }
  }
  const wearLog = Object.fromEntries(
    Object.entries(wearLogMap).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 60)
  );

  // Build outfit wear log: group outfit wear events by date with full item details
  const outfitWearLogMap = {};
  for (const outfit of outfits) {
    for (const event of (outfit.wearEvents || [])) {
      if (!outfitWearLogMap[event.date]) outfitWearLogMap[event.date] = [];
      outfitWearLogMap[event.date].push({
        outfitId: outfit.id,
        outfitName: outfit.name,
        timestamp: event.timestamp,
        items: (event.itemIds || []).map(id => {
          const item = items.find(i => i.id === id);
          return item ? { id: item.id, name: item.name, category: item.category, imageUrl: item.imageUrl || null } : null;
        }).filter(Boolean)
      });
    }
  }
  for (const date of Object.keys(outfitWearLogMap)) {
    outfitWearLogMap[date].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }
  const outfitWearLog = Object.fromEntries(
    Object.entries(outfitWearLogMap).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 60)
  );

  res.json({ totalItems: items.length, totalOutfits: outfits.length, byCategory, byColor, neverWorn, wornThisMonth, mostWorn, wearLog, outfitWearLog });
});

// GET /stats/gaps — AI-powered wardrobe gap analysis
router.get('/gaps', async (req, res) => {
  const items = readJSON(CLOSET_PATH);
  // Require at least 5 items for a meaningful analysis
  if (items.length < 5) return res.json({ gaps: null, message: 'Add more items for a gap analysis' });
  try {
    const analysis = await analyzeWardrobeGaps(items);
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: 'Analysis failed', detail: err.message });
  }
});

module.exports = router;
