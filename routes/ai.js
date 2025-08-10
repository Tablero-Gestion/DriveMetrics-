const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const router = express.Router();

// Healthcheck
router.get('/health', (req, res) => {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  res.json({ ok: true, anthropicConfigured: hasKey });
});

router.post('/claude', async (req, res) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, message: 'ANTHROPIC_API_KEY no configurada' });
    }

    const { prompt, model, max_tokens, system } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ success: false, message: 'Falta prompt' });
    }

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: model || 'claude-3-5-sonnet-20240620',
      max_tokens: Math.min(Number(max_tokens) || 512, 4000),
      system: system || 'Eres un asistente experto en optimización de ganancias para conductores en Argentina. Responde en español.',
      messages: [
        { role: 'user', content: prompt }
      ]
    });

    let text = '';
    try {
      const part = response?.content?.[0];
      if (part?.type === 'text') text = part.text || '';
      else if (typeof part === 'string') text = part;
    } catch {}

    return res.json({ success: true, model: response?.model, output: text, raw: response });
  } catch (error) {
    console.error('AI error:', error);
    res.status(500).json({ success: false, message: 'Error generando respuesta', detail: String(error?.message || error) });
  }
});

module.exports = router;


