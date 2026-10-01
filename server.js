// Ink'd Custom Creations — backend server
// Serves the website (public/) and provides:
//   /api/create-payment    charges a card through Square using the card nonce from the browser
//   /api/send-order-email  emails the shop inbox with order, customer, and shipping details
//                           (with the customer's original uploaded artwork AND a placement
//                           preview attached as real image files), and sends the customer a
//                           confirmation email with the same details/attachments.
//
// Email is sent via Brevo's HTTP API rather than SMTP - Render's free tier blocks outbound
// SMTP ports (25/465/587), but a normal HTTPS API call like this works fine.
//
// SECURITY NOTE: SQUARE_ACCESS_TOKEN and BREVO_API_KEY are secrets. They must only ever
// live here, in server-side environment variables. Never put them in index.html or any
// client-side code.

require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { Client, Environment } = require('square');

const app = express();
app.use(express.json({ limit: '15mb' })); // design images are base64 PNGs, raise the default limit
app.use(express.static('public'));

const environment =
  (process.env.SQUARE_ENVIRONMENT || 'sandbox').toLowerCase() === 'production'
    ? Environment.Production
    : Environment.Sandbox;

const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment,
});

app.post('/api/create-payment', async (req, res) => {
  try {
    const { nonce, amount, note } = req.body;

    if (!nonce || !amount) {
      return res.status(400).json({ success: false, error: 'Missing nonce or amount.' });
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid amount.' });
    }

    const response = await squareClient.paymentsApi.createPayment({
      sourceId: nonce,
      idempotencyKey: crypto.randomUUID(),
      amountMoney: {
        amount: BigInt(amount), // amount in the smallest currency unit (cents for USD)
        currency: 'USD',
      },
      locationId: process.env.SQUARE_LOCATION_ID,
      note: note || 'Ink\'d Custom Creations order',
    });

    // BigInt values from the Square SDK don't survive JSON.stringify by default.
    const payment = JSON.parse(
      JSON.stringify(response.result.payment, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      )
    );

    res.json({ success: true, payment });
  } catch (err) {
    console.error('Square payment error:', err);
    const message =
      err.errors && err.errors[0] && err.errors[0].detail
        ? err.errors[0].detail
        : err.message || 'Payment failed.';
    res.status(500).json({ success: false, error: message });
  }
});

// ---------- EMAIL (Brevo HTTP API) ----------
if (!process.env.BREVO_API_KEY || !process.env.EMAIL_USER) {
  console.warn(
    'BREVO_API_KEY / EMAIL_USER not set - /api/send-order-email will not be able to send mail until these are configured.'
  );
}

function dataUrlToAttachment(dataUrl, filenameBase) {
  if (!dataUrl) return null;
  // Uploaded artwork can be any common image type, not just PNG (the canvas composite is always PNG,
  // but the customer's original upload could be jpeg/png/webp/gif/etc.)
  const match = dataUrl.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  let ext = match[1].toLowerCase();
  if (ext === 'jpeg') ext = 'jpg';
  return { name: `${filenameBase}.${ext}`, content: match[2] }; // Brevo wants raw base64, no data: prefix
}

