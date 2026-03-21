# 🎊 Bliss Out Dance Studio — Garba Workshop Website

**Complete full-stack registration system for the One-Month Garba Workshop**
*Khandwa, Madhya Pradesh · blissout303@gmail.com · +91 89640 33641*

---

## 📁 Directory Structure

```
bliss-out-dance-studio/
├── frontend/
│   └── index.html          ← Single-page website (HTML + CSS + JS)
│
├── backend/
│   ├── server.js           ← Express.js API server
│   ├── package.json        ← Node.js dependencies
│   ├── .env.example        ← Environment variable template
│   └── .gitignore
│
└── README.md               ← This file
```

---

## 🔑 Accounts You Need to Create

Before you start, sign up for these free services:

| Service | Link | Purpose |
|---------|------|---------|
| **GitHub** | github.com | Host the frontend (free) |
| **Render** | render.com | Host the backend (free) |
| **Razorpay** | razorpay.com | Accept payments |
| **Gmail** | Already have it | Send confirmation emails |

---

## ⚙️ PART 1: Backend Setup (Render)

### Step 1 — Get Your Razorpay API Keys

1. Go to [dashboard.razorpay.com](https://dashboard.razorpay.com/)
2. Sign up / log in → complete KYC
3. Navigate to **Settings → API Keys**
4. Click **Generate Test Key** → copy both keys:
   - `Key ID` → starts with `rzp_test_`
   - `Key Secret` → 32-character string
5. When ready for production, generate **Live Keys** (`rzp_live_`)

### Step 2 — Set Up Gmail App Password

1. Go to your Gmail account → **Settings → Security**
2. Enable **2-Step Verification** (required)
3. Go back to Security → scroll to **"App passwords"**
4. Click **App passwords** → Select app: **Mail** → Select device: **Other (Custom name)**
5. Type "Bliss Out Studio" → click **Generate**
6. Copy the **16-character password** (e.g. `abcd efgh ijkl mnop`)
7. This is your `EMAIL_PASS` — save it immediately

### Step 3 — Push Backend to GitHub

```bash
# Create a new repository on github.com called "bliss-out-backend"

cd bliss-out-dance-studio/backend
git init
git add .
git commit -m "Initial backend commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/bliss-out-backend.git
git push -u origin main
```

> ⚠️ **Important**: Make sure `.env` is in `.gitignore` — NEVER push your real secrets.

### Step 4 — Deploy Backend on Render

1. Go to [render.com](https://render.com) → Sign up / log in
2. Click **"New +"** → Select **"Web Service"**
3. Connect your GitHub account → Select **bliss-out-backend** repo
4. Fill in the settings:
   - **Name**: `bliss-out-backend`
   - **Region**: Singapore (closest to India)
   - **Branch**: `main`
   - **Root Directory**: *(leave empty)*
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Free
5. Click **"Advanced"** → **"Add Environment Variable"** and add ALL these:

```
PORT              = 5000
NODE_ENV          = production
FRONTEND_URL      = https://YOUR_USERNAME.github.io
RAZORPAY_KEY_ID   = rzp_live_XXXXXXXXXXXXXXXX
RAZORPAY_KEY_SECRET = XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
EMAIL_USER        = blissout303@gmail.com
EMAIL_PASS        = xxxx xxxx xxxx xxxx
STUDIO_EMAIL      = blissout303@gmail.com
```

6. Click **"Create Web Service"**
7. Wait 3–5 minutes for deployment
8. Your backend URL will be: `https://bliss-out-backend.onrender.com`

### Step 5 — Test Backend is Running

Open in browser: `https://bliss-out-backend.onrender.com`
You should see: `{"status":"running","service":"Bliss Out Dance Studio API"}`

---

## 🌐 PART 2: Frontend Setup (GitHub Pages)

### Step 1 — Update Frontend Config

Open `frontend/index.html` and find these two lines in the `<script>` section:

```javascript
const BACKEND_URL = 'https://bliss-out-backend.onrender.com';
// ↑ Replace with YOUR actual Render URL

const RAZORPAY_KEY = 'rzp_live_XXXXXXXXXXXXXXXX';
// ↑ Replace with YOUR Razorpay Key ID (NOT the secret)
```

### Step 2 — Push Frontend to GitHub Pages

```bash
# Create a new repository on github.com called "bliss-out-dance-studio"
# OR use your existing username.github.io repository

cd bliss-out-dance-studio/frontend
git init
git add .
git commit -m "Initial frontend commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/bliss-out-dance-studio.git
git push -u origin main
```

### Step 3 — Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings** → scroll down to **Pages**
3. Under **Source**: Select `main` branch → folder `/` (root)
4. Click **Save**
5. Your site will be live at: `https://YOUR_USERNAME.github.io/bliss-out-dance-studio/`

> 💡 **Alternative**: If you want the site at `yourusername.github.io` directly, name the repository `yourusername.github.io` and push `index.html` to root.

### Step 4 — Update CORS on Backend

Now that you know your GitHub Pages URL, go to **Render Dashboard**:
1. Open your `bliss-out-backend` service
2. Go to **Environment** tab
3. Update `FRONTEND_URL` to your exact GitHub Pages URL:
   - e.g. `https://yourusername.github.io` or
   - e.g. `https://yourusername.github.io/bliss-out-dance-studio`
4. Click **Save Changes** — Render will automatically redeploy

---

## 🧪 PART 3: Testing the Complete Flow

### A) Test Payment in Test Mode

1. In `frontend/index.html`, set:
   ```javascript
   const RAZORPAY_KEY = 'rzp_test_XXXXXXXXXXXXXXXX'; // Use TEST key
   ```

2. In Render environment, set:
   ```
   RAZORPAY_KEY_ID     = rzp_test_XXXXXXXXXXXXXXXX
   RAZORPAY_KEY_SECRET = (your test secret)
   ```

3. Open your website → Fill the registration form → Click "Proceed to Payment"

4. In Razorpay test modal, use test cards:
   - **Success**: Card `4111 1111 1111 1111` · Expiry `12/30` · CVV `123`
   - **UPI**: `success@razorpay`
   - **Failure**: Card `4000 0000 0000 0002`

5. After payment, check:
   - ✅ Success modal appears with Registration ID
   - ✅ Confetti animation fires
   - ✅ Email arrives at the registered email address
   - ✅ Studio notification email arrives at `blissout303@gmail.com`
   - ✅ PDF Garba Pass is attached to both emails

### B) Test Email Only (without payment)

```bash
curl -X POST https://bliss-out-backend.onrender.com/test-email \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"your@email.com"}'
```

---

## 🚀 PART 4: Going Live (Production)

When you're ready to accept real money:

1. **Complete Razorpay KYC** on their dashboard (takes 1–2 business days)
2. **Generate Live Keys** in Razorpay Dashboard → Settings → API Keys
3. Update Render environment variables:
   ```
   RAZORPAY_KEY_ID     = rzp_live_XXXXXXXXXXXXXXXX
   RAZORPAY_KEY_SECRET = (your live secret)
   ```
4. Update `frontend/index.html`:
   ```javascript
   const RAZORPAY_KEY = 'rzp_live_XXXXXXXXXXXXXXXX';
   ```
5. Push the frontend update and redeploy

---

## 🔧 PART 5: Customization Guide

### Changing the Workshop Fee

In `frontend/index.html`:
```javascript
const WORKSHOP_AMOUNT = 99900; // ₹999 in paise
// Change to 149900 for ₹1499, etc.
```

Also update the display text — search for `₹999` in the HTML.

### Changing Workshop Dates/Details

Search and replace in `index.html`:
- `1st October 2025` → your start date
- `6:30 PM – 8:30 PM` → your timing
- `Mon – Sat` → your schedule
- `30 days` → your duration

### Adding Real Photos to Gallery

Replace the SVG slide backgrounds with actual images:
```html
<div class="slide-bg" style="background-image: url('your-photo.jpg');"></div>
```

Upload photos to a free CDN like [Cloudinary](https://cloudinary.com) or just push them to GitHub alongside the HTML.

### Updating Contact Details

In the Footer section, update:
- Address, Phone, Email, WhatsApp number

---

## 🛡️ Security Checklist

- [ ] `.env` file is in `.gitignore` and NOT committed
- [ ] Razorpay signature is verified server-side (already done in `server.js`)
- [ ] Using HTTPS on both frontend (GitHub Pages) and backend (Render)
- [ ] CORS is restricted to your specific frontend URL
- [ ] Gmail App Password used (not your real Gmail password)
- [ ] Live Razorpay keys used only in production, test keys in development

---

## 📞 Support & Contact

| | |
|--|--|
| **Studio** | Bliss Out Dance Studio, Khandwa MP |
| **Email** | blissout303@gmail.com |
| **Phone** | +91 89640 33641 |
| **WhatsApp** | [Chat Now](https://wa.me/918964033641) |

---

## 🧩 Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5, CSS3 (animations, Grid, Flexbox), Vanilla JS |
| Hosting | GitHub Pages (free) |
| Backend | Node.js + Express.js |
| Backend Hosting | Render (free tier) |
| Payment | Razorpay (India's leading gateway) |
| Email | Nodemailer + Gmail SMTP |
| PDF Generation | PDFKit (server-side) |
| Security | HMAC-SHA256 signature verification |

---

*Built with ❤️ for Bliss Out Dance Studio, Khandwa — bringing Garba to life!*
