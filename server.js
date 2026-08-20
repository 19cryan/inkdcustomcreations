// Ink'd Custom Creations — backend server
// Serves the website (public/) and provides a /api/create-payment endpoint
// that charges a card through Square using the card nonce created in the browser.
//
// SECURITY NOTE: SQUARE_ACCESS_TOKEN is a secret. It must only ever live here,
// in server-side environment variables. Never put it in index.html or any
// client-side code.

require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { Client, Environment } = require('square');

const app = express();
app.use(express.json());
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Ink'd Custom Creations site running at http://localhost:${PORT}`);
  console.log(`Square environment: ${environment}`);
});
