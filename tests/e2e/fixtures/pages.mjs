// Fixture web pages for New from link (L8, L10), shared by Vitest (src/core/library) and the
// e2e test server (tests/e2e/routes/30-library.mjs). Paths are relative to the site root.

/** A 1×1 PNG (red). */
export const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

/** An arXiv-like HTML paper (LaTeXML output): MathML with TeX annotations, a figure, CSS. */
export const ARXIV_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>[2401.01234] Spectral Methods for Study Graphs</title>
<meta name="citation_title" content="Spectral Methods for Study Graphs">
<meta name="citation_author" content="Lovelace, Ada">
<meta name="citation_author" content="Turing, Alan">
<meta name="citation_date" content="2024/01/05">
<meta name="citation_pdf_url" content="/pdf/2401.01234v1">
<meta property="og:site_name" content="arXiv.org">
<link rel="canonical" href="https://arxiv.org/abs/2401.01234v1">
<link rel="stylesheet" href="/static/ltx-article.css">
</head>
<body>
<div class="ltx_page_main"><div class="ltx_page_content">
<article class="ltx_document ltx_authors_1line">
<h1 class="ltx_title ltx_title_document">Spectral Methods for Study Graphs</h1>
<div class="ltx_authors"><span class="ltx_creator ltx_role_author"><span class="ltx_personname">Ada Lovelace, Alan Turing</span></span></div>
<div class="ltx_abstract"><h6 class="ltx_title ltx_title_abstract">Abstract</h6>
<p class="ltx_p">We study the Laplacian <math alttext="L=D-A" class="ltx_Math" display="inline" id="m1"><semantics><mrow><mi>L</mi><mo>=</mo><mrow><mi>D</mi><mo>−</mo><mi>A</mi></mrow></mrow><annotation encoding="application/x-tex">L=D-A</annotation></semantics></math> of a study graph and show that its spectrum reveals the structure of a syllabus.</p></div>
<section class="ltx_section" id="S1"><h2 class="ltx_title ltx_title_section"><span class="ltx_tag ltx_tag_section">1 </span>Introduction</h2>
<div class="ltx_para" id="S1.p1"><p class="ltx_p">Students connect topics as they learn. The eigenvalues <math alttext="\\lambda_{1}\\leq\\lambda_{2}" class="ltx_Math" display="inline"><semantics><mrow><msub><mi>λ</mi><mn>1</mn></msub><mo>≤</mo><msub><mi>λ</mi><mn>2</mn></msub></mrow><annotation encoding="application/x-tex">\\lambda_{1}\\leq\\lambda_{2}</annotation></semantics></math> of the graph Laplacian measure how well connected the material is, and the Fiedler vector splits a course into two halves of roughly equal size.</p></div>
<table class="ltx_equation ltx_eqn_table" id="S1.E1"><tbody><tr class="ltx_equation ltx_eqn_row"><td class="ltx_eqn_cell ltx_align_center"><math alttext="\\lambda_{2}=\\min_{x\\perp\\mathbf{1}}\\frac{x^{\\top}Lx}{x^{\\top}x}" class="ltx_Math" display="block"><semantics><mrow><mi>λ</mi></mrow><annotation encoding="application/x-tex">\\lambda_{2}=\\min_{x\\perp\\mathbf{1}}\\frac{x^{\\top}Lx}{x^{\\top}x}</annotation></semantics></math></td></tr></tbody></table>
<figure class="ltx_figure" id="S1.F1"><img src="x1.png" class="ltx_graphics" alt="A study graph with two clusters" width="200" height="100"><figcaption class="ltx_caption">Figure 1: A study graph with two clusters.</figcaption></figure>
<div class="ltx_para"><p class="ltx_p">See <a href="#S2" class="ltx_ref">Section 2</a> and the <a href="https://example.org/data">data set</a>. Each paragraph here is long enough for Readability to treat the page as an article rather than navigation, which needs some prose.</p></div>
</section>
<section class="ltx_section" id="S2"><h2 class="ltx_title ltx_title_section"><span class="ltx_tag ltx_tag_section">2 </span>Method</h2>
<div class="ltx_para"><p class="ltx_p">We compute the spectrum with the Lanczos method and cluster topics by the signs of the Fiedler vector, which takes a fraction of a second for a typical syllabus of a few hundred topics.</p></div>
</section>
</article></div></div>
<script>document.body.dataset.scripted = 'yes';</script>
</body></html>`;

export const ARXIV_CSS = `.ltx_title { font-family: serif; color: rgb(20, 40, 160); }
@font-face { font-family: "LTX"; src: url("fonts/ltx.woff2") format("woff2"); }
.ltx_page_main { background: url('../img/paper.png') repeat; }`;

/** A blog article with responsive and lazy images, a stylesheet and metadata (L9). */
export const BLOG_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Why spaced repetition works | The Study Blog</title>
<meta property="og:title" content="Why spaced repetition works">
<meta property="og:site_name" content="The Study Blog">
<meta name="author" content="Grace Hopper">
<meta property="article:published_time" content="2026-09-30T08:00:00Z">
<link rel="canonical" href="/posts/spaced-repetition">
<meta http-equiv="refresh" content="30; url=https://evil.example/">
<link rel="stylesheet" href="/static/blog.css">
<style>.hero { background-image: url("/img/hero.png"); }</style>
</head><body>
<nav><a href="/">Home</a> <a href="/about">About</a></nav>
<main><article>
<h1>Why spaced repetition works</h1>
<p class="byline">By Grace Hopper</p>
<p>Memory decays, but every successful recall makes the next decay slower. Reviewing just before you would forget is the cheapest way to keep a fact: the <em>spacing effect</em> has been replicated for more than a century.</p>
<p><img srcset="/img/curve-400.png 400w, /img/curve-800.png 800w" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Forgetting curve"></p>
<p><img data-src="/img/lazy.png" alt="Review schedule"></p>
<h2>How to use it</h2>
<ul><li>Write one fact per card.</li><li>Review every day, a little.</li></ul>
<p>Read the <a href="/posts/flashcards">guide to flashcards</a> next. The rest of this paragraph is long enough to look like an article to Readability, which scores paragraphs by length and commas.</p>
</article></main>
<script src="/static/app.js"></script>
</body></html>`;

export const BLOG_CSS = 'body { font-family: Georgia, serif; } h1 { color: rgb(160, 30, 30); }';

/** A Cloudflare-style bot check page. */
export const BOT_CHECK_HTML = `<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><div id="challenge-platform"><noscript>Enable JavaScript and cookies to continue</noscript></div><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>`;

/** A sign-in wall. */
export const LOGIN_HTML = `<!DOCTYPE html><html><head><title>Sign in</title></head><body><form><input type="email"><input type="password"><button>Sign in</button></form></body></html>`;

/** A paywalled article. */
export const PAYWALL_HTML = `<!DOCTYPE html><html><head><title>Big story</title></head><body><article><h1>Big story</h1><p>The first lines are free.</p><div class="paywall">Subscribe to continue reading.</div></article></body></html>`;
