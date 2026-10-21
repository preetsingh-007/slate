# Slate

An installable web app for capturing study work: an infinite canvas for ink, typed text and images; a library of books and clippings in a side pane; a lasso that carries content from any source onto the canvas with a link back to its exact location; and storage in your [gym](https://github.com/preetsingh-007/gym) repository on GitHub.

Slate runs entirely in the browser, works offline, and costs nothing beyond free tiers: GitHub Pages hosts it, the GitHub API stores your data, and one Cloudflare Worker fetches web pages for **New from link**.

## Use

Open the app at `https://preetsingh-007.github.io/slate/` in Safari on iPad and choose **Share → Add to Home Screen**. On first run Slate asks for a GitHub token limited to your gym repository and shows how to create one.

## Develop

```sh
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests
npm run test:e2e     # Playwright (desktop and tablet profiles)
npm run test:gym     # gym's check.py on the app's sync output
npm run build
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the code layout and storage contract, and [worker/README.md](worker/README.md) to deploy the fetch helper.

## Deploy

1. In the repository settings, set **Pages → Source** to **GitHub Actions**. Pushes to the default branch deploy the app.
2. Deploy the fetch helper once: [worker/README.md](worker/README.md).
