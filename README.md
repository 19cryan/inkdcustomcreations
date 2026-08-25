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

Base prices, size/brand upcharges, and bulk discount tiers live in the
`<script>` block near the bottom of `public/index.html` (look for
`basePrices`, `bulkMultiplier`, and `computePricing`/`computeShirtPricing`).
Bulk tiers: 15+ items save 5% per item, 50+ save 10%, 100+ save 15% — applied
across the whole order, including mixed shirt sizes.

## Auto-emailing orders to your shop inbox

Whenever someone pays or requests a quote, the site sends a real email to
your shop inbox with their contact info, pickup/shipping details, and (for
custom designs) the front/back artwork attached as actual PNG files — no
more relying on the customer's own email app.

This uses a free Gmail "app password", not your real Gmail password. It can
be set up on any Gmail account you control — it doesn't have to be
`inkdcustomcreations@gmail.com` itself:

1. Turn on 2-Step Verification at https://myaccount.google.com/security
2. Go to https://myaccount.google.com/apppasswords and create one — name it
   something like "Ink'd Website"
3. Copy the 16-character code it gives you

Then set three environment variables (in `.env` locally, or in Render's
dashboard for the live site):

```
EMAIL_USER=whichever-gmail-you-made-the-app-password-with@gmail.com
EMAIL_APP_PASSWORD=the16characteryoujustcopied
ORDER_NOTIFICATION_EMAIL=inkdcustomcreations@gmail.com
```

`EMAIL_USER` is only used to log in and send the email — `ORDER_NOTIFICATION_EMAIL`
is where orders actually land. If you skip `ORDER_NOTIFICATION_EMAIL`, orders
go to `EMAIL_USER` instead, so set it explicitly if those two should be
different accounts.

If none of these are set, the rest of the site still works fine — Square
checkout, the design tool, everything — it just can't auto-email orders
until you add them. You'll see a warning in the server logs reminding you.

## Files

```
public/index.html   the whole website (home, about, explore, shop, create/checkout)
public/images/       logo + product photos
server.js            Express server: Square payment endpoint + order email endpoint
package.json         dependencies
.env.example          template for required secrets — copy to .env
```
