const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Cached system prompt — same for both image analysis and text search
const SYSTEM_PROMPT = {
  type: 'text',
  text: `You are a clothing identification assistant. When given an image or text description of a clothing item, respond ONLY with a valid JSON object using exactly these fields:
{
  "name": "descriptive item name (e.g. Slim Fit Chinos, Graphic Tee)",
  "category": "one of: tops | bottoms | shoes | outerwear | accessories",
  "color": "primary color or color combo",
  "size": "size if visible or mentioned, otherwise null",
  "brand": "brand name if visible or mentioned, otherwise null"
}
No markdown, no explanation — JSON only.`,
  cache_control: { type: 'ephemeral' }
};

// Analyze a clothing image; base64Data is a base64-encoded string, mediaType e.g. "image/jpeg"
// contextQuery is an optional text description to give Claude extra context
async function analyzeImage(base64Data, mediaType, contextQuery = null) {
  const textPrompt = contextQuery
    ? `Identify this clothing item. Additional context: "${contextQuery}". Return the JSON.`
    : 'Identify this clothing item and return the JSON.';

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
          { type: 'text', text: textPrompt }
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

module.exports = { analyzeImage, searchItem };
