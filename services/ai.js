const Anthropic = require('@anthropic-ai/sdk');
const { JWT } = require('google-auth-library');
const path = require('path');
const fs = require('fs');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Cache the Google JWT client so we don't reload the key on every request
let _googleJwt = null;
function getGoogleJwt() {
  if (_googleJwt) return _googleJwt;
  const keyFile = path.join(__dirname, '../config/google-service-account.json');
  if (!fs.existsSync(keyFile)) return null;
  try {
    const keys = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    _googleJwt = new JWT({
      email: keys.client_email,
      key: keys.private_key,
      scopes: ['https://www.googleapis.com/auth/cse']
    });
    return _googleJwt;
  } catch { return null; }
}

// Cached system prompt — same for both image analysis and text search
const SYSTEM_PROMPT = {
  type: 'text',
  text: `You are an expert fashion and clothing identification assistant.

When given an image or text description of a clothing item, respond ONLY with valid JSON:
{
  "name": "specific product name — be as precise as possible, as if writing a product listing someone would search to buy this exact item (e.g. 'Air Force 1 Low' not 'Sneakers', 'Slim Straight Leg Jeans' not 'Jeans', 'Oversized Zip-Up Hoodie' not 'Hoodie'). Include style/fit/silhouette when relevant.",
  "category": "one of: tops | bottoms | shoes | outerwear | accessories",
  "color": "specific color (e.g. 'triple white', 'washed indigo', 'bone' — not just 'white' or 'blue')",
  "size": "exact size if visible or mentioned, otherwise null",
  "brand": "exact official brand name if identifiable (e.g. 'Nike', 'Levi's', 'Zara'), otherwise null"
}
No markdown, no explanation, no extra fields — JSON only.`,
  cache_control: { type: 'ephemeral' }
};

// Analyze a clothing image; base64Data is a base64-encoded string, mediaType e.g. "image/jpeg"
async function analyzeImage(base64Data, mediaType) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    system: [SYSTEM_PROMPT],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64Data }
          },
          { type: 'text', text: 'Identify this clothing item and return the JSON.' }
        ]
      }
    ]
  });

  return JSON.parse(response.content[0].text);
}

// Look up clothing item details from a text search query
async function searchItem(query) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    system: [SYSTEM_PROMPT],
    messages: [
      {
        role: 'user',
        content: `Return clothing item details for: "${query}"`
      }
    ]
  });

  return JSON.parse(response.content[0].text);
}

// Return up to `count` product image URLs for user selection
async function findProductImages(details, count = 6) {
  const q = [details.brand, details.name, details.color].filter(Boolean).join(' ');
  const serpKey = process.env.SERPAPI_KEY;
  if (serpKey) {
    try {
      const url = `https://serpapi.com/search.json` +
        `?engine=google_images&q=${encodeURIComponent(q + ' product')}&num=${count}&api_key=${serpKey}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        return (data.images_results || [])
          .slice(0, count)
          .map(r => r.original || r.thumbnail)
          .filter(Boolean);
      }
    } catch {}
  }
  return [];
}

// Find a real product photo. Priority: SerpAPI (Google Images) → Unsplash fallback.
async function findProductImage(details) {
  // Tightest possible query: brand + product name + color
  const q = [details.brand, details.name, details.color]
    .filter(Boolean)
    .join(' ');

  // ── SerpAPI — real Google Images results ─────────────────────────────────────
  const serpKey = process.env.SERPAPI_KEY;
  if (serpKey) {
    try {
      const url = `https://serpapi.com/search.json` +
        `?engine=google_images&q=${encodeURIComponent(q + ' product')}&num=1&api_key=${serpKey}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const link = data.images_results?.[0]?.original || data.images_results?.[0]?.thumbnail;
        if (link) return link;
      }
    } catch {}
  }

  // ── Unsplash fallback ────────────────────────────────────────────────────────
  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY;
  if (unsplashKey) {
    try {
      const url = `https://api.unsplash.com/search/photos` +
        `?query=${encodeURIComponent(q)}&per_page=1&client_id=${unsplashKey}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        return data.results?.[0]?.urls?.small || null;
      }
    } catch {}
  }

  return null;
}

// Ask Claude to pick a complete outfit from the user's wardrobe for a given occasion
async function suggestOutfit(items, occasion) {
  const wardrobe = items.map(i => ({
    id: i.id, name: i.name, category: i.category,
    color: i.color, brand: i.brand || null, tags: i.tags || []
  }));

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `You are a personal stylist. Choose a complete outfit from this wardrobe for: "${occasion}".

Wardrobe: ${JSON.stringify(wardrobe)}

Rules: pick one item per category needed, only use IDs listed above.
Respond ONLY with valid JSON (no markdown):
{"name":"outfit name","itemIds":["id1","id2"],"reasoning":"one sentence"}`
    }]
  });

  return JSON.parse(response.content[0].text);
}

// Natural language search — Claude understands the query and ranks matching items
async function smartSearch(query, items) {
  const catalog = items.map(i => ({
    id: i.id, name: i.name, category: i.category,
    color: i.color, brand: i.brand || null, tags: i.tags || []
  }));

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: `You are searching a personal clothing wardrobe. The user's query: "${query}"

Wardrobe items: ${JSON.stringify(catalog)}

Return the IDs of items that best match the query, ranked from most to least relevant.
Be generous — include loosely related items. If nothing matches, return [].
Respond ONLY with valid JSON (no markdown): {"ids":["id1","id2",...]}`
    }]
  });

  const raw = response.content[0].text.replace(/```json\n?|```/g, '').trim();
  return JSON.parse(raw);
}

module.exports = { analyzeImage, searchItem, findProductImage, findProductImages, suggestOutfit, smartSearch };
