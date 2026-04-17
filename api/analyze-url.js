// ── NøFishing AI — Claude AI URL Analysis Endpoint ──

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { url, score, reasons } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url is required' });
    }

    const heuristicScore = score || 0;
    const heuristicReasons = Array.isArray(reasons) ? reasons.join(', ') : 'None';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        system: 'You are a cybersecurity expert analyzing URLs for phishing and scams. Respond with JSON only: {"level": "safe"|"warning"|"danger", "reason": "one sentence explanation"}. Be concise and decisive.',
        messages: [
          {
            role: 'user',
            content: `Analyze this URL for phishing/scam risk. URL: ${url}. Heuristic score: ${heuristicScore}/100. Heuristic flags: ${heuristicReasons}. Is this safe, a warning, or danger?`,
          },
        ],
      }),
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const parsed = JSON.parse(text);

    return res.status(200).json({
      level: parsed.level,
      reason: parsed.reason,
    });
  } catch (err) {
    console.error('Analyze URL error:', err.message);
    return res.status(200).json({ level: 'safe', reason: 'AI analysis unavailable' });
  }
};
