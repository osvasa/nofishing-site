const Stripe = require('stripe');
const nodemailer = require('nodemailer');

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

  if (event.type !== 'invoice.paid') {
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
      `${supabaseUrl}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id,first_name`,
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

      // Look up user in Supabase auth via admin API (direct email lookup)
      let userId = null;
      let firstName = '';
      let lastName = '';

      const { createClient } = require('@supabase/supabase-js');
      const supabaseAdmin = createClient(supabaseUrl, supabaseKey);
      const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers({
        filter: `email.eq.${email}`,
      });

      if (listError) {
        console.error(`Auth user lookup failed for ${email}:`, listError.message);
      }

      const authUser = users?.[0] || null;

      if (authUser) {
        userId = authUser.id;
        firstName = (authUser.user_metadata && authUser.user_metadata.first_name) || '';
        lastName = (authUser.user_metadata && authUser.user_metadata.last_name) || '';
        console.log(`Found auth user: id=${userId}, name=${firstName} ${lastName}`);
      } else {
        console.error(`No auth user found for ${email}`);
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

    // Send activation email
    const smtpPassword = process.env.SMTP_PASSWORD;
    if (smtpPassword) {
      try {
        // Get first name — from existing profile check or from insert path
        let activationName = '';
        if (Array.isArray(existingProfiles) && existingProfiles.length > 0) {
          activationName = existingProfiles[0].first_name || '';
        } else {
          activationName = firstName || '';
        }
        const displayName = activationName || 'there';
        const planLabel = plan === 'yearly' ? 'Yearly Protection ($49.99/year)' : 'Monthly Protection ($4.99/month)';
        const renewalDate = new Date(nextRenewal).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

        // Generate license key from user id
        let licenseKey = '—';
        const profileId = (Array.isArray(existingProfiles) && existingProfiles.length > 0) ? existingProfiles[0].id : (userId || '');
        if (profileId) {
          const clean = profileId.replace(/-/g, '');
          licenseKey = 'NFAI-' + clean.substring(0, 4).toUpperCase() + '-' + clean.substring(4, 8).toUpperCase();
        }

        const transporter = nodemailer.createTransport({
          host: 'smtp.protonmail.ch',
          port: 587,
          secure: false,
          auth: {
            user: 'hello@nofishing.ai',
            pass: smtpPassword,
          },
        });

        await transporter.sendMail({
          from: '"NøFishing AI" <hello@nofishing.ai>',
          to: email,
          subject: "You're Protected — NøFishing AI is Active",
          html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#111111;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#111111;padding:40px 20px;">
    <tr><td align="center">
      <table width="500" cellpadding="0" cellspacing="0" style="max-width:500px;width:100%;">
        <tr><td style="padding-bottom:24px;text-align:center;">
          <img src="https://nofishing.ai/images/logo.png" alt="NøFishing AI" style="height:30px;width:auto;"/>
        </td></tr>
        <tr><td style="background:#EC220C;border-radius:12px;padding:36px 28px;text-align:center;">
          <h1 style="color:#ffffff;font-size:24px;font-weight:800;margin:0 0 16px;">Hi ${displayName}!</h1>
          <p style="color:rgba(255,255,255,0.7);font-size:15px;line-height:1.6;margin:0 0 20px;">Your NøFishing AI protection is now active and running silently in your browser.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.05);border-radius:8px;padding:16px;margin:0 0 20px;">
            <tr><td style="padding:6px 16px;color:rgba(255,255,255,0.5);font-size:12px;">Plan</td><td style="padding:6px 16px;color:#ffffff;font-size:12px;text-align:right;font-weight:600;">${planLabel}</td></tr>
            <tr><td style="padding:6px 16px;color:rgba(255,255,255,0.5);font-size:12px;">License</td><td style="padding:6px 16px;color:#ffffff;font-size:12px;text-align:right;font-weight:600;">${licenseKey}</td></tr>
            <tr><td style="padding:6px 16px;color:rgba(255,255,255,0.5);font-size:12px;">Protected since</td><td style="padding:6px 16px;color:#ffffff;font-size:12px;text-align:right;font-weight:600;">${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</td></tr>
          </table>
          <p style="font-size:15px;line-height:1.6;margin:0;"><strong style="color:#ffffff;">You are now AI Protected.</strong></p>
        </td></tr>
        <tr><td style="padding-top:24px;text-align:center;">
          <p style="color:rgba(255,255,255,0.3);font-size:11px;margin:0;">NøFishing AI &mdash; AI-Powered Phishing Protection</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
        });

        console.log(`Activation email sent to ${email}`);
      } catch (emailErr) {
        console.error('Activation email failed:', emailErr.message);
      }
    }

    return res.status(200).json({ received: true, activated: email });

  } catch (err) {
    console.error('Webhook handler error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
