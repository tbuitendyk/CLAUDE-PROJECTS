// Screenshot import: send a photo of a trading app's balances screen to
// Claude (vision + structured outputs) and get back the holdings as data.
// Requires ANTHROPIC_API_KEY in the environment; the feature is disabled
// (visionConfigured() === false) when it's absent.
const config = require('./config');

let Anthropic = null;
try {
  Anthropic = require('@anthropic-ai/sdk');
} catch {
  /* dependency not installed; feature stays off */
}

let client = null;
if (Anthropic && config.anthropicApiKey) {
  client = new Anthropic({ apiKey: config.anthropicApiKey });
}

function visionConfigured() {
  return Boolean(client);
}

// Structured-output schema: the API guarantees the response text is valid
// JSON matching this, so no fuzzy parsing is needed.
const HOLDINGS_SCHEMA = {
  type: 'object',
  properties: {
    assets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          symbol: { type: 'string' },
          quantity: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          value_usd: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          percent: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        },
        required: ['name', 'symbol', 'quantity', 'value_usd', 'percent'],
        additionalProperties: false,
      },
    },
  },
  required: ['assets'],
  additionalProperties: false,
};

const PROMPT = `This is a screenshot of a portfolio/balances screen from a trading or exchange app.

Extract every individual asset holding that is visible (fully or partially). For each one:
- name: the asset's display name (e.g. "Bitcoin", "US Dollar")
- symbol: its ticker symbol (e.g. "BTC", "USD"). If only the name is shown, use the standard ticker for that asset.
- quantity: the number of units held (the amount denominated in the asset itself, NOT its dollar value). Numbers may use commas as thousands separators — parse them as plain numbers. null if not visible.
- value_usd: the holding's total fiat/USD value if shown, else null.
- percent: the holding's percentage of the portfolio if shown, else null.

Do not include totals, headers, buttons, or rows that are not asset holdings. If a row is cut off but the asset and quantity are still legible, include it.`;

async function parseHoldingsScreenshot(imageBase64, mediaType) {
  if (!client) throw new Error('ANTHROPIC_API_KEY not configured');
  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { format: { type: 'json_schema', schema: HOLDINGS_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: imageBase64 },
          },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
  });
  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined to process this image');
  }
  const text = response.content.find((b) => b.type === 'text');
  if (!text) throw new Error('No text in model response');
  return JSON.parse(text.text).assets;
}

module.exports = { visionConfigured, parseHoldingsScreenshot };