async function sendViaBrevo({ toEmail, toName, replyTo, subject, text, attachments }) {
  if (!process.env.BREVO_API_KEY) throw new Error('BREVO_API_KEY is not set.');
  if (!process.env.EMAIL_USER) throw new Error('EMAIL_USER (verified Brevo sender) is not set.');

  const body = {
    sender: { email: process.env.EMAIL_USER, name: "Ink'd Custom Creations" },
    to: [{ email: toEmail, name: toName || undefined }],
    subject,
    textContent: text,
  };
  if (replyTo) body.replyTo = replyTo;
  if (attachments && attachments.length) {
    body.attachment = attachments;
  }

  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Brevo API error (${resp.status}): ${errText}`);
  }
  return resp.json();
}

function buildItemLines(items) {
  return items.map((item, idx) => {
    const sizeLine = item.breakdown && item.breakdown.length ? `\n   Sizes: ${item.breakdown.join(', ')}` : '';
    const colorLine = item.baseColor ? `\n   Base color: ${item.baseColor}` : '';
    const noteLine = item.placementNote ? `\n   Placement notes: ${item.placementNote}` : '';
    const totalLine = (item.total !== null && item.total !== undefined)
      ? `$${Number(item.total).toFixed(2)}`
      : 'contact for quote';
    return `${idx + 1}. ${item.label} x${item.qty} - ${totalLine}${sizeLine}${colorLine}${noteLine}`;
  }).join('\n');
}

function buildAttachments(items) {
  const attachments = [];
  items.forEach((item, idx) => {
    const suffix = items.length > 1 ? `-item${idx + 1}` : '';
    // The original file(s) the customer uploaded - the actual art to print from.
    (item.uploadedImages || []).forEach((img, imgIdx) => {
      const imgSuffix = (item.uploadedImages.length > 1) ? `-${imgIdx + 1}` : '';
      const att = dataUrlToAttachment(img.dataUrl, `uploaded-artwork${suffix}-${img.side}${imgSuffix}`);
      if (att) attachments.push(att);
    });
    // A preview of where they placed it on the product, for reference.
    const frontPreview = dataUrlToAttachment(item.design && item.design.front, `placement-preview-front${suffix}`);
    const backPreview = dataUrlToAttachment(item.design && item.design.back, `placement-preview-back${suffix}`);
    if (frontPreview) attachments.push(frontPreview);
    if (backPreview) attachments.push(backPreview);
  });
  return attachments;
}

app.post('/api/send-order-email', async (req, res) => {
  try {
    const { type, customer, items } = req.body || {};
    if (!customer || !customer.name || !customer.email) {
      return res.status(400).json({ success: false, error: 'Missing customer name or email.' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'No items to send.' });
    }

    const fulfillmentLine =
      customer.fulfillment === 'shipping'
        ? `Shipping to: ${customer.street}, ${customer.city}, ${customer.state} ${customer.zip}`
        : 'Pickup in Bainbridge, OH';

    const cartTotal = items.reduce((sum, it) => sum + (typeof it.total === 'number' ? it.total : 0), 0);
    const itemLines = buildItemLines(items);
    const attachments = buildAttachments(items);

    const firstLabel = items[0].label + (items.length > 1 ? ` + ${items.length - 1} more` : '');
    const subjectPrefix = type === 'paid' ? 'PAID ORDER' : 'Quote request';
    const shopSubject = `${subjectPrefix} - ${firstLabel} (${customer.name})`;

    const shopText =
      `${type === 'paid' ? 'A payment just came through' : 'Someone requested a quote'} on the website.\n\n` +
      `Customer: ${customer.name}\n` +
      `Email: ${customer.email}\n` +
      `Phone: ${customer.phone || '(not provided)'}\n` +
      `${fulfillmentLine}\n\n` +
      `Items:\n${itemLines}\n\n` +
      `Cart total: $${cartTotal.toFixed(2)}\n`;

    // Shop notification - this is the one that matters most, so its failure is reported to the caller.
    await sendViaBrevo({
      toEmail: process.env.ORDER_NOTIFICATION_EMAIL || process.env.EMAIL_USER,
      replyTo: { email: customer.email, name: customer.name },
      subject: shopSubject,
      text: shopText,
      attachments,
    });

    // Customer confirmation - best-effort, doesn't fail the request if it can't send.
    try {
      const customerSubject = type === 'paid'
        ? "Thanks for your order - Ink'd Custom Creations"
        : "We got your quote request - Ink'd Custom Creations";
      const customerText =
        `Hi ${customer.name},\n\n` +
        `${type === 'paid'
          ? "Thanks for your order! Here's a copy of what you ordered:"
          : "Thanks for reaching out! Here's a copy of what you asked about - we'll follow up with a quote soon."}\n\n` +
        `Items:\n${itemLines}\n\n` +
        `${type === 'paid' ? `Total paid: $${cartTotal.toFixed(2)}\n\n` : ''}` +
        `${fulfillmentLine}\n\n` +
        `If anything above needs to change, just reply to this email.\n\n` +
        `- Ink'd Custom Creations\nBainbridge, OH\n(740) 466-7488`;

      await sendViaBrevo({
        toEmail: customer.email,
        toName: customer.name,
        subject: customerSubject,
        text: customerText,
        attachments,
      });
    } catch (confirmErr) {
      console.error('Customer confirmation email error (order still recorded):', confirmErr);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Send order email error:', err);
    res.status(500).json({ success: false, error: err.message || 'Could not send email.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Ink'd Custom Creations site running at http://localhost:${PORT}`);
  console.log(`Square environment: ${environment}`);
});
