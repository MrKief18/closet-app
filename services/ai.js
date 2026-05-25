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

  const _raw = response.content[0].text.replace(/```json\\n?|```/g, "").trim(); return JSON.parse(_raw);
}

// Resolve a loose description to precise clothing details
async function searchItem(query) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    system: [SYSTEM_PROMPT],
    messages: [{
      role: 'user',
      content: `The user described a clothing item — resolve it to the correct official product details, fixing any typos, abbreviations, or brand-specific naming variations: "${query}"`
    }]
  });

  const raw = response.content[0].text.replace(/```json\n?|```/g, '').trim();
  return JSON.parse(raw);
}

// Identify exact product from description, then find real listings via Google Shopping
async function searchItemOnline(query) {
  // Step 1: Claude resolves the description to a precise product
  const details = await searchItem(query);

  // Step 2: Google Shopping search for real product listings
  const q = [details.brand, details.name, details.color].filter(Boolean).join(' ');
  const serpKey = process.env.SERPAPI_KEY;
  let products = [];

  if (serpKey) {
    try {
      const url = `https://serpapi.com/search.json` +
        `?engine=google_shopping&q=${encodeURIComponent(q)}&num=6&api_key=${serpKey}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        products = (data.shopping_results || []).slice(0, 6).map(p => ({
          title:     p.title,
          price:     p.price || null,
          source:    p.source || null,
          thumbnail: p.thumbnail || null,
          link:      p.link || null
        }));
      }
    } catch {}
  }

  return { details, products };
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

  const _raw = response.content[0].text.replace(/```json\\n?|```/g, "").trim(); return JSON.parse(_raw);
}

// Smart search — identifies the exact product from a loose description, then matches closet items
async function smartSearch(query, items) {
  const catalog = items.map(i => ({
    id: i.id, name: i.name, category: i.category,
    color: i.color, brand: i.brand || null, tags: i.tags || []
  }));

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `You are an expert fashion product identifier and personal closet search assistant.

User query: "${query}"

Step 1 — Identify the real product: Resolve the query to the correct official product name, fixing any typos, abbreviations, and brand-specific naming (e.g. "Style 4" → "Fit 4", "Jens" → "Jeans", "Rag and Bone" → "Rag & Bone"). Be as specific as possible — full official product name, exact brand, category, and a color estimate if inferable.

Step 2 — Search the wardrobe: Find any items in the wardrobe that match this product or are closely related. Rank by relevance. If nothing matches, return [].

Wardrobe: ${JSON.stringify(catalog)}

Respond ONLY with valid JSON (no markdown, no explanation):
{
  "identified": {
    "name": "full official product name",
    "brand": "exact brand name",
    "category": "tops|bottoms|shoes|outerwear|accessories",
    "color": "color or null"
  },
  "ids": ["matching wardrobe item ids ranked best-first"]
}`
    }]
  });

  const raw = response.content[0].text.replace(/```json\n?|```/g, '').trim();
  return JSON.parse(raw);
}

module.exports = { analyzeImage, searchItem, searchItemOnline, findProductImage, findProductImages, suggestOutfit, smartSearch };
