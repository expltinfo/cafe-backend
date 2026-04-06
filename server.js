require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));

// In-memory OTP store: { contact -> { otp, expiresAt } }
const otpStore = new Map();

// ── Helpers ──────────────────────────────────────────────────────
function generateOTP() { return crypto.randomInt(100000, 999999).toString(); }

function storeOTP(contact, otp) {
  otpStore.set(contact, { otp, expiresAt: Date.now() + 5 * 60 * 1000 }); // 5 min expiry
}

function isEmail(contact) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact); }

// ── Gmail OTP ─────────────────────────────────────────────────────
async function sendEmailOTP(email, otp) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });
  await transporter.sendMail({
    from: `"Brew & Co" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: '☕ Your Brew & Co Login OTP',
    html: `
      <div style="font-family:Georgia,serif;max-width:480px;margin:auto;background:#fdf6ee;border-radius:14px;padding:36px;border:1px solid #d4a97a">
        <h2 style="color:#3b1a08;text-align:center">☕ Brew &amp; Co</h2>
        <p style="color:#6b3f1f;text-align:center">Your one-time login code is:</p>
        <div style="font-size:42px;font-weight:bold;text-align:center;color:#7b3f00;letter-spacing:10px;margin:24px 0">${otp}</div>
        <p style="color:#a0714f;font-size:13px;text-align:center">This code expires in 5 minutes. Do not share it with anyone.</p>
      </div>`
  });
}

// ── SMS OTP via Twilio ────────────────────────────────────────────
async function sendSmsOTP(phone, otp) {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    body: `Your Brew & Co login OTP is: ${otp}. Valid for 5 minutes.`,
    from: process.env.TWILIO_PHONE,
    to: phone
  });
}

// ── Routes ────────────────────────────────────────────────────────

// POST /send-otp
app.post('/send-otp', async (req, res) => {
  const { contact } = req.body;
  if (!contact) return res.status(400).json({ error: 'Contact is required' });

  const otp = generateOTP();
  storeOTP(contact, otp);

  try {
    if (isEmail(contact)) {
      await sendEmailOTP(contact, otp);
    } else {
      await sendSmsOTP(contact, otp);
    }
    res.json({ success: true, message: `OTP sent to ${contact}` });
  } catch (err) {
    console.error('OTP send error:', err.message);
    res.status(500).json({ error: 'Failed to send OTP. Check your credentials.' });
  }
});

// POST /verify-otp
app.post('/verify-otp', (req, res) => {
  const { contact, otp } = req.body;
  if (!contact || !otp) return res.status(400).json({ error: 'Contact and OTP are required' });

  const record = otpStore.get(contact);
  if (!record) return res.status(400).json({ error: 'No OTP found. Please request a new one.' });
  if (Date.now() > record.expiresAt) {
    otpStore.delete(contact);
    return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
  }
  if (record.otp !== otp.trim()) return res.status(400).json({ error: 'Invalid OTP.' });

  otpStore.delete(contact);
  res.json({ success: true, message: 'OTP verified' });
});

// Health check
app.get('/', (req, res) => res.json({ status: 'Brew & Co backend running ☕' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
