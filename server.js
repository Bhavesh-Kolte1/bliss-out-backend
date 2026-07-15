/**
 * ═══════════════════════════════════════════════════════════════
 *  BLISS OUT DANCE STUDIO — Backend Server
 *  Express.js + Razorpay + Nodemailer + PDFKit + MongoDB/Mongoose
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

const path = require('path'); // add this line if not already present
const express     = require('express');
const cors        = require('cors');
const crypto      = require('crypto');
const Razorpay    = require('razorpay');
const nodemailer  = require('nodemailer');
const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const mongoose    = require('mongoose');
require('dotenv').config();

// ── WHATSAPP UTILITY ─────────────────────────────────────────────
// Loaded after dotenv so env vars are available inside the module.
const {
  uploadMedia,
  sendWhatsAppText,
  sendWhatsAppDocument,
} = require('./utils/whatsapp');

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
 * `isArchived`      — lets admin reset route soft-delete old batches.
 * `whatsappMediaId` — caches the Meta asset ID returned by uploadMedia()
 *                     so we can re-send the PDF pass on demand without
 *                     re-uploading the file to Meta on every request.
 *                     Null until the WhatsApp upload succeeds.
 */
const registrationSchema = new mongoose.Schema(
  {
    name:             { type: String, required: true, trim: true },
    email:            { type: String, required: true, trim: true, lowercase: true },
    phone:            { type: String, required: true, trim: true },
    age:              { type: String, required: true },
    level:            { type: String, required: true },
    city:             { type: String, required: true },
    registrationId:   { type: String, required: true, unique: true },
    paymentId:        { type: String, required: true, unique: true },
    orderId:          { type: String, required: true, unique: true },
    paidAt:           { type: Date,   required: true },
    // Soft-archive flag — set to true by /admin/reset-batch
    isArchived:       { type: Boolean, default: false, index: true },
    // Cached Meta media ID — populated after first WhatsApp upload.
    // Optional: null means the upload hasn't been attempted or failed.
    whatsappMediaId:  { type: String, default: null },
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

// ═══════════════════════════════════════════════════════════════════════════
//  LAYOUT CONFIGURATION
//
//  Unlike the old COORDS object, this does NOT store per-field value
//  positions. It stores only physical facts about the template asset,
//  measured once from garba-pass-template.png (2016×1152 px, scale
//  595/2016 = 0.295139 pt/px):
//
//    • labelColumnX — the shared left edge where every label begins
//      (measured: Name-/Number-/Address- all start at px 721-724,
//      i.e. ≈213 pt — confirmed to be ONE column, not three).
//
//    • Per-row y — the top of each label's glyph band (measured:
//      Name- 377px/111pt, Number- 473px/140pt, Address- 585px/173pt).
//
//    • LABEL_STYLE — the font/size that reproduces the template's
//      (monospaced) label glyph widths. Verified against measured
//      pixel widths of all three labels (see write-up); accurate to
//      ~1.5pt, which is visually indistinguishable.
//
//  Value x-positions are NEVER stored — they are derived at render
//  time from doc.widthOfString(), so they automatically stay correct
//  no matter how long each label or value is.
// ═══════════════════════════════════════════════════════════════════════════

const LAYOUT = {
  page: { width: 595, height: 340 },

  // Shared left column where every printed label begins.
  labelColumnX: 213,

  rows: {
    name: {
      label:       'Name-',
      y:           111,             // top of the label's measured glyph band
      valueFont:   'Helvetica-Bold',
      valueColor:  '#FFFFFF',
      maxFontSize: 14,
      minFontSize: 8,
      rightMargin: 12,              // pt of breathing room before the page edge
    },
    phone: {
      label:       'Number-',
      y:           140,
      valueFont:   'Helvetica-Bold',
      valueColor:  '#FFFFFF',
      maxFontSize: 14,
      minFontSize: 8,
      rightMargin: 12,
    },
    city: {
      label:       'Address-',
      y:           173,
      valueFont:   'Helvetica-Bold',
      valueColor:  '#FFFFFF',
      maxFontSize: 14,
      minFontSize: 8,
      rightMargin: 12,
    },
  },
};

// Font/size/color used to (re)draw the template's labels ourselves.
// Courier-Bold is one of PDFKit's 14 built-in core fonts — no file to
// embed, works identically locally and on Vercel. Its fixed 0.6×size
// advance per glyph is what makes it match the template's monospaced
// label font. Color sampled directly from the template's label pixels.
const LABEL_STYLE = {
  font:     'Courier-Bold',
  fontSize: 15.8,
  color:    '#C4D3F2',
};

// ─────────────────────────────────────────────────────────────────────────────
//  HELPER — measureWidth
//  Thin wrapper so every width lookup goes through one place and always
//  sets font/size BEFORE measuring (a common PDFKit footgun: widthOfString
//  silently uses whatever font/size happens to be active).
// ─────────────────────────────────────────────────────────────────────────────
function measureWidth(doc, text, font, fontSize) {
  doc.font(font).fontSize(fontSize);
  return doc.widthOfString(text);
}

// ─────────────────────────────────────────────────────────────────────────────
//  HELPER — fitFontSize
//  Steps the font size down in 0.5pt increments until `text` fits inside
//  `maxWidth` at `font`, or `minFontSize` is reached. Returns the final
//  size and leaves doc's font/size state set to it (so the caller can
//  measure/draw immediately without re-setting anything).
// ─────────────────────────────────────────────────────────────────────────────
function fitFontSize(doc, text, { font, maxFontSize, minFontSize, maxWidth, step = 0.5 }) {
  doc.font(font);
  let fontSize = maxFontSize;
  doc.fontSize(fontSize);

  while (doc.widthOfString(text) > maxWidth && fontSize > minFontSize) {
    fontSize -= step;
    doc.fontSize(fontSize);
  }
  return fontSize;
}

// ─────────────────────────────────────────────────────────────────────────────
//  HELPER — drawLabel
//  Draws (reinforces) one template label at the shared column, and
//  returns its exact rendered width. Because we draw it and measure it
//  with the SAME font/size call, the returned width is not an estimate —
//  it is the literal metric PDFKit used to lay out those glyphs.
// ─────────────────────────────────────────────────────────────────────────────
function drawLabel(doc, row) {
  const labelWidth = measureWidth(doc, row.label, LABEL_STYLE.font, LABEL_STYLE.fontSize);

  doc
    .fillColor(LABEL_STYLE.color)
    .text(row.label, LAYOUT.labelColumnX, row.y, {
      lineBreak: false,
      baseline:  'top',
    });

  return labelWidth;
}

// ─────────────────────────────────────────────────────────────────────────────
//  applyFittedText — complete rewrite
//
//  Old behavior: draw `text` at a hard-coded coord.x — correct only for
//  whichever label that x happened to be calibrated against.
//
//  New behavior:
//    1. Draw the row's label, measuring its exact width.
//    2. Fit the value's font size to the width ACTUALLY remaining on the
//       page after that label (dynamic, not a fixed per-field maxWidth).
//    3. Recompute the space width at the FINAL fitted size (spaces are
//       narrower at 8pt than at 14pt — using the max-size space would
//       under-count the gap after shrinking).
//    4. valueX = labelColumnX + labelWidth + spaceWidth — always exactly
//       one space after the dash, for any label, any value, any size.
// ─────────────────────────────────────────────────────────────────────────────
function applyFittedText(doc, text, row) {
  // 1. Label — always drawn, even if the value is empty.
  const labelWidth = drawLabel(doc, row);

  const safeText = String(text || '').trim();
  if (!safeText) return; // nothing to place after the dash

  // 2. Fit value font size to the space actually left on the page.
  //    (Uses the max-size space width as a first-pass estimate for the
  //    budget — spaces vary by only a couple pt across the fitting
  //    range, so this doesn't materially affect the shrink decision.)
  const provisionalSpace = measureWidth(doc, ' ', row.valueFont, row.maxFontSize);
  const maxWidth =
    LAYOUT.page.width -
    (LAYOUT.labelColumnX + labelWidth + provisionalSpace) -
    row.rightMargin;

  const fittedSize = fitFontSize(doc, safeText, {
    font:        row.valueFont,
    maxFontSize: row.maxFontSize,
    minFontSize: row.minFontSize,
    maxWidth,
  });

  // 3. Exact space width at the size we're actually about to draw with.
  const spaceWidth = measureWidth(doc, ' ', row.valueFont, fittedSize);

  // 4. Derived, never guessed.
  const valueX = LAYOUT.labelColumnX + labelWidth + spaceWidth;

  doc.font(row.valueFont).fontSize(fittedSize);
  doc
    .fillColor(row.valueColor)
    .text(safeText, valueX, row.y, {
      lineBreak: false,
      baseline:  'top',
    });
}

    // ── 5. Overlay labels + student data ────────────────────────────────────
    // Each row draws its own label AND its value, with the value's x
    // derived algebraically from the label's measured width — never
    // a stored coordinate.
    applyFittedText(doc, data.name,  LAYOUT.rows.name);
    applyFittedText(doc, data.phone, LAYOUT.rows.phone);
    applyFittedText(doc, data.city,  LAYOUT.rows.city);

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
 *   3. Save registration to MongoDB  ← failsafe: happens BEFORE PDF/email/WhatsApp.
 *   4. Generate Garba Pass PDF.
 *   5. Upload PDF to Meta & cache the mediaId on the DB record.
 *   6. Send owner WhatsApp notification (non-fatal).
 *   7. Send confirmation emails (non-fatal).
 *   8. Respond with success.
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

    // ── 3. Save to MongoDB (BEFORE PDF + notifications) ─────────
    //    This is the source of truth. If any later step fails, the
    //    verified payment record is still preserved.
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

    let savedReg; // keep a reference to update whatsappMediaId after upload

    try {
      savedReg = new Registration(registrantData);
      await savedReg.save();
      console.log(`✅ Registration saved to DB: ${registrationId}`);
    } catch (dbErr) {
      // Duplicate key → payment was already processed; respond gracefully.
      if (dbErr.code === 11000) {
        console.warn(`⚠️  Duplicate payment attempt for order ${razorpay_order_id}`);
        return res.status(409).json({
          success: false,
          error: 'This payment has already been processed. Check your email for your Garba Pass.',
        });
      }
      // Any other DB error is fatal — don't send a pass we couldn't save.
      throw dbErr;
    }

    // ── 4. Generate Garba Pass PDF ──────────────────────────────
    let pdfBuffer;
    try {
      pdfBuffer = await generateGarbaPDF(registrantData);
      console.log(`✅ PDF generated for ${registrationId}`);
    } catch (pdfErr) {
      console.error('❌ PDF generation failed:', pdfErr);
      // Non-fatal: the DB record is safe; email/WhatsApp will be skipped gracefully.
    }

    // ── 5. Upload PDF to Meta & persist the mediaId ─────────────
    //    Wrapped in its own try/catch so a Meta API outage never
    //    blocks the payment confirmation response to the student.
    if (pdfBuffer) {
      try {
        const mediaId = await uploadMedia(
          pdfBuffer,
          'garba-pass.pdf',
          'application/pdf'
        );

        // Persist the media ID on the DB record for later on-demand resends.
        // We use findByIdAndUpdate rather than savedReg.save() to avoid
        // any stale-data conflicts if other fields were somehow touched.
        await Registration.findByIdAndUpdate(savedReg._id, {
          $set: { whatsappMediaId: mediaId },
        });

        console.log(`✅ WhatsApp media uploaded for ${registrationId} — mediaId: ${mediaId}`);

        // ── 6. Notify studio owner via WhatsApp ─────────────────
        //    Fire-and-forget inside the same guard block: owner notification
        //    failure must never affect the student's success response.
        try {
          const ownerPhone = process.env.OWNER_WHATSAPP_NUMBER;
          if (!ownerPhone) {
            console.warn('⚠️  OWNER_WHATSAPP_NUMBER not set — skipping owner WhatsApp.');
          } else {
            await sendWhatsAppDocument(
              ownerPhone,
              mediaId,
              `GarbaPass_${registrationId}.pdf`,
              `🆕 New Registration\nName: ${name}\nPhone: ${phone}\nPass ID: ${registrationId}`
            );
            console.log(`✅ Owner WhatsApp notification sent for ${registrationId}`);
          }
        } catch (ownerWaErr) {
          // Log the full error for Vercel logs but swallow it — owner
          // notification is secondary to confirming the student's payment.
          console.error(`❌ Owner WhatsApp notification failed for ${registrationId}:`, ownerWaErr.message);
        }

      } catch (waUploadErr) {
        // The upload itself failed. Log and continue — email still works.
        console.error(`❌ WhatsApp media upload failed for ${registrationId}:`, waUploadErr.message);
      }
    }

    // ── 7. Send confirmation emails ─────────────────────────────
    try {
      if (pdfBuffer) {
        await sendConfirmationEmail(registrantData, pdfBuffer);
        console.log(`✅ Emails sent for ${registrationId} to ${email}`);
      }
    } catch (emailErr) {
      console.error('❌ Email send failed:', emailErr.message);
      // Non-fatal — payment is verified and DB record is saved regardless.
    }

    // ── 8. Respond success ──────────────────────────────────────
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
 * POST /api/send-whatsapp-pass
 * ─────────────────────────────
 * Sends (or re-sends) the Garba Pass PDF to a student via WhatsApp.
 *
 * Happy path:
 *   1. Validate request body.
 *   2. Look up registration by registrationId.
 *   3a. If a cached whatsappMediaId exists → send document directly (no re-upload).
 *   3b. If mediaId is missing (upload failed during /verify-payment) →
 *       regenerate PDF, re-upload to Meta, persist the new mediaId, then send.
 *   4. Send a friendly text message alongside the document.
 *   5. Respond 200.
 *
 * This endpoint is intentionally public so the admin page (or a future
 * "resend" button) can trigger it without extra auth overhead.
 * Rate-limit it at your CDN/Vercel edge layer if needed.
 */
app.post('/api/send-whatsapp-pass', async (req, res) => {
  try {
    const { registrationId, phone } = req.body;

    // ── 1. Input validation ─────────────────────────────────────
    if (!registrationId || !phone) {
      return res.status(400).json({
        success: false,
        error: 'Both registrationId and phone are required.',
      });
    }

    // Basic phone sanity — must be digits only (E.164 without '+').
    // The whatsapp util normalises the number further; this guards the DB query.
    // Strip spaces, dashes, and plus signs, making it a mutable variable (let)
let normalisedPhone = String(phone).replace(/[\s\-\+]/g, '');

// If the resulting string is exactly 10 digits, prepend India's country code (91)
if (normalisedPhone.length === 10) {
  normalisedPhone = '91' + normalisedPhone;
}
    if (!/^\d{10,15}$/.test(normalisedPhone)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format. Provide digits only (E.164, no "+").',
      });
    }

    // ── 2. Fetch registration from MongoDB ──────────────────────
    const reg = await Registration.findOne({ registrationId });

    if (!reg) {
      return res.status(404).json({
        success: false,
        error: `No registration found for ID: ${registrationId}`,
      });
    }

    // ── 3. Resolve a valid Meta media ID ────────────────────────
    let mediaId = reg.whatsappMediaId;

    if (!mediaId) {
      // ── 3b. Fallback: mediaId was never cached (upload failed at
      //        payment time). Regenerate the PDF and re-upload now.
      console.warn(`⚠️  No cached mediaId for ${registrationId} — regenerating PDF and re-uploading.`);

      let pdfBuffer;
      try {
        pdfBuffer = await generateGarbaPDF({
          name:           reg.name,
          email:          reg.email,
          phone:          reg.phone,
          age:            reg.age,
          level:          reg.level,
          city:           reg.city,
          registrationId: reg.registrationId,
          paymentId:      reg.paymentId,
          orderId:        reg.orderId,
          paidAt:         reg.paidAt,
        });
      } catch (pdfErr) {
        console.error(`❌ PDF regeneration failed for ${registrationId}:`, pdfErr.message);
        return res.status(500).json({
          success: false,
          error: 'Could not regenerate the pass PDF. Please try again later.',
        });
      }

      try {
        mediaId = await uploadMedia(pdfBuffer, 'garba-pass.pdf', 'application/pdf');

        // Persist the newly acquired mediaId so subsequent requests are instant.
        await Registration.findByIdAndUpdate(reg._id, {
          $set: { whatsappMediaId: mediaId },
        });

        console.log(`✅ Re-uploaded PDF for ${registrationId} — new mediaId: ${mediaId}`);
      } catch (uploadErr) {
        console.error(`❌ PDF re-upload to Meta failed for ${registrationId}:`, uploadErr.message);
        return res.status(502).json({
          success: false,
          error: 'Could not upload pass to WhatsApp. Meta API may be unavailable.',
        });
      }
    }

    // ── 4. Send PDF document + friendly text to the student ─────
    //    Both calls run sequentially — the document first (so the
    //    student sees the PDF before the text), then the greeting.
    try {
      await sendWhatsAppDocument(
        normalisedPhone,
        mediaId,
        `GarbaPass_${registrationId}.pdf`,
        `🎉 Your Bliss Out Dance Studio Garba Pass is here! Please save this — you'll need it on Day 1.`
      );

      await sendWhatsAppText(
        normalisedPhone,
        `Hi ${reg.name}! 🙏 Your spot in the One-Month Garba Workshop 2025 is confirmed.\n\n` +
        `📋 Reg ID: ${registrationId}\n` +
        `📅 Starts: 1st October 2025\n` +
        `🕐 Timing: 6:30 PM – 8:30 PM (Mon–Sat)\n` +
        `📍 Venue: Bliss Out Studio, Khandwa MP\n\n` +
        `See you on the dance floor! 💃🕺`
      );

      console.log(`✅ WhatsApp pass sent to ${normalisedPhone} for ${registrationId}`);
    } catch (sendErr) {
      console.error(`❌ WhatsApp send failed for ${registrationId}:`, sendErr.message);
      return res.status(502).json({
        success: false,
        error: 'Pass upload succeeded but WhatsApp delivery failed. Please try again.',
      });
    }

    // ── 5. All done ─────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      message: `Garba Pass sent via WhatsApp to ${normalisedPhone}.`,
      registrationId,
    });

  } catch (err) {
    console.error('❌ /api/send-whatsapp-pass error:', err);
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
