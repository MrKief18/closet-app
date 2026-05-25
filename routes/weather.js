const express = require('express');
const path = require('path');
const { readJSON } = require('../services/db');
const { suggestOutfitForWeather } = require('../services/ai');

const router = express.Router();
const CLOSET_PATH = path.join(__dirname, '../data/closet.json');

// POST /weather/suggest — { lat, lon } → weather-aware outfit suggestion
router.post('/suggest', async (req, res) => {
  const { lat, lon } = req.body;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });

  try {
    // Fetch current weather from Open-Meteo (free, no API key needed)
    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode&temperature_unit=fahrenheit`
    );
    const weatherData = await weatherRes.json();
    const temp = Math.round(weatherData.current.temperature_2m);
    const code = weatherData.current.weathercode;

    // Map weather codes to human-readable conditions
    const codeMap = {
      sunny: [0, 1],
      cloudy: [2, 3],
      foggy: [45, 48],
      rainy: [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82],
      snowy: [71, 73, 75, 77, 85, 86],
      stormy: [95, 96, 99]
    };
    let condition = 'cloudy'; // default fallback
    for (const [name, codes] of Object.entries(codeMap)) {
      if (codes.includes(code)) { condition = name; break; }
    }

    // Load the user's wardrobe
    const items = readJSON(CLOSET_PATH);
    if (items.length < 2) return res.status(400).json({ error: 'Add more items first' });

    // Ask Claude to pick a weather-appropriate outfit
    const suggestion = await suggestOutfitForWeather(items, temp, condition);
    res.json({ temp, condition, suggestion });
  } catch (err) {
    res.status(500).json({ error: 'Weather suggestion failed', detail: err.message });
  }
});

module.exports = router;
