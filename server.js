// Ink'd Custom Creations — backend server
// Serves the website (public/) and provides:
//   /api/create-payment    charges a card through Square using the card nonce from the browser
//   /api/send-order-email  emails the shop inbox with order, customer, and shipping details,
//                           with the customer's design attached as real image files
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

function dataUrlToAttachment(dataUrl, filename) {
  if (!dataUrl) return null;
  const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!match) return null;
  return { name: filename, content: match[1] }; // Brevo wants raw base64, no data: prefix
}

async function sendViaBrevo({ customer, subject, text, attachments }) {
  if (!process.env.BREVO_API_KEY) throw new Error('BREVO_API_KEY is not set.');
  if (!process.env.EMAIL_USER) throw new Error('EMAIL_USER (verified Brevo sender) is not set.');

  const body = {
    sender: { email: process.env.EMAIL_USER, name: "Ink'd Custom Creations Website" },
    to: [{ email: process.env.ORDER_NOTIFICATION_EMAIL || process.env.EMAIL_USER }],
    replyTo: { email: customer.email, name: customer.name },
    subject,
    textContent: text,
  };
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

app.post('/api/send-order-email', async (req, res) => {
  try {
    const { type, customer, order, design } = req.body || {};
    if (!customer || !customer.name || !customer.email) {
      return res.status(400).json({ success: false, error: 'Missing customer name or email.' });
    }

    const fulfillmentLine =
      customer.fulfillment === 'shipping'
        ? `Shipping to: ${customer.street}, ${customer.city}, ${customer.state} ${customer.zip}`
        : 'Pickup in Bainbridge, OH';

    const sizeLine = order && order.breakdown && order.breakdown.length
      ? `Sizes: ${order.breakdown.join(', ')}\n`
      : '';

    const subjectPrefix = type === 'paid' ? 'PAID ORDER' : 'Quote request';
    const subject = `${subjectPrefix} - ${order.label} (${customer.name})`;

    const text =
      `${type === 'paid' ? 'A payment just came through' : 'Someone requested a quote'} on the website.\n\n` +
      `Customer: ${customer.name}\n` +
      `Email: ${customer.email}\n` +
      `Phone: ${customer.phone || '(not provided)'}\n` +
      `${fulfillmentLine}\n\n` +
      `Item: ${order.label}\n` +
      `Quantity: ${order.qty}\n` +
      `${sizeLine}` +
      (order.total !== null && order.total !== undefined ? `Total: $${Number(order.total).toFixed(2)}\n` : 'Total: contact for quote\n') +
      (order.baseColor ? `Base color: ${order.baseColor}\n` : '');

    const attachments = [];
    const frontAttachment = dataUrlToAttachment(design && design.front, 'design-front.png');
    const backAttachment = dataUrlToAttachment(design && design.back, 'design-back.png');
    if (frontAttachment) attachments.push(frontAttachment);
    if (backAttachment) attachments.push(backAttachment);

    await sendViaBrevo({ customer, subject, text, attachments });

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
