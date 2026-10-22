// Library fixtures for e2e tests (L8, L10): a fake fetch helper at /helper/ implementing the
// helper's protocol (GET /?url=… with X-Slate-Key; upstream body with X-Upstream-Status,
// X-Final-Url, Content-Type) over a simulated web of fixture pages, so no test touches the
// network. The same pages are served directly under /site/ for debugging.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { ARXIV_CSS, ARXIV_HTML, BLOG_CSS, BLOG_HTML, BOT_CHECK_HTML, LOGIN_HTML, PAYWALL_HTML, PNG_BASE64 } from '../fixtures/pages.mjs';

export const HELPER_KEY = 'e2e-key';

const png = Buffer.from(PNG_BASE64, 'base64');

async function makePdf(title, lines) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor('Ada Lovelace; Alan Turing');
  doc.setCreationDate(new Date(Date.UTC(2024, 0, 5)));
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  for (let p = 0; p < 2; p++) {
    const page = doc.addPage([612, 792]);
    page.drawText(p === 0 ? title : `Page ${p + 1}`, { x: 72, y: 700, size: 18, font });
    lines.forEach((l, i) => page.drawText(l, { x: 72, y: 660 - i * 14, size: 11, font }));
  }
  return Buffer.from(await doc.save());
}

const arxivPdf = await makePdf('Spectral Methods for Study Graphs', ['We study the Laplacian of a study graph.', 'Its spectrum reveals the structure of a syllabus.']);
const plainPdf = await makePdf('Lecture Notes on Rank', ['The rank of a matrix is the dimension of its column space.']);

const ABS_HTML = `<!DOCTYPE html><html><head><title>[2401.01234] Spectral Methods for Study Graphs</title>
<meta name="citation_title" content="Spectral Methods for Study Graphs"><meta name="citation_pdf_url" content="https://arxiv.org/pdf/2401.01234v1"></head>
<body><h1>Spectral Methods for Study Graphs</h1><blockquote class="abstract">We study the Laplacian of a study graph and show that its spectrum reveals the structure of a syllabus, which helps students plan their revision with a little linear algebra.</blockquote></body></html>`;

/** The simulated web: URL → response. */
const WEB = {
  'https://arxiv.org/html/2401.01234': { redirect: 'https://arxiv.org/html/2401.01234v1/' },
  'https://arxiv.org/html/2401.01234v1/': { type: 'text/html; charset=utf-8', body: ARXIV_HTML },
  'https://arxiv.org/static/ltx-article.css': { type: 'text/css', body: ARXIV_CSS },
  'https://arxiv.org/static/fonts/ltx.woff2': { type: 'font/woff2', body: Buffer.from([0x77, 0x4f, 0x46, 0x32]) },
  'https://arxiv.org/img/paper.png': { type: 'image/png', body: png },
  'https://arxiv.org/html/2401.01234v1/x1.png': { type: 'image/png', body: png },
  'https://arxiv.org/abs/2401.01234v1': { type: 'text/html', body: ABS_HTML },
  'https://arxiv.org/pdf/2401.01234v1': { type: 'application/pdf', body: arxivPdf },
  'https://blog.example/posts/spaced-repetition': { type: 'text/html', body: BLOG_HTML },
  'https://blog.example/static/blog.css': { type: 'text/css', body: BLOG_CSS },
  'https://blog.example/static/app.js': { type: 'application/javascript', body: 'document.body.dataset.scripted = "yes";' },
  'https://blog.example/img/curve-800.png': { type: 'image/png', body: png },
  'https://blog.example/img/lazy.png': { type: 'image/png', body: png },
  'https://blog.example/img/hero.png': { type: 'image/png', body: png },
  'https://notes.example/rank.pdf': { type: 'application/pdf', body: plainPdf },
  'https://x.example/bot': { status: 403, type: 'text/html', body: BOT_CHECK_HTML },
  'https://x.example/login': { status: 200, type: 'text/html', body: LOGIN_HTML },
  'https://x.example/paywall': { status: 200, type: 'text/html', body: PAYWALL_HTML },
};

export async function handle(req, res, url) {
  if (url.pathname === '/helper/' || url.pathname === '/helper') {
    if (req.headers['x-slate-key'] !== HELPER_KEY) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or wrong X-Slate-Key header.' }));
      return true;
    }
    let target = url.searchParams.get('url') ?? '';
    for (let hop = 0; hop < 5 && WEB[target]?.redirect; hop++) target = WEB[target].redirect;
    const page = WEB[target];
    if (!page) {
      res.writeHead(200, { 'Content-Type': 'text/html', 'X-Upstream-Status': '404', 'X-Final-Url': target });
      res.end('<h1>Not found</h1>');
      return true;
    }
    // a little latency, like the real helper
    await new Promise((r) => setTimeout(r, 20));
    res.writeHead(200, { 'Content-Type': page.type, 'X-Upstream-Status': String(page.status ?? 200), 'X-Final-Url': target, 'Cache-Control': 'no-store' });
    res.end(page.body);
    return true;
  }
  if (url.pathname.startsWith('/site/')) {
    const target = `https://${url.pathname.slice('/site/'.length)}`;
    const page = WEB[target];
    if (!page || page.redirect) return false;
    res.writeHead(page.status ?? 200, { 'Content-Type': page.type });
    res.end(page.body);
    return true;
  }
  return false;
}
