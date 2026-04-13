/**
 * ═══════════════════════════════════════════════════════════════
 *  BLISS OUT DANCE STUDIO — Backend Server
 *  Express.js + Razorpay + Nodemailer + PDFKit + MongoDB/Mongoose
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

const express     = require('express');
const cors        = require('cors');
const crypto      = require('crypto');
const Razorpay    = require('razorpay');
const nodemailer  = require('nodemailer');
const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const mongoose    = require('mongoose');
require('dotenv').config();

// ── APP INIT ─────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 5000;

// ── MONGOOSE CONNECTION ──────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI is not set in .env — exiting.');
  process.exit(1);
}

mongoose
  .connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });

// ── MONGOOSE SCHEMAS & MODELS ────────────────────────────────────

/**
 * Registration Schema
 * Holds one document per successful, verified payment.
 * `isArchived` lets the admin reset route move old batches
 * out of the active seat count without deleting real data.
 */
const registrationSchema = new mongoose.Schema(
  {
    name:           { type: String, required: true, trim: true },
    email:          { type: String, required: true, trim: true, lowercase: true },
    phone:          { type: String, required: true, trim: true },
    age:            { type: String, required: true },
    level:          { type: String, required: true },
    city:           { type: String, required: true },
    registrationId: { type: String, required: true, unique: true },
    paymentId:      { type: String, required: true, unique: true },
    orderId:        { type: String, required: true, unique: true },
    paidAt:         { type: Date,   required: true },
    // Soft-archive flag — set to true by /admin/reset-batch
    isArchived:     { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

const Registration = mongoose.model('Registration', registrationSchema);

// ── CAPACITY CONFIG ──────────────────────────────────────────────
const BATCH_CAPACITY = 30;

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
  <html lang="en">
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
    <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
      <div style="background:#C8102E;padding:28px 24px;text-align:center;">
        <h1 style="margin:0;color:#FFD166;font-size:22px;">✦ Bliss Out Dance Studio ✦</h1>
        <p style="margin:6px 0 0;color:rgba(255,255,255,.8);font-size:13px;">Khandwa, Madhya Pradesh</p>
      </div>
      <div style="padding:28px 28px 8px;">
        <h2 style="color:#333;font-size:19px;margin-top:0;">🎉 You're Registered!</h2>
        <p style="color:#555;line-height:1.6;">
          Hi <strong>${data.name}</strong>,<br>
          Your spot in the <strong>One-Month Garba Workshop 2025</strong> is confirmed.
          Your Garba Pass PDF is attached — please save it; you'll need it on Day 1.
        </p>
        <table style="width:100%;border-collapse:collapse;margin:18px 0;">
          <tr style="background:#fdf6ee;">
            <td style="padding:10px 14px;color:#888;font-size:12px;">REGISTRATION ID</td>
            <td style="padding:10px 14px;font-weight:bold;color:#C8102E;">${data.registrationId}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;color:#888;font-size:12px;">PAYMENT ID</td>
            <td style="padding:10px 14px;font-size:13px;color:#333;">${data.paymentId}</td>
          </tr>
          <tr style="background:#fdf6ee;">
            <td style="padding:10px 14px;color:#888;font-size:12px;">START DATE</td>
            <td style="padding:10px 14px;font-size:13px;color:#333;">1st October 2025</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;color:#888;font-size:12px;">TIMING</td>
            <td style="padding:10px 14px;font-size:13px;color:#333;">6:30 PM – 8:30 PM (Mon–Sat)</td>
          </tr>
          <tr style="background:#fdf6ee;">
            <td style="padding:10px 14px;color:#888;font-size:12px;">VENUE</td>
            <td style="padding:10px 14px;font-size:13px;color:#333;">Bliss Out Studio, Khandwa MP</td>
          </tr>
        </table>
        <p style="color:#555;line-height:1.6;font-size:13px;">
          See you on the dance floor! 💃🕺
        </p>
      </div>
      <div style="background:#f9f9f9;padding:16px 28px;border-top:1px solid #eee;text-align:center;">
        <p style="margin:0;color:#aaa;font-size:11px;">Questions? Reach us at</p>
        <p style="margin:4px 0 0;font-size:12px;">
          <a href="mailto:blissout303@gmail.com">blissout303@gmail.com</a> · +91 89640 33641
        </p>
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
    version: '2.0.0',
    time:    new Date().toISOString(),
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Seat availability (public) ────────────────────────────────────
app.get('/seats', async (req, res) => {
  try {
    const filled = await Registration.countDocuments({ isArchived: false });
    res.json({
      capacity:  BATCH_CAPACITY,
      filled,
      available: Math.max(0, BATCH_CAPACITY - filled),
    });
  } catch (err) {
    console.error('❌ /seats error:', err);
    res.status(500).json({ error: 'Could not fetch seat count.' });
  }
});

/**
 * POST /create-order
 * ─────────────────
 * Guards:
 *   1. City must be "Khandwa" (case-insensitive).
 *   2. Active batch must have fewer than BATCH_CAPACITY registrations.
 * Only then is a Razorpay order created.
 */
app.post('/create-order', async (req, res) => {
  try {
    const { amount, name, email, phone, city } = req.body;

    // ── 1. Required field check ─────────────────────────────────
    if (!amount || !name || !email || !phone || !city) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    // ── 2. City validation — Khandwa residents only ─────────────
    if (city.trim().toLowerCase() !== 'khandwa') {
      return res.status(400).json({
        error: 'Registrations are currently open for Khandwa residents only.',
      });
    }

    // ── 3. Amount sanity check ──────────────────────────────────
    const amt = parseInt(amount);
    if (isNaN(amt) || amt < 100 || amt > 10_000_000) {
      return res.status(400).json({ error: 'Invalid amount.' });
    }

    // ── 4. Capacity gate — count active (non-archived) seats ────
    const activeCount = await Registration.countDocuments({ isArchived: false });
    if (activeCount >= BATCH_CAPACITY) {
      return res.status(400).json({
        error: `This batch is full (${BATCH_CAPACITY}/${BATCH_CAPACITY} seats taken). ` +
               'Please check back when the next batch opens.',
        seatsAvailable: 0,
      });
    }

    // ── 5. Create Razorpay order ────────────────────────────────
    const order = await razorpay.orders.create({
      amount:   amt,
      currency: 'INR',
      receipt:  `rcpt_${Date.now()}`,
      notes: {
        name,
        email,
        phone,
        city,
        studio: 'Bliss Out Dance Studio',
        event:  'Garba Workshop 2025',
      },
    });

    res.json({
      orderId:        order.id,
      amount:         order.amount,
      currency:       order.currency,
      seatsRemaining: BATCH_CAPACITY - activeCount - 1, // optimistic
    });

  } catch (err) {
    console.error('❌ /create-order error:', err);
    res.status(500).json({ error: 'Failed to create order. Please try again.' });
  }
});

/**
 * POST /verify-payment
 * ────────────────────
 * Order of operations (strict):
 *   1. Validate all required fields.
 *   2. Verify Razorpay HMAC signature.
 *   3. Save registration to MongoDB  ← failsafe: happens BEFORE PDF/email.
 *   4. Generate Garba Pass PDF.
 *   5. Send confirmation emails.
 *   6. Respond with success.
 */
app.post('/verify-payment', async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      name, email, phone, age, level, city,
    } = req.body;

    // ── 1. Validate input ───────────────────────────────────────
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, error: 'Missing payment fields.' });
    }

    // ── 2. Verify Razorpay signature ────────────────────────────
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      console.warn(`⚠️  Signature mismatch for order ${razorpay_order_id}`);
      return res.status(400).json({ success: false, error: 'Payment signature invalid.' });
    }

    // ── 3. Save to MongoDB (BEFORE PDF + email) ─────────────────
    //    This is the source of truth. If email fails, the record is still safe.
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
      paidAt:         new Date(),
    };

    try {
      const reg = new Registration(registrantData);
      await reg.save();
      console.log(`✅ Registration saved to DB: ${registrationId}`);
    } catch (dbErr) {
      // If it's a duplicate key (same paymentId / orderId), the payment was
      // already processed — respond gracefully rather than erroring out.
      if (dbErr.code === 11000) {
        console.warn(`⚠️  Duplicate payment attempt for order ${razorpay_order_id}`);
        return res.status(409).json({
          success: false,
          error: 'This payment has already been processed. Check your email for your Garba Pass.',
        });
      }
      // Any other DB error is fatal — don't send a pass for a record we couldn't save.
      throw dbErr;
    }

    // ── 4. Generate Garba Pass PDF ──────────────────────────────
    let pdfBuffer;
    try {
      pdfBuffer = await generateGarbaPDF(registrantData);
      console.log(`✅ PDF generated for ${registrationId}`);
    } catch (pdfErr) {
      console.error('❌ PDF generation failed:', pdfErr);
      // Non-fatal — registration is already saved; email will be sent without attachment.
    }

    // ── 5. Send Emails ──────────────────────────────────────────
    try {
      if (pdfBuffer) {
        await sendConfirmationEmail(registrantData, pdfBuffer);
        console.log(`✅ Emails sent for ${registrationId} to ${email}`);
      }
    } catch (emailErr) {
      console.error('❌ Email send failed:', emailErr.message);
      // Non-fatal — payment is verified and DB record is saved regardless.
    }

    // ── 6. Respond success ──────────────────────────────────────
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

