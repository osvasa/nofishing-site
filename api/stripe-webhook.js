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

    // Determine plan from invoice amount
    const amount = invoice.amount_paid;
    const plan = amount >= 4000 ? 'yearly' : 'monthly';

    console.log(`Invoice paid for ${email}, amount: ${amount}, plan: ${plan}, next renewal: ${nextRenewal}`);

    // Check if profile already exists
    const checkResponse = await fetch(
      `${supabaseUrl}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id`,
      {
        method: 'GET',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
      }
    );

    const existingProfiles = await checkResponse.json();
    console.log(`Profile check for ${email}:`, JSON.stringify(existingProfiles));

    if (Array.isArray(existingProfiles) && existingProfiles.length > 0) {
      // Profile EXISTS — update it
      console.log(`Profile exists for ${email}, updating activated=true`);
      const updateResponse = await fetch(
        `${supabaseUrl}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ activated: true, next_renewal: nextRenewal, plan }),
        }
      );

      if (!updateResponse.ok) {
        const errText = await updateResponse.text();
        console.error(`Supabase update failed (${updateResponse.status}):`, errText);
        return res.status(500).json({ error: 'Failed to activate user' });
      }

      console.log(`User ${email} activated successfully (updated)`);
    } else {
      // Profile DOES NOT EXIST — find auth user and create profile
      console.log(`No profile found for ${email}, looking up auth user...`);

      // Look up user in Supabase auth via admin API
      const authResponse = await fetch(
        `${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1`,
        {
          method: 'GET',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
          },
        }
      );

      let userId = null;
      let firstName = '';
      let lastName = '';

      if (authResponse.ok) {
        // Search through users — admin API doesn't filter by email, so use alternate approach
        const usersListResponse = await fetch(
          `${supabaseUrl}/auth/v1/admin/users`,
          {
            method: 'GET',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
            },
          }
        );

        if (usersListResponse.ok) {
          const usersData = await usersListResponse.json();
          const users = usersData.users || usersData;
          const matchedUser = Array.isArray(users) ? users.find(u => u.email === email) : null;

          if (matchedUser) {
            userId = matchedUser.id;
            firstName = (matchedUser.user_metadata && matchedUser.user_metadata.first_name) || '';
            lastName = (matchedUser.user_metadata && matchedUser.user_metadata.last_name) || '';
            console.log(`Found auth user: id=${userId}, name=${firstName} ${lastName}`);
          } else {
            console.error(`No auth user found for ${email}`);
          }
        }
      }

      // Also try to get name from Stripe customer
      if (!firstName) {
        try {
          const customer = await stripe.customers.retrieve(invoice.customer);
          if (customer.name) {
            const parts = customer.name.split(' ');
            firstName = parts[0] || '';
            lastName = parts.slice(1).join(' ') || '';
            console.log(`Got name from Stripe customer: ${firstName} ${lastName}`);
          }
        } catch (e) {
          console.log('Could not retrieve Stripe customer name');
        }
      }

      if (!userId) {
        console.error(`Cannot create profile for ${email} — no auth user ID found`);
        return res.status(200).json({ received: true, warning: 'no auth user found, profile not created' });
      }

      // Insert new profile
      const insertResponse = await fetch(
        `${supabaseUrl}/rest/v1/profiles`,
        {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({
            id: userId,
            first_name: firstName,
            last_name: lastName,
            email,
            plan,
            activated: true,
            next_renewal: nextRenewal,
          }),
        }
      );

      if (!insertResponse.ok) {
        const errText = await insertResponse.text();
        console.error(`Supabase insert failed (${insertResponse.status}):`, errText);
        return res.status(500).json({ error: 'Failed to create and activate user' });
      }

      console.log(`User ${email} profile created and activated successfully`);
    }

    return res.status(200).json({ received: true, activated: email });

  } catch (err) {
    console.error('Webhook handler error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
