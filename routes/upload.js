const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { analyzeImage } = require('../services/ai');

const router = express.Router();
const CLOSET_PATH = path.join(__dirname, '../data/closet.json');

// Keep uploads in memory — we only need the buffer to pass to Claude
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB cap
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  }
});

function readItems() {
  return JSON.parse(fs.readFileSync(CLOSET_PATH, 'utf8'));
}

function writeItems(items) {
  fs.writeFileSync(CLOSET_PATH, JSON.stringify(items, null, 2));
}

// POST /upload — send a clothing photo; Claude Vision identifies the item details
// Multipart form field: "image" (any image file)
// Query param: ?save=true  →  auto-add the identified item to the closet
router.post('/', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file provided (field name: image)' });

  try {
    const base64 = req.file.buffer.toString('base64');
    const details = await analyzeImage(base64, req.file.mimetype);

    if (req.query.save === 'true') {
      const items = readItems();
      const newItem = {
        id: Date.now().toString(),
        ...details,
        addedAt: new Date().toISOString()
      };
      items.push(newItem);
      writeItems(items);
      return res.status(201).json({ identified: details, saved: newItem });
    }

    res.json({ identified: details });
  } catch (err) {
    res.status(500).json({ error: 'Image analysis failed', detail: err.message });
  }
});

module.exports = router;
