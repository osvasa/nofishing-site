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

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing env vars: SUPABASE_URL or SUPABASE_SECRET_KEY');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const { id, first_name, last_name, email, plan } = req.body;

    if (!id || !email) {
      return res.status(400).json({ error: 'id and email are required' });
    }

    const response = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        id,
        first_name: first_name || '',
        last_name: last_name || '',
        email,
        plan: plan || 'monthly',
        activated: false,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Supabase insert failed (${response.status}):`, errText);
      return res.status(500).json({ error: 'Failed to create profile' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Create profile error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
