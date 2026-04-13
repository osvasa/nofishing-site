/*
 * ── Run this SQL in the Supabase SQL Editor to create the devices table ──
 *
 * CREATE TABLE public.devices (
 *   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *   user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 *   device_id text NOT NULL,
 *   device_type text NOT NULL CHECK (device_type IN ('desktop', 'mobile')),
 *   device_name text NOT NULL,
 *   registered_at timestamptz DEFAULT now(),
 *   last_seen timestamptz DEFAULT now(),
 *   UNIQUE (user_id, device_id)
 * );
 *
 * ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
 *
 * CREATE POLICY "Users can select own devices"
 *   ON public.devices FOR SELECT
 *   USING (auth.uid() = user_id);
 *
 * CREATE POLICY "Users can delete own devices"
 *   ON public.devices FOR DELETE
 *   USING (auth.uid() = user_id);
 *
 * CREATE POLICY "Service role full access"
 *   ON public.devices FOR ALL
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
    const { email, device_id, device_type, device_name } = req.body;

    if (!email || !device_id || !device_type || !device_name) {
      return res.status(400).json({ error: 'email, device_id, device_type, and device_name are required' });
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

    // Get current devices for this user
    const devicesRes = await fetch(
      `${supabaseUrl}/rest/v1/devices?user_id=eq.${userId}&select=id,device_id,device_type,device_name,registered_at,last_seen&order=registered_at.asc`,
      {
        method: 'GET',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
      }
    );

    const devices = await devicesRes.json();
    const existingDevices = Array.isArray(devices) ? devices : [];

    // Check if this device is already registered
    const alreadyRegistered = existingDevices.find((d) => d.device_id === device_id);

    if (alreadyRegistered) {
      // Update last_seen
      await fetch(
        `${supabaseUrl}/rest/v1/devices?user_id=eq.${userId}&device_id=eq.${encodeURIComponent(device_id)}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ last_seen: new Date().toISOString(), device_name }),
        }
      );

      return res.status(200).json({ success: true });
    }

    // Not yet registered — check device limit
    if (existingDevices.length >= 2) {
      return res.status(200).json({
        success: false,
        error: 'device_limit_reached',
        devices: existingDevices.map((d) => ({
          device_id: d.device_id,
          device_type: d.device_type,
          device_name: d.device_name,
          registered_at: d.registered_at,
          last_seen: d.last_seen,
        })),
      });
    }

    // Register new device
    const insertRes = await fetch(
      `${supabaseUrl}/rest/v1/devices`,
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
          device_id,
          device_type,
          device_name,
        }),
      }
    );

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      console.error(`Device insert failed (${insertRes.status}):`, errText);
      return res.status(500).json({ error: 'Failed to register device' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Register device error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};