/**
 * Fixture documents generated in tests (Vitest and Playwright): a two-column paper and a
 * long book as PDFs (pdf-lib), and an EPUB 3 book (JSZip). Deterministic output.
 */
import JSZip from 'jszip';
import { PDFDocument, PDFHexString, PDFName, PDFNumber, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';

const FIXED_DATE = new Date(Date.UTC(2024, 2, 15, 12, 0, 0));

/** Word-wrap; words containing "|" may be hyphenated at that point. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width;
  for (const word of words) {
    const plain = word.replace(/\|/g, '');
    const cand = cur ? `${cur} ${plain}` : plain;
    if (fits(cand)) {
      cur = cand;
      continue;
    }
    if (word.includes('|')) {
      const parts = word.split('|');
      let done = false;
      for (let k = parts.length - 1; k >= 1; k--) {
        const head = parts.slice(0, k).join('') + '-';
        const c2 = cur ? `${cur} ${head}` : head;
        if (fits(c2)) {
          lines.push(c2);
          cur = parts.slice(k).join('');
          done = true;
          break;
        }
      }
      if (done) continue;
    }
    if (cur) lines.push(cur);
    cur = plain;
  }
  if (cur) lines.push(cur);
  return lines;
}

interface OutlineEntry {
  title: string;
  /** 0-based page */
  page: number;
  children?: OutlineEntry[];
}

/** Adds a document outline (bookmarks) pointing at pages. */
function addOutline(doc: PDFDocument, entries: OutlineEntry[]) {
  const ctx = doc.context;
  const pages = doc.getPages();
  const outlinesRef = ctx.nextRef();
  const build = (list: OutlineEntry[], parentRef: ReturnType<typeof ctx.nextRef>) => {
    const refs = list.map(() => ctx.nextRef());
    let total = 0;
    list.forEach((e, i) => {
      const dict = ctx.obj({});
      dict.set(PDFName.of('Title'), PDFHexString.fromText(e.title));
      dict.set(PDFName.of('Parent'), parentRef);
      if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1]);
      if (i < list.length - 1) dict.set(PDFName.of('Next'), refs[i + 1]);
      dict.set(PDFName.of('Dest'), ctx.obj([pages[e.page].ref, PDFName.of('Fit')]));
      if (e.children?.length) {
        const sub = build(e.children, refs[i]);
        dict.set(PDFName.of('First'), sub.refs[0]);
        dict.set(PDFName.of('Last'), sub.refs[sub.refs.length - 1]);
        dict.set(PDFName.of('Count'), PDFNumber.of(-sub.total));
        total += sub.total;
      }
      total += 1;
      ctx.assign(refs[i], dict);
    });
    return { refs, total };
  };
  const top = build(entries, outlinesRef);
  const outlines = ctx.obj({});
  outlines.set(PDFName.of('Type'), PDFName.of('Outlines'));
  outlines.set(PDFName.of('First'), top.refs[0]);
  outlines.set(PDFName.of('Last'), top.refs[top.refs.length - 1]);
  outlines.set(PDFName.of('Count'), PDFNumber.of(top.total));
  ctx.assign(outlinesRef, outlines);
  doc.catalog.set(PDFName.of('Outlines'), outlinesRef);
}

export const PAPER = {
  title: 'Reading Order Reconstruction for Study Notebooks',
  authors: ['Ada Lovelace', 'Alan Turing'],
  doi: '10.5555/slate.2024.0042',
  left: [
    'Students read many papers, and lifting a passage onto a canvas should preserve its infor|mation rather than flatten it into a picture.',
    'Local-first software keeps every note on the device and syncs it later.',
  ],
  right: [
    'We cluster text runs into columns by detecting a wide vertical gutter between the two columns and then read each column from top to bottom.',
  ],
};

/**
 * A two-column paper on US Letter: title, author line, DOI, a section heading per column and
 * hyphenated body text. Info title is garbage so the heuristic title is used. 3 pages with an
 * outline.
 */
export async function makePaperPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('paper_final_v3.docx');
  doc.setAuthor('Administrator');
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  doc.setProducer('slate fixtures');
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const W = 612;
  const H = 792;
  const pages: PDFPage[] = [];
  for (let p = 0; p < 3; p++) pages.push(doc.addPage([W, H]));
  const p1 = pages[0];
  const centre = (page: PDFPage, s: string, y: number, size: number, f: PDFFont) =>
    page.drawText(s, { x: (W - f.widthOfTextAtSize(s, size)) / 2, y: H - y, size, font: f });
  centre(p1, PAPER.title, 80, 18, bold);
  centre(p1, PAPER.authors.join(', '), 108, 11, font);
  centre(p1, `DOI: ${PAPER.doi}`, 124, 9, font);
  const colW = 240;
  const column = (page: PDFPage, x: number, heading: string, paras: string[]) => {
    let y = 170;
    page.drawText(heading, { x, y: H - y, size: 12, font: bold });
    y += 18;
    for (const para of paras) {
      for (const line of wrap(para, font, 10, colW)) {
        page.drawText(line, { x, y: H - y, size: 10, font });
        y += 12;
      }
      y += 8;
    }
  };
  column(p1, 54, '1 Introduction', PAPER.left);
  column(p1, 318, '2 Method', PAPER.right);
  for (let p = 1; p < 3; p++) {
    column(pages[p], 54, `${p + 2} Section`, [`This is page ${p + 1} of the paper, with a little text so search finds it.`]);
  }
  addOutline(doc, [
    { title: 'Introduction', page: 0 },
    { title: 'Method', page: 0, children: [{ title: 'Objective', page: 1 }] },
    { title: 'Conclusion', page: 2 },
  ]);
  return doc.save({ useObjectStreams: false });
}