app.post('/admin/students', async (req, res) => {
  if (req.body.password !== process.env.ADMIN_RESET_PASSWORD) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const students = await Registration.find({ isArchived: false })
      .sort({ paidAt: -1, createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: students.length,
      students,
    });
  } catch (error) {
    console.error('Error fetching students:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch students.' });
  }
});

/**
 * POST /admin/reset-batch
 * ────────────────────────
 * Protected by the ADMIN_RESET_PASSWORD environment variable.
 * Archives all current active registrations (sets isArchived = true),
 * which immediately frees all 30 seats for the next batch.
 *
 * The old records are NOT deleted — they remain in MongoDB
 * under the "archived" flag for your records.
 *
 * Usage:
 *   curl -X POST https://your-api.com/admin/reset-batch \
 *        -H "Content-Type: application/json" \
 *        -d '{"password": "your_secret_password_here"}'
 */
app.post('/admin/reset-batch', async (req, res) => {
  try {
    const { password } = req.body;

    // ── Auth check ──────────────────────────────────────────────
    const adminPassword = process.env.ADMIN_RESET_PASSWORD;
    if (!adminPassword) {
      return res.status(503).json({ error: 'Admin reset is not configured on this server.' });
    }
    if (!password || password !== adminPassword) {
      console.warn('⚠️  Unauthorized /admin/reset-batch attempt');
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    // ── Count active registrations before archiving ─────────────
    const activeCount = await Registration.countDocuments({ isArchived: false });

    if (activeCount === 0) {
      return res.json({
        success: true,
        message: 'No active registrations to archive. Batch is already empty.',
        archivedCount: 0,
        seatsNowAvailable: BATCH_CAPACITY,
      });
    }

    // ── Archive all active registrations ────────────────────────
    const result = await Registration.updateMany(
      { isArchived: false },
      { $set: { isArchived: true } }
    );

    const archivedCount = result.modifiedCount;
    console.log(`✅ Admin reset: ${archivedCount} registrations archived. New batch open.`);

    res.json({
      success:           true,
      message:           `Batch reset complete. ${archivedCount} registrations archived.`,
      archivedCount,
      seatsNowAvailable: BATCH_CAPACITY,
    });

  } catch (err) {
    console.error('❌ /admin/reset-batch error:', err);
    res.status(500).json({ error: 'Failed to reset batch.' });
  }
});

/**
 * POST /test-email   (only available in development)
 * Useful to test email + PDF without going through payment.
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
        paidAt:         new Date(),
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
  console.log(`   CORS origin: ${process.env.FRONTEND_URL || '(all)'}`);
  console.log(`   Batch capacity: ${BATCH_CAPACITY} seats\n`);
});

module.exports = app;
