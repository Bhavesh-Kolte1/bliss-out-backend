/**
 * ═══════════════════════════════════════════════════════════════
 *  BLISS OUT DANCE STUDIO — Backend Server
 *  Express.js + Razorpay + Nodemailer + PDFKit
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

const express    = require('express');
const cors       = require('cors');
const crypto     = require('crypto');
const Razorpay   = require('razorpay');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// ── APP INIT ─────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 5000;

// ── MIDDLEWARE ───────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS — allow your GitHub Pages URL (and localhost for development)
const allowedOrigins = [
  process.env.FRONTEND_URL,             // e.g. https://yourusername.github.io
  'http://localhost:3000',
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  // Add the exact GitHub Pages URL below:
  // 'https://yourusername.github.io',
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: Origin ${origin} not allowed.`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// ── RAZORPAY CLIENT ──────────────────────────────────────────────
const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ── NODEMAILER TRANSPORTER ───────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,    // blissout303@gmail.com
    pass: process.env.EMAIL_PASS,    // Gmail App Password (16-char)
  },
});

// Verify SMTP connection on startup
transporter.verify((err) => {
  if (err) console.error('❌ Email transporter error:', err.message);
  else     console.log('✅ Email transporter ready');
});

// ── UTILITY FUNCTIONS ────────────────────────────────────────────

/**
 * Generate a unique Registration ID
 * Format: BLISS-YYYYMMDD-XXXX
 */
function generateRegistrationId() {
  const now   = new Date();
  const date  = now.toISOString().slice(0,10).replace(/-/g,'');
  const rand  = Math.random().toString(36).slice(2,6).toUpperCase();
  return `BLISS-${date}-${rand}`;
}

/**
 * Generate the Garba Pass PDF as a Buffer
 */
