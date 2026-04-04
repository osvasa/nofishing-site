module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing env vars: SUPABASE_URL or SUPABASE_SECRET_KEY');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const email = req.query.email;
  if (!email) {
    return res.status(400).json({ error: 'email is required' });
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=activated,first_name,plan`,
      {
        method: 'GET',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
      }
    );

    const profiles = await response.json();

    if (Array.isArray(profiles) && profiles.length > 0) {
      const profile = profiles[0];
      return res.status(200).json({
        activated: profile.activated || false,
        first_name: profile.first_name || '',
        plan: profile.plan || 'monthly',
      });
    }

    return res.status(200).json({ activated: false });
  } catch (err) {
    console.error('Check activation error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
