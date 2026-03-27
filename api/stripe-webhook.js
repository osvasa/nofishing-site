const Stripe = require('stripe');

// Vercel doesn't parse the body for webhooks — we need the raw body
// Export config to disable body parsing
module.exports.config = {
  api: { bodyParser: false },
};

function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;

  if (!webhookSecret || !supabaseUrl || !supabaseKey) {
    console.error('Missing env vars: STRIPE_WEBHOOK_SECRET, SUPABASE_URL, or SUPABASE_SECRET_KEY');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  let event;
  try {
    const rawBody = await buffer(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // Only handle payment_intent.succeeded
  if (event.type !== 'payment_intent.succeeded') {
    return res.status(200).json({ received: true, ignored: event.type });
  }

  try {
    const paymentIntent = event.data.object;
    const email = paymentIntent.metadata?.email;

    if (!email) {
      console.error('No email in payment intent metadata:', paymentIntent.id);
      return res.status(200).json({ received: true, warning: 'no email in metadata' });
    }

    console.log(`Payment succeeded for ${email}, plan: ${paymentIntent.metadata?.plan}`);

    // Update profiles table: set activated=true where email matches
    const response = await fetch(
      `${supabaseUrl}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ activated: true }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Supabase update failed (${response.status}):`, errText);
      return res.status(500).json({ error: 'Failed to activate user' });
    }

    console.log(`User ${email} activated successfully`);
    return res.status(200).json({ received: true, activated: email });

  } catch (err) {
    console.error('Webhook handler error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
