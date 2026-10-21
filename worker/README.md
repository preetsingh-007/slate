# Slate fetch helper

A stateless [Cloudflare Worker](https://developers.cloudflare.com/workers/) that downloads one web page for **New from link**. The app cannot read other sites from the browser, so it asks this helper. The helper:

- accepts `GET /?url=<encoded URL>` with the header `X-Slate-Key: <secret>`;
- fetches http and https URLs only, following at most 5 redirects;
- refuses private and local network addresses, checking every redirect and the DNS records of each host;
- stops at 10 MB and 15 seconds;
- logs nothing.

## Deploy (once, free tier)

1. Create a free Cloudflare account and install Node 20 or later.
2. In this folder:

   ```sh
   npx wrangler login
   npx wrangler deploy
   ```

   Wrangler prints the helper's URL, for example `https://slate-fetch.<your-subdomain>.workers.dev`.
3. Choose a long random secret (for example `openssl rand -hex 24`) and store it:

   ```sh
   npx wrangler secret put SLATE_KEY
   ```

4. If the app is not served from `https://preetsingh-007.github.io`, change `ALLOWED_ORIGINS` in `wrangler.toml` and deploy again.
5. In Slate, open **Settings → Fetch helper** and enter the URL and the secret. Both stay on the device.

The app's Content Security Policy allows connections to `*.workers.dev`. A helper on a custom domain needs that domain added to `connect-src` in `vite.config.ts`.

## Test

From the repository root: `npx vitest run worker`.
