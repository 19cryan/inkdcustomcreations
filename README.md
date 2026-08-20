# Ink'd Custom Creations — Website with Square Checkout

This is a full site + backend: a Node/Express server serves the website
(the `public/` folder) and exposes one API route, `/api/create-payment`,
that actually charges a card through Square.

The card number itself never touches your server — Square's script in the
browser turns it into a one-time-use token ("nonce") first. Your server only
ever sees that token plus the dollar amount, and uses your **secret** Access
Token to ask Square to charge it. That secret must never appear in
`index.html` or any file the browser can see — it only goes in `.env` /
your hosting provider's environment variable settings.

## 1. Get your Square credentials

Go to https://developer.squareup.com/apps and either use an existing
application or create a new one. Inside it you'll find two tabs, **Sandbox**
and **Production** — each has its own set of these four values:

| Value | Where it's used | Secret? |
|---|---|---|
| Application ID | `public/index.html` (`SQUARE_APP_ID`) | No — safe in browser code |
| Location ID | Both `index.html` and `.env` | No — safe in browser code |
| Access Token | `.env` only | **Yes — never expose this** |

Start with the **Sandbox** values so you can test with fake cards before any
real money moves.

## 2. Configure the project

```bash
npm install
cp .env.example .env
```

Edit `.env` and fill in `SQUARE_ACCESS_TOKEN` and `SQUARE_LOCATION_ID` with
your Sandbox values. Leave `SQUARE_ENVIRONMENT=sandbox`.

Then open `public/index.html`, find these two lines near the bottom of the
`<script>` block, and fill in your Sandbox Application ID and Location ID:

```js
const SQUARE_APP_ID = 'REPLACE_WITH_YOUR_SQUARE_APPLICATION_ID';
const SQUARE_LOCATION_ID = 'REPLACE_WITH_YOUR_SQUARE_LOCATION_ID';
```

## 3. Run it locally

```bash
npm start
```

Visit `http://localhost:3000`, scroll to the Create section, and try a test
payment. Use one of Square's sandbox test cards, e.g.:

- Card number: `4111 1111 1111 1111`
- Expiration: any future date
- CVV: any 3 digits
- ZIP: any 5 digits

You should see "Payment successful" and a confirmation ID. You can find the
test payment in your Square Sandbox dashboard.

## 4. Go live

1. In the Square Developer Dashboard, switch to the **Production** tab and
   copy that Application ID, Location ID, and Access Token.
2. Update `public/index.html` with the production Application ID and
   Location ID.
3. Update your hosting provider's environment variables (or your `.env` if
   self-hosting) with the production `SQUARE_ACCESS_TOKEN` and
   `SQUARE_LOCATION_ID`, and set `SQUARE_ENVIRONMENT=production`.
4. In `public/index.html`, change the Square SDK script tag in `<head>`
   from the sandbox URL to the production one:

   ```html
   <!-- from -->
   <script src="https://sandbox.web.squarecdn.com/v1/square.js"></script>
   <!-- to -->
   <script src="https://web.squarecdn.com/v1/square.js"></script>
   ```

5. In the Square Developer Dashboard, add your live domain to the
   application's list of allowed domains (required for Square's card form
   to load on your site).

## 5. Deploying

This needs to run somewhere that keeps a Node process alive (not a static
host like GitHub Pages). Easy options: Render, Railway, or Fly.io all have
straightforward free/low-cost tiers.

General steps (Render as an example):

1. Push this whole folder to a GitHub repo.
2. In Render, create a new **Web Service** from that repo.
3. Build command: `npm install` — Start command: `npm start`.
4. Add the four `.env` values as environment variables in Render's dashboard
   (not committed to the repo).
5. Once deployed, point your domain (e.g. inkdcustomcreations.com) at the
   Render URL, or use the free subdomain Render gives you.

## Pricing logic

Base prices and bulk discounts live near the bottom of `public/index.html`:

```js
const basePrices = { tshirt:17, hoodie:32, hat:20, tumbler:25, wallet:35, vinyl:10, sign:25, banner:35 };
```

Discount tiers: 2+ items save 5% per item, 6+ save 10%, 12+ save 20%. Adjust
either the base prices or the `unitPriceFor()` function to match your real
pricing.

## Files

```
public/index.html   the whole website (home, about, explore, create/checkout)
public/images/       logo + product photos
server.js            Express server + Square payment endpoint
package.json         dependencies
.env.example          template for required secrets — copy to .env
```
