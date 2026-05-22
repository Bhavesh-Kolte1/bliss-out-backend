// utils/whatsapp.js
//
// Meta WhatsApp Cloud API utility module.
// Handles media upload, text messages, and document messages.
// All operations are buffer-based — no filesystem access required.
// Safe for Vercel Serverless Functions.

'use strict';

const axios     = require('axios');
const FormData  = require('form-data');

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const GRAPH_API_VERSION = 'v18.0';
const GRAPH_BASE_URL    = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/**
 * Returns the resolved base URL for the configured phone number ID.
 * Throws early if the env var is missing — catches misconfiguration at
 * call-time rather than silently sending to the wrong endpoint.
 */
function getPhoneNumberUrl() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneNumberId) {
    throw new Error('[whatsapp] Missing env var: WHATSAPP_PHONE_NUMBER_ID');
  }
  return `${GRAPH_BASE_URL}/${phoneNumberId}`;
}

/**
 * Returns the Bearer token for the Authorization header.
 * Throws early if the env var is missing.
 */
function getAuthHeader() {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) {
    throw new Error('[whatsapp] Missing env var: WHATSAPP_TOKEN');
  }
  return { Authorization: `Bearer ${token}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// ERROR HELPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts and logs the exact Meta API error details, then throws a clean
 * Error so the calling route receives a meaningful message without leaking
 * raw internals to the client.
 *
 * Meta nests its errors like:
 *   error.response.data.error.message
 *   error.response.data.error.error_data.details
 *
 * @param {Error}  err      - The Axios error object.
 * @param {string} context  - A short label describing which call failed.
 */
function handleApiError(err, context) {
  if (err.response) {
    // Meta returned a response, but with an error status code.
    const metaError = err.response.data?.error ?? err.response.data;

    console.error(`[whatsapp] ${context} failed — HTTP ${err.response.status}`);
    console.error('[whatsapp] Meta API error payload:', JSON.stringify(metaError, null, 2));

    // Surface the most useful part of Meta's error to the caller.
    const detail =
      metaError?.error_data?.details ??
      metaError?.message              ??
      `HTTP ${err.response.status}`;

    throw new Error(`[whatsapp] ${context}: ${detail}`);
  }

  // Network error, timeout, DNS failure, etc.
  console.error(`[whatsapp] ${context} — network error:`, err.message);
  throw new Error(`[whatsapp] ${context}: ${err.message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. uploadMedia
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Uploads an in-memory file buffer to the WhatsApp media endpoint.
 *
 * Meta requires a multipart/form-data POST with three fields:
 *   - messaging_product  → always 'whatsapp'
 *   - type               → the MIME type of the file
 *   - file               → the binary content with a filename
 *
 * On success, Meta returns a JSON object with a single `id` field.
 * This media ID is then referenced in document/image messages instead of
 * a public URL, keeping the PDF delivery self-contained.
 *
 * @param   {Buffer} buffer    - In-memory file content (e.g. from PDFKit).
 * @param   {string} filename  - The filename Meta will associate (e.g. 'pass.pdf').
 * @param   {string} mimeType  - MIME type (e.g. 'application/pdf').
 * @returns {Promise<string>}  - Resolves with the Meta media ID string.
 */
async function uploadMedia(buffer, filename, mimeType) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);

  // Passing knownLength tells form-data the exact byte count so it can
  // set the Content-Length header correctly — required by Meta's endpoint.
  form.append('file', buffer, {
    filename,
    contentType: mimeType,
    knownLength:  buffer.length,
  });

  try {
    const response = await axios.post(
      `${getPhoneNumberUrl()}/media`,
      form,
      {
        headers: {
          ...getAuthHeader(),
          ...form.getHeaders(), // includes Content-Type: multipart/form-data; boundary=...
        },
      }
    );

    const mediaId = response.data?.id;

    if (!mediaId) {
      // Unexpected shape — log what we received so it's easy to diagnose.
      console.error('[whatsapp] uploadMedia: unexpected response shape:', response.data);
      throw new Error('[whatsapp] uploadMedia: no media ID returned by Meta');
    }

    console.log(`[whatsapp] uploadMedia: success — mediaId=${mediaId}, file=${filename}`);
    return mediaId;

  } catch (err) {
    // Re-throw only if it's not already our own formatted error.
    if (err.message.startsWith('[whatsapp]') && !err.response) throw err;
    handleApiError(err, 'uploadMedia');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. sendWhatsAppText
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends a plain-text WhatsApp message to a single recipient.
 *
 * The `to` number must be in E.164 format without the leading '+'.
 * For example: '919876543210' (country code 91 + 10-digit Indian number).
 *
 * @param   {string} to       - Recipient's phone number (E.164, no '+').
 * @param   {string} message  - The text body to send.
 * @returns {Promise<object>} - Resolves with Meta's response data.
 */
async function sendWhatsAppText(to, message) {
  // Normalise: strip spaces, dashes, and the leading '+' if present.
  const normalised = String(to).replace(/[\s\-\+]/g, '');

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                normalised,
    type:              'text',
    text: {
      preview_url: false, // set true if the message contains a URL to preview
      body:        message,
    },
  };

  try {
    const response = await axios.post(
      `${getPhoneNumberUrl()}/messages`,
      payload,
      { headers: { ...getAuthHeader(), 'Content-Type': 'application/json' } }
    );

    console.log(`[whatsapp] sendWhatsAppText: delivered to ${normalised}`);
    return response.data;

  } catch (err) {
    handleApiError(err, 'sendWhatsAppText');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. sendWhatsAppDocument
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends a previously-uploaded document (PDF, etc.) to a recipient via
 * its Meta media ID. The document renders inline in WhatsApp with a
 * downloadable filename and an optional caption beneath it.
 *
 * Workflow:
 *   1. Generate PDF in-memory  →  Buffer
 *   2. uploadMedia(buffer, …)  →  mediaId
 *   3. sendWhatsAppDocument(to, mediaId, filename, caption)
 *
 * @param   {string} to        - Recipient's phone number (E.164, no '+').
 * @param   {string} mediaId   - The ID returned by uploadMedia().
 * @param   {string} filename  - Filename shown to the recipient (e.g. 'your-pass.pdf').
 * @param   {string} caption   - Short text displayed below the document.
 * @returns {Promise<object>}  - Resolves with Meta's response data.
 */
async function sendWhatsAppDocument(to, mediaId, filename, caption) {
  const normalised = String(to).replace(/[\s\-\+]/g, '');

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                normalised,
    type:              'document',
    document: {
      id:       mediaId,   // reference the pre-uploaded buffer — no public URL needed
      filename,
      caption,
    },
  };

  try {
    const response = await axios.post(
      `${getPhoneNumberUrl()}/messages`,
      payload,
      { headers: { ...getAuthHeader(), 'Content-Type': 'application/json' } }
    );

    console.log(`[whatsapp] sendWhatsAppDocument: sent "${filename}" to ${normalised}`);
    return response.data;

  } catch (err) {
    handleApiError(err, 'sendWhatsAppDocument');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  uploadMedia,
  sendWhatsAppText,
  sendWhatsAppDocument,
};