const nodemailer = require('nodemailer');

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

  const smtpPassword = process.env.SMTP_PASSWORD;
  if (!smtpPassword) {
    console.error('Missing SMTP_PASSWORD env var');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const { email, first_name } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }

    const name = first_name || 'there';
    const paymentUrl = `https://nofishing.ai/payment?email=${encodeURIComponent(email)}&plan=monthly`;

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
      subject: 'Welcome to NøFishing AI',
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
        <tr><td style="background:#1a1a1a;border-radius:12px;padding:36px 28px;text-align:center;">
          <h1 style="color:#ffffff;font-size:24px;font-weight:800;margin:0 0 16px;">Hi ${name}!</h1>
          <p style="color:rgba(255,255,255,0.7);font-size:15px;line-height:1.6;margin:0 0 12px;">Welcome to NøFishing AI. You're one step away from full protection.</p>
          <p style="color:rgba(255,255,255,0.7);font-size:15px;line-height:1.6;margin:0 0 28px;">Complete your payment to activate your AI-powered phishing shield.</p>
          <a href="${paymentUrl}" style="display:inline-block;padding:14px 32px;background:#EC220C;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:800;">Activate My Protection</a>
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

    console.log(`Welcome email sent to ${email}`);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Send welcome email error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
