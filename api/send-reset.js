const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

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
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;

  if (!smtpPassword || !supabaseUrl || !supabaseKey) {
    console.error('Missing env vars: SMTP_PASSWORD, SUPABASE_URL, or SUPABASE_SECRET_KEY');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }

    // Generate recovery link via Supabase admin API
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo: 'https://nofishing.ai/new-password',
      },
    });

    if (error) {
      console.error('Supabase generateLink error:', error.message, JSON.stringify(error));
      return res.status(400).json({ error: error.message });
    }

    const resetUrl = data.properties.action_link;

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
      subject: 'Reset your NøFishing AI password',
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
          <h1 style="color:#ffffff;font-size:24px;font-weight:800;margin:0 0 16px;">Reset your password</h1>
          <p style="color:rgba(255,255,255,0.7);font-size:15px;line-height:1.6;margin:0 0 24px;">We received a request to reset your NøFishing AI password. Click the button below to create a new one.</p>
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
            <tr><td style="background:#111111;border-radius:10px;text-align:center;">
              <a href="${resetUrl}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;font-family:'Helvetica Neue',Arial,sans-serif;font-size:15px;font-weight:800;text-decoration:none;">Reset My Password &rarr;</a>
            </td></tr>
          </table>
          <p style="color:rgba(255,255,255,0.4);font-size:12px;line-height:1.6;margin:0 0 20px;">If you didn't request this, ignore this email. Your password won't change.</p>
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

    console.log(`Reset email sent to ${email}`);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Send reset email error:', err.message, err.stack);
    return res.status(500).json({ error: err.message });
  }
};