function generateGarbaPDF(data) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc    = new PDFDocument({
      size:    'A5',
      margins: { top: 40, bottom: 40, left: 50, right: 50 },
    });

    doc.on('data',  (chunk) => chunks.push(chunk));
    doc.on('end',   ()      => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width;
    const H = doc.page.height;

    // ── BACKGROUND ───────────────────────────────────────────────
    doc.rect(0, 0, W, H).fill('#07060A');

    // Decorative border rect
    doc.roundedRect(14, 14, W - 28, H - 28, 12)
       .lineWidth(1.5)
       .strokeColor('#F5A623')
       .stroke();

    // Inner border
    doc.roundedRect(20, 20, W - 40, H - 40, 9)
       .lineWidth(0.5)
       .strokeColor('#C8102E')
       .stroke();

    // ── TOP STRIPE ───────────────────────────────────────────────
    doc.rect(14, 14, W - 28, 56).fill('#C8102E');

    // Studio Name in stripe
    doc.font('Helvetica-Bold')
       .fontSize(11)
       .fillColor('#FFD166')
       .text('✦  BLISS OUT DANCE STUDIO  ✦', 0, 26, { align: 'center', width: W });

    doc.font('Helvetica')
       .fontSize(7.5)
       .fillColor('rgba(255,255,255,0.8)')
       .text('Khandwa, Madhya Pradesh, India', 0, 46, { align: 'center', width: W });

    // ── GARBA PASS TITLE ─────────────────────────────────────────
    doc.font('Helvetica-Bold')
       .fontSize(22)
       .fillColor('#F5A623')
       .text('GARBA PASS', 0, 84, { align: 'center', width: W });

    doc.font('Helvetica')
       .fontSize(8)
       .fillColor('#A89BB0')
       .text('ONE-MONTH GARBA WORKSHOP  2025', 0, 112, {
         align: 'center', width: W, characterSpacing: 1.5
       });

    // Divider
    doc.moveTo(50, 130).lineTo(W - 50, 130).lineWidth(0.5).strokeColor('#F5A623').stroke();

    // ── STUDENT DETAILS ───────────────────────────────────────────
    const detailY = 146;
    const col1    = 50;
    const col2    = W / 2 + 10;

    function detailRow(label, value, x, y, color = '#F9F4EE') {
      doc.font('Helvetica')
         .fontSize(7)
         .fillColor('#A89BB0')
         .text(label.toUpperCase(), x, y);
      doc.font('Helvetica-Bold')
         .fontSize(10.5)
         .fillColor(color)
         .text(value, x, y + 11);
    }

    detailRow('Student Name', data.name,             col1, detailY);
    detailRow('Reg. ID',      data.registrationId,   col2, detailY, '#FFD166');

    detailRow('Email',        data.email,             col1, detailY + 44);
    detailRow('Phone',        data.phone,             col2, detailY + 44);

    detailRow('Age',          data.age + ' years',    col1, detailY + 88);
    detailRow('Level',        data.level.charAt(0).toUpperCase() + data.level.slice(1), col2, detailY + 88);

    // Divider
    doc.moveTo(50, detailY + 126).lineTo(W - 50, detailY + 126).lineWidth(0.5).strokeColor('#333').stroke();

    // ── WORKSHOP DETAILS ──────────────────────────────────────────
    const workshopY = detailY + 136;

    doc.font('Helvetica-Bold').fontSize(8).fillColor('#F5A623')
       .text('WORKSHOP DETAILS', col1, workshopY, { characterSpacing: 1 });

    const wDetails = [
      ['📅 Start Date',  '1st October 2025'],
      ['⏱️ Duration',    '30 Days (Mon–Sat)'],
      ['🕐 Timing',      '6:30 PM – 8:30 PM'],
      ['📍 Venue',       'Bliss Out Studio, Khandwa MP'],
    ];

    wDetails.forEach(([label, value], i) => {
      const y = workshopY + 16 + i * 18;
      doc.font('Helvetica').fontSize(7.5).fillColor('#A89BB0').text(label, col1, y);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#F9F4EE').text(value, col1 + 95, y);
    });

    // ── PAYMENT INFO ─────────────────────────────────────────────
    const payY = workshopY + 100;

    doc.rect(col1 - 4, payY, W - col1 * 2 + 8, 44)
       .fill('#1A1526');

    doc.font('Helvetica').fontSize(7).fillColor('#A89BB0')
       .text('PAYMENT STATUS', col1 + 4, payY + 7);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#4CAF50')
       .text('✔  PAID  ·  ₹999/-  ·  Via Razorpay', col1 + 4, payY + 20);
    doc.font('Helvetica').fontSize(7).fillColor('#666')
       .text(`Payment ID: ${data.paymentId || 'N/A'}`, col1 + 4, payY + 35);

    // ── QR PLACEHOLDER ───────────────────────────────────────────
    const qrX = W - 90;
    const qrY = workshopY + 10;
    doc.rect(qrX, qrY, 54, 54).fill('#1A1526').stroke();
    doc.font('Helvetica').fontSize(7).fillColor('#333')
       .text('QR', qrX + 20, qrY + 20);

    // ── BOTTOM STRIP ─────────────────────────────────────────────
    const stripY = H - 56;
    doc.rect(14, stripY, W - 28, 42).fill('#1A1526');

    doc.font('Helvetica').fontSize(7).fillColor('#666')
       .text('📞 +91 89640 33641   ✉ blissout303@gmail.com   🌐 Khandwa, MP',
             0, stripY + 8, { align: 'center', width: W });

    doc.font('Helvetica').fontSize(6.5).fillColor('#444')
       .text(`Generated on ${new Date().toLocaleString('en-IN')}  ·  This is a digital pass — no physical pass required.`,
             0, stripY + 24, { align: 'center', width: W });

    // Mandala decoration (top right)
    doc.circle(W - 30, 30, 14).lineWidth(0.5).strokeColor('rgba(245,166,35,0.2)').stroke();
    doc.circle(W - 30, 30, 9).lineWidth(0.3).strokeColor('rgba(245,166,35,0.15)').stroke();

    doc.end();
  });
}

/**
 * Send confirmation email with PDF attachment
 */
