# Bliss Out Dance Studio — Backend API Server

The robust, full-stack server architecture handling secure commerce transactions, dynamic document generation, automated database logging, and cloud notification pipelines for Bliss Out Dance Studio.

## 🚀 Server Endpoints
* **Production Live Server:** [https://bliss-out-backend.vercel.app](https://bliss-out-backend.vercel.app)
* **Frontend Web Interface:** [https://bliss-out-frontend.vercel.app](https://bliss-out-frontend.vercel.app)

## 🛠️ Backend Tech Stack
* **Runtime & Framework:** Node.js, Express.js (REST API Architecture)
* **Database & ORM:** MongoDB Atlas via Mongoose
* **Serverless Deployment Gateway:** Deployed cleanly using Vercel serverless configurations (`vercel.json`)
* **Core Integrations:** Razorpay SDK, Meta WhatsApp Cloud API (`axios`/`form-data`), Nodemailer (SMTP Transporter), PDFKit

## ⚙️ Key Backend Architecture & Security Features
* **Asynchronous Capacity Enforcement:** Built a capacity gate inside the order-creation route (`POST /create-order`) that actively counts non-archived MongoDB documentation records before allowing order assembly, capping active seats securely at 30 per session.
* **Secure Webhook Signature Verification:** Implemented cryptographically secure SHA256 HMAC verifications inside payment confirmation webhooks (`POST /verify-payment`) to cross-examine Razorpay signatures prior to committing transaction payloads to the database.
* **Serverless File In-Memory Buffering:** Optimized pass generation using PDFKit to bundle binary code layers completely within memory buffers, safely ensuring serverless compatibility on Vercel without reliance on native OS filesystems.
* **Media Asset Caching Mechanism:** Integrated asset caching for communication loops. When a user pass is dynamically built, it uploads instantly to Meta and logs the immutable `whatsappMediaId` to the participant's schema record. This completely prevents redundant compute pipelines on repeat WhatsApp download triggers.
* **Administrative Batch Reset Route:** Built a secure administrative backend route (`POST /admin/reset-batch`) leveraging soft-archive flags to instantly transition database states, archiving past sessions cleanly while instantly reopening fresh batch cycles.