const Stripe = require('stripe');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const STRIPE_MONTHLY_PRICE_ID = process.env.STRIPE_MONTHLY_PRICE_ID;
  const STRIPE_YEARLY_PRICE_ID = process.env.STRIPE_YEARLY_PRICE_ID;

  try {
    const { email, plan, paymentMethodId } = req.body;

    if (!email || !plan || !paymentMethodId) {
      return res.status(400).json({ error: 'email, plan, and paymentMethodId are required' });
    }

    // Create or retrieve customer by email
    const existingCustomers = await stripe.customers.list({ email, limit: 1 });
    let customerId;

    if (existingCustomers.data.length > 0) {
      customerId = existingCustomers.data[0].id;
    } else {
      const customer = await stripe.customers.create({ email });
      customerId = customer.id;
    }

    // Attach payment method to customer
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });

    // Set as default payment method
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // Create subscription
    const priceId = plan === 'yearly' ? STRIPE_YEARLY_PRICE_ID : STRIPE_MONTHLY_PRICE_ID;
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      expand: ['latest_invoice.payment_intent'],
    });

    res.status(200).json({ success: true, subscriptionId: subscription.id });
  } catch (err) {
    console.error('Subscription error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
