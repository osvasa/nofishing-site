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

  if (event.type !== 'invoice.paid' && event.type !== 'invoice.payment_succeeded') {
    return res.status(200).json({ received: true });
  }

  try {
    const invoice = event.data.object;
    let email = invoice.customer_email;

    // If email is null on invoice, fetch from customer
    if (!email) {
      const customer = await stripe.customers.retrieve(invoice.customer);
      email = customer.email;
    }

    if (!email) {
      console.error('No email found for invoice:', invoice.id);
      return res.status(200).json({ received: true, warning: 'no email found' });
    }

    // Calculate next renewal date from invoice period_end
    const nextRenewal = new Date(invoice.period_end * 1000).toISOString();

    console.log(`Invoice paid for ${email}, next renewal: ${nextRenewal}`);

    // Update profiles table: set activated=true and next_renewal
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
        body: JSON.stringify({ activated: true, next_renewal: nextRenewal }),
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
