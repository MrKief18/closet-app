const express = require('express');
const path = require('path');
const { readJSON } = require('../services/db');

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

  res.json({ totalItems: items.length, totalOutfits: outfits.length, byCategory, byColor, neverWorn, wornThisMonth, mostWorn });
});

module.exports = router;
