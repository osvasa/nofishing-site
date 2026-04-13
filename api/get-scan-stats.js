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
    // Look up user_id
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
      return res.status(200).json({ total: 0, threats: 0, lastScan: null, recentScans: [] });
    }

    const userId = profiles[0].id;

    // Get recent scans (last 5)
    const scansRes = await fetch(
      `${supabaseUrl}/rest/v1/mobile_scans?user_id=eq.${userId}&select=url,result,score,reasons,scanned_at&order=scanned_at.desc&limit=5`,
      {
        method: 'GET',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
      }
    );

    const recentScans = await scansRes.json();

    // Get total count
    const countRes = await fetch(
      `${supabaseUrl}/rest/v1/mobile_scans?user_id=eq.${userId}&select=id`,
      {
        method: 'GET',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'count=exact',
          'Range-Unit': 'items',
          'Range': '0-0',
        },
      }
    );

    const contentRange = countRes.headers.get('content-range');
    const total = contentRange ? parseInt(contentRange.split('/')[1]) || 0 : 0;

    // Get threats count
    const threatsRes = await fetch(
      `${supabaseUrl}/rest/v1/mobile_scans?user_id=eq.${userId}&result=neq.safe&select=id`,
      {
        method: 'GET',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'count=exact',
          'Range-Unit': 'items',
          'Range': '0-0',
        },
      }
    );

    const threatsRange = threatsRes.headers.get('content-range');
    const threats = threatsRange ? parseInt(threatsRange.split('/')[1]) || 0 : 0;

    const lastScan = Array.isArray(recentScans) && recentScans.length > 0 ? recentScans[0] : null;
    const safeRate = total === 0 ? 100 : Math.round(((total - threats) / total) * 100);

    return res.status(200).json({
      total,
      threats,
      safeRate,
      lastScan,
      recentScans: Array.isArray(recentScans) ? recentScans : [],
    });
  } catch (err) {
    console.error('Get scan stats error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};