async function sendConfirmationEmail(data, pdfBuffer) {
  const htmlBody = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8"/>
    <style>
      body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f0e8; margin: 0; padding: 0; }
      .wrap { max-width: 580px; margin: 30px auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.1); }
      .header { background: linear-gradient(135deg, #C8102E, #7A000A); padding: 40px 32px; text-align: center; color: #fff; }
      .header h1 { font-size: 26px; margin: 0 0 8px; }
      .header p  { margin: 0; opacity: 0.85; font-size: 14px; }
      .body  { padding: 36px 32px; }
      .body h2 { font-size: 20px; color: #1a1526; margin: 0 0 12px; }
      .body p  { color: #555; line-height: 1.7; font-size: 14px; margin: 0 0 16px; }
      .reg-id-box { background: #f9f4ee; border: 1px solid #f5a623; border-radius: 8px; padding: 14px 20px; text-align: center; margin: 20px 0; }
      .reg-id-box .label { font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
      .reg-id-box .id    { font-family: monospace; font-size: 20px; font-weight: 700; color: #C8102E; letter-spacing: 2px; }
      .details-table { width: 100%; border-collapse: collapse; margin: 16px 0; }
      .details-table td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #f0e8e8; }
      .details-table td:first-child { color: #999; width: 40%; }
      .details-table td:last-child  { font-weight: 600; color: #1a1526; }
      .cta { text-align: center; margin: 28px 0 12px; }
      .cta a { display: inline-block; background: #C8102E; color: #fff; padding: 14px 36px; border-radius: 50px; font-size: 15px; font-weight: 700; text-decoration: none; }
      .footer { background: #0F0C15; padding: 24px 32px; text-align: center; color: #666; font-size: 12px; }
      .footer a { color: #F5A623; text-decoration: none; }
      .note { background: #fff8e1; border-left: 3px solid #F5A623; padding: 12px 16px; font-size: 13px; color: #666; border-radius: 0 8px 8px 0; margin: 20px 0; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="header">
        <h1>🎉 You're Registered!</h1>
        <p>Bliss Out Garba Workshop 2025 · Khandwa, MP</p>
      </div>
      <div class="body">
        <h2>Welcome, ${data.name}! 💃</h2>
        <p>Your spot in the <strong>One-Month Garba Workshop</strong> is confirmed. We are thrilled to have you join the Bliss Out family!</p>

        <div class="reg-id-box">
          <div class="label">Your Registration ID</div>
          <div class="id">${data.registrationId}</div>
        </div>

        <table class="details-table">
          <tr><td>Name</td><td>${data.name}</td></tr>
          <tr><td>Email</td><td>${data.email}</td></tr>
          <tr><td>Phone</td><td>${data.phone}</td></tr>
          <tr><td>Age</td><td>${data.age} years</td></tr>
          <tr><td>Level</td><td>${data.level.charAt(0).toUpperCase() + data.level.slice(1)}</td></tr>
          <tr><td>Workshop Start</td><td>1st October 2025</td></tr>
          <tr><td>Daily Timing</td><td>6:30 PM – 8:30 PM (Mon–Sat)</td></tr>
          <tr><td>Venue</td><td>Bliss Out Studio, Khandwa MP</td></tr>
          <tr><td>Amount Paid</td><td style="color:#4CAF50;font-weight:700;">₹999 ✔</td></tr>
        </table>

        <div class="note">
          📎 Your <strong>Garba Pass (PDF)</strong> is attached to this email. Please keep it safe and bring it on Day 1 of the workshop.
        </div>

        <div class="cta">
          <a href="https://wa.me/918964033641">💬 Chat with Us on WhatsApp</a>
        </div>

        <p style="font-size:13px;color:#999;">If you have any questions, reply to this email or call us at <strong>+91 89640 33641</strong>.</p>
      </div>
      <div class="footer">
        <p>© 2025 Bliss Out Dance Studio · Khandwa, Madhya Pradesh</p>
        <p><a href="mailto:blissout303@gmail.com">blissout303@gmail.com</a> · +91 89640 33641</p>
      </div>
    </div>
  </body>
  </html>`;

  // Email to registrant
  const studentMail = {
    from:        `"Bliss Out Dance Studio" <${process.env.EMAIL_USER}>`,
    to:          data.email,
    subject:     `🎉 Your Garba Pass is Here! Registration Confirmed — ${data.registrationId}`,
    html:        htmlBody,
    attachments: [{
      filename:    `GarbaPass_${data.registrationId}.pdf`,
      content:     pdfBuffer,
      contentType: 'application/pdf',
    }],
  };

  // Notification to studio owner
  const ownerMail = {
    from:    `"Bliss Out Registrations" <${process.env.EMAIL_USER}>`,
    to:      process.env.STUDIO_EMAIL || 'blissout303@gmail.com',
    subject: `🆕 New Registration — ${data.name} (${data.registrationId})`,
    html: `
      <div style="font-family:Arial,sans-serif;padding:24px;max-width:520px;">
        <h2 style="color:#C8102E;">New Garba Workshop Registration</h2>
        <p><strong>Reg ID:</strong> ${data.registrationId}</p>
        <p><strong>Name:</strong>  ${data.name}</p>
        <p><strong>Email:</strong> ${data.email}</p>
        <p><strong>Phone:</strong> ${data.phone}</p>
        <p><strong>Age:</strong>   ${data.age}</p>
        <p><strong>Level:</strong> ${data.level}</p>
        <p><strong>City:</strong>  ${data.city || 'N/A'}</p>
        <p><strong>Payment ID:</strong> ${data.paymentId}</p>
        <p><strong>Order ID:</strong>   ${data.orderId}</p>
        <p style="color:#4CAF50;font-weight:bold;">✔ Payment Verified — ₹999</p>
        <hr/>
        <p style="color:#999;font-size:12px;">Garba Pass PDF is attached.</p>
      </div>`,
    attachments: [{
      filename:    `GarbaPass_${data.registrationId}.pdf`,
      content:     pdfBuffer,
      contentType: 'application/pdf',
    }],
  };

  await Promise.all([
    transporter.sendMail(studentMail),
    transporter.sendMail(ownerMail),
  ]);
}

// ── ROUTES ───────────────────────────────────────────────────────

// Health check
app.get('/', (req, res) => {
  res.json({
    status:  'running',
    service: 'Bliss Out Dance Studio API',
    version: '1.0.0',
    time:    new Date().toISOString(),
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

/**
 * POST /create-order
 * Creates a Razorpay order and returns the order ID.
 */
app.post('/create-order', async (req, res) => {
  try {
    const { amount, name, email, phone } = req.body;

    if (!amount || !name || !email || !phone) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    // Amount must be in paise; validate range
    const amt = parseInt(amount);
    if (isNaN(amt) || amt < 100 || amt > 10000000) {
      return res.status(400).json({ error: 'Invalid amount.' });
    }

    const order = await razorpay.orders.create({
      amount:   amt,
      currency: 'INR',
      receipt:  `rcpt_${Date.now()}`,
      notes: {
        name,
        email,
        phone,
        studio: 'Bliss Out Dance Studio',
        event:  'Garba Workshop 2025',
      },
    });

    res.json({
      orderId:  order.id,
      amount:   order.amount,
      currency: order.currency,
    });

  } catch (err) {
    console.error('❌ /create-order error:', err);
    res.status(500).json({ error: 'Failed to create order. Please try again.' });
  }
});

/**
 * POST /verify-payment
 * Verifies the Razorpay signature, generates PDF, sends emails.
 */
app.post('/verify-payment', async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      name, email, phone, age, level, city,
    } = req.body;

    // ── Validate input ─────────────────────────────────────────
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, error: 'Missing payment fields.' });
    }

    // ── Verify Razorpay signature ──────────────────────────────
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      console.warn(`⚠️  Signature mismatch for order ${razorpay_order_id}`);
      return res.status(400).json({ success: false, error: 'Payment signature invalid.' });
    }

    // ── Generate Registration ID ───────────────────────────────
    const registrationId = generateRegistrationId();

    const registrantData = {
      name,
      email,
      phone,
      age,
      level:          level || 'beginner',
      city:           city  || 'Khandwa',
      registrationId,
      paymentId:      razorpay_payment_id,
      orderId:        razorpay_order_id,
      paidAt:         new Date().toISOString(),
    };

    // ── Generate Garba Pass PDF ────────────────────────────────
    let pdfBuffer;
    try {
      pdfBuffer = await generateGarbaPDF(registrantData);
      console.log(`✅ PDF generated for ${registrationId}`);
    } catch (pdfErr) {
      console.error('❌ PDF generation failed:', pdfErr);
      // Don't block — still confirm registration, email with note
    }

    // ── Send Emails ────────────────────────────────────────────
    try {
      if (pdfBuffer) {
        await sendConfirmationEmail(registrantData, pdfBuffer);
        console.log(`✅ Emails sent for ${registrationId} to ${email}`);
      }
    } catch (emailErr) {
      console.error('❌ Email send failed:', emailErr.message);
      // Don't block — payment is verified regardless
    }

    // ── Respond success ────────────────────────────────────────
    res.json({
      success:        true,
      registrationId,
      paymentId:      razorpay_payment_id,
      message:        'Registration confirmed! Check your email for the Garba Pass.',
    });

  } catch (err) {
    console.error('❌ /verify-payment error:', err);
    res.status(500).json({ success: false, error: 'Internal server error.' });
  }
});

/**
 * POST /test-email   (only available in development)
 * Useful to test email + PDF without going through payment
 */
if (process.env.NODE_ENV !== 'production') {
  app.post('/test-email', async (req, res) => {
    try {
      const testData = {
        name:           req.body.name  || 'Test User',
        email:          req.body.email || process.env.EMAIL_USER,
        phone:          '9876543210',
        age:            '25',
        level:          'beginner',
        city:           'Khandwa',
        registrationId: generateRegistrationId(),
        paymentId:      'test_pay_' + uuidv4().slice(0,8),
        orderId:        'test_ord_' + uuidv4().slice(0,8),
      };

      const pdf = await generateGarbaPDF(testData);
      await sendConfirmationEmail(testData, pdf);
      res.json({ success: true, registrationId: testData.registrationId });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
}

// ── 404 HANDLER ──────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// ── GLOBAL ERROR HANDLER ─────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'An unexpected error occurred.' });
});

// ── START SERVER ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Bliss Out API running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   CORS origin: ${process.env.FRONTEND_URL || '(all)'}\n`);
});

module.exports = app;
