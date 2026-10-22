# Slate fetch helper

A stateless [Cloudflare Worker](https://developers.cloudflare.com/workers/) that downloads one web page for **New from link**. The app cannot read other sites from the browser, so it asks this helper. The helper:

- accepts `GET /?url=<encoded URL>` with the header `X-Slate-Key: <secret>`;
- fetches http and https URLs only, following at most 5 redirects;
- refuses private and local network addresses, checking every redirect and the DNS records of each host;
- stops at 10 MB and 15 seconds;
- logs nothing.

### Residual risk: DNS rebinding

The helper resolves each host (DNS over HTTPS) and refuses it when any address is private, including IPv6 forms that embed an IPv4 address (`::a.b.c.d`, `::ffff:a.b.c.d`, 6to4 `2002::/16`, Teredo `2001::/32`, NAT64). The fetch itself then resolves the name again, and a Worker cannot pin the connection to the address that was checked. A host whose DNS answers change between the two lookups (DNS rebinding) could therefore point the fetch at another address. On Cloudflare's network such a fetch cannot reach your own machine or local network, only addresses reachable from Cloudflare; the key (`X-Slate-Key`) and the origin check keep the helper to your own app. Do not deploy the helper where it can reach private services (for example as a self-hosted Worker inside a private network).

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
