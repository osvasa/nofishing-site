/*
 * ── Run this SQL in the Supabase SQL Editor to create the mobile_scans table ──
 *
 * CREATE TABLE public.mobile_scans (
 *   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *   user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 *   url text NOT NULL,
 *   result text NOT NULL CHECK (result IN ('safe', 'warning', 'danger')),
 *   score integer,
 *   reasons text[],
 *   scanned_at timestamptz DEFAULT now()
 * );
 *
 * ALTER TABLE public.mobile_scans ENABLE ROW LEVEL SECURITY;
 *
 * CREATE POLICY "Users can select own scans"
 *   ON public.mobile_scans FOR SELECT
 *   USING (auth.uid() = user_id);
 *
 * CREATE POLICY "Service role full access"
 *   ON public.mobile_scans FOR ALL
 *   USING (auth.role() = 'service_role');
 */

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
    const { email, url, result, score, reasons } = req.body;

    if (!email || !url || !result) {
      return res.status(400).json({ error: 'email, url, and result are required' });
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

    const insertRes = await fetch(
      `${supabaseUrl}/rest/v1/mobile_scans`,
      {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          user_id: userId,
          url: url,
          result: result,
          score: score || 0,
          reasons: reasons || [],
        }),
      }
    );

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      console.error(`Scan insert failed (${insertRes.status}):`, errText);
      return res.status(500).json({ error: 'Failed to log scan' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Log scan error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};