/** A long book (default 800 pages, L2) with Info metadata and a chapter outline. */
export async function makeBookPdf(pages = 800, opts: { title?: string; author?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(opts.title ?? 'Foundations of Study Systems');
  doc.setAuthor(opts.author ?? 'Edsger Dijkstra; Barbara Liskov');
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([432, 648]);
    if (i % 50 === 1) page.drawText(`Chapter ${Math.ceil(i / 50)}`, { x: 54, y: 590, size: 18, font });
    page.drawText(`This is page ${i} of the book.`, { x: 54, y: 550, size: 11, font });
    page.drawText(i === pages ? 'The quokka appears only on the last page.' : 'Nothing unusual here.', { x: 54, y: 530, size: 11, font });
  }
  const chapters: OutlineEntry[] = [];
  for (let c = 0; c * 50 < pages; c++) chapters.push({ title: `Chapter ${c + 1}`, page: c * 50 });
  addOutline(doc, chapters);
  return doc.save({ useObjectStreams: true });
}

export const EPUB = {
  title: 'The Slate Test Book',
  authors: ['Ada Lovelace', 'Charles Babbage'],
};

/** EPUB 3 with a nav document, 3 chapters (MathML, a table, a figure, a script to strip). */
export async function makeEpub(): Promise<Uint8Array> {
  const zip = new JSZip();
  const date = FIXED_DATE;
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE', date });
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    { date },
  );
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:12345678-1234-1234-1234-123456789abc</dc:identifier>
    <dc:title>${EPUB.title}</dc:title>
    <dc:creator id="a1">Ada Lovelace</dc:creator>
    <dc:creator id="a2">Charles Babbage</dc:creator>
    <dc:creator id="e1">An Editor</dc:creator>
    <meta refines="#e1" property="role">edt</meta>
    <dc:language>en</dc:language>
    <dc:publisher>Analytical Press</dc:publisher>
    <dc:date>1843-09-01</dc:date>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c3" href="text/ch3.xhtml" media-type="application/xhtml+xml"/>
    <item id="fig" href="images/fig.svg" media-type="image/svg+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/></spine>
</package>`,
    { date },
  );
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
<nav epub:type="toc"><ol>
<li><a href="text/ch1.xhtml">Chapter 1. The Engine</a></li>
<li><a href="text/ch2.xhtml">Chapter 2. Notes on Operations</a><ol><li><a href="text/ch2.xhtml#sec2-1">2.1 The Figure</a></li></ol></li>
<li><a href="text/ch3.xhtml">Chapter 3. Poetical Science</a></li>
</ol></nav></body></html>`,
    { date },
  );
  const chapter = (body: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title><style>p{color:red}</style><script>alert(1)</script></head><body>${body}</body></html>`;
  const para = (s: string) => `<p>${s}</p>`;
  const filler = (n: number, word: string) =>
    Array.from({ length: n }, (_, i) => para(`${word} paragraph ${i + 1}: the engine weaves algebraical patterns just as the Jacquard loom weaves flowers and leaves.`)).join('');
  zip.file(
    'OEBPS/text/ch1.xhtml',
    chapter(
      `<h1 id="ch1">Chapter 1. The Engine</h1><p class="chapter" onclick="alert(2)">The Analytical Engine weaves algebraical patterns.</p>` +
        `<p>The ratio is <math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>x</mi><mi>n</mi></mfrac></math> in general.</p>` +
        `<table><thead><tr><th>Operation</th><th>Cards</th></tr></thead><tbody><tr><td>Add</td><td>3</td></tr></tbody></table>` +
        `<p>See <a href="ch2.xhtml#sec2-1">the figure</a> or <a href="https://example.org/">the web</a>.</p>` +
        filler(12, 'First'),
    ),
    { date },
  );
  zip.file(
    'OEBPS/text/ch2.xhtml',
    chapter(
      `<h1>Chapter 2. Notes on Operations</h1>${filler(10, 'Second')}<h2 id="sec2-1">2.1 The Figure</h2><img src="../images/fig.svg" alt="Figure 1: the engine"/>` +
        para('A unique sentence about the bernoulli numbers sits here.') +
        filler(10, 'Late'),
    ),
    { date },
  );
  zip.file('OEBPS/text/ch3.xhtml', chapter(`<h1>Chapter 3. Poetical Science</h1>${filler(8, 'Third')}`), { date });
  zip.file(
    'OEBPS/images/fig.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#36c"/></svg>',
    { date },
  );
  return zip.generateAsync({ type: 'uint8array', mimeType: 'application/epub+zip' });
}
