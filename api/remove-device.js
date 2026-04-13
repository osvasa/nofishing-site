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
    const { email, device_id } = req.body;

    if (!email || !device_id) {
      return res.status(400).json({ error: 'email and device_id are required' });
    }

    // Look up user_id from profiles table by email
    const profileRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id`,
      {
        method: 'GET',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
      }
    );

    const profiles = await profileRes.json();

    if (!Array.isArray(profiles) || profiles.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = profiles[0].id;

    // Delete the device
    const deleteRes = await fetch(
      `${supabaseUrl}/rest/v1/devices?user_id=eq.${userId}&device_id=eq.${encodeURIComponent(device_id)}`,
      {
        method: 'DELETE',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'return=minimal',
        },
      }
    );

    if (!deleteRes.ok) {
      const errText = await deleteRes.text();
      console.error(`Device delete failed (${deleteRes.status}):`, errText);
      return res.status(500).json({ error: 'Failed to remove device' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Remove device error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};