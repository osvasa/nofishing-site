const Stripe = require('stripe');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const setupIntent = await stripe.setupIntents.create({
      usage: 'off_session',
    });

    res.status(200).json({ clientSecret: setupIntent.client_secret });
  } catch (err) {
    console.error('SetupIntent error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
