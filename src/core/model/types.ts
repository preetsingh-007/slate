/**
 * Slate data model (see the PRD, "Data model").
 *
 * Coordinates are canvas units: unbounded in x and y; at 100% zoom 1,000 units span the
 * default writing width (C1). Times are milliseconds since 1970 (UTC). Topic references are
 * gym paths such as `math/linear-algebra/eigenvalues`.
 */

export type Ms = number;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------- canvas objects

export type ObjectKind = 'stroke' | 'text' | 'image' | 'clip' | 'shape';

/** Fields shared by every canvas object. */
export interface ObjectHeader {
  id: string;
  kind: ObjectKind;
  /**
   * Unrotated frame in canvas units. For strokes and shapes this is the bounding box of the
   * geometry (their geometry is stored in absolute canvas units and `rotation` is always 0).
   */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, clockwise, around the frame's centre (text, images and clips). */
  rotation: number;
  /** Fractional index (see util/zindex). Ties are broken by id. */
  z: string;
  created: Ms;
  edited: Ms;
  /** Device that created the object. */
  device: string;
  topics: string[];
  /** Group id; objects sharing a group are selected together. */
  group?: string;
}

export type StrokeTool = 'pen' | 'highlighter';

export interface StrokeObject extends ObjectHeader {
  kind: 'stroke';
  /** Flattened [x, y, pressure, ...] in absolute canvas units. Immutable: edits replace it. */
  pts: number[];
  tool: StrokeTool;
  color: string;
  size: number;
  /** Image the stroke was drawn on; it moves with that image. */
  attached?: string;
  /** Shape that replaced this stroke (Beautify). Hidden while set; restore clears it. */
  beautifiedInto?: string;
}

export interface TextObject extends ObjectHeader {
  kind: 'text';
  /** Markdown with `$...$` / `$$...$$` LaTeX and `- [ ]` to-dos. A Y.Text in the document. */
  content: string;
  fontSize: number;
}

export interface Crop {
  /** normalised to the natural image, 0..1 */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageObject extends ObjectHeader {
  kind: 'image';
  /** SHA-256 of the file; the file is `assets/<hash>.<ext>` */
  asset: string;
  mime: string;
  natural: { w: number; h: number };
  crop?: Crop;
  alt?: string;
}

export type ClipDisplay = 'image' | 'text' | 'both';

export interface ClipObject extends ObjectHeader {
  kind: 'clip';
  /** Image of the captured region (may be empty for text-only captures). */
  asset?: string;
  mime?: string;
  natural?: { w: number; h: number };
  /** Captured text as Markdown. */
  text: string;
  display: ClipDisplay;
  source: SourceLink;
}

export type ShapeKind = 'line' | 'arrow' | 'rectangle' | 'ellipse' | 'triangle' | 'diamond';

/** Shape geometry in absolute canvas units (same form as Axiom's recognizer output). */
export type ShapeGeometry =
  | { kind: 'line'; a: Pt; b: Pt }
  /** a = tail, b = tip; `heads: 'both'` draws a head at `a` too */
  | { kind: 'arrow'; a: Pt; b: Pt; heads: 'end' | 'both' }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  /** rotation in degrees (clockwise, y down), rx along the rotated x axis */
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rotation: number }
  | { kind: 'rectangle'; cx: number; cy: number; w: number; h: number; rotation: number }
  | { kind: 'triangle'; points: [Pt, Pt, Pt] }
  | { kind: 'diamond'; cx: number; cy: number; w: number; h: number };

export interface Pt {
  x: number;
  y: number;
}

export interface ShapeObject extends ObjectHeader {
  kind: 'shape';
  shape: ShapeKind;
  geometry: ShapeGeometry;
  color: string;
  lineWidth: number;
  /** Strokes this shape replaced; "restore" brings them back and deletes the shape. */
  originals: string[];
  /** Arrow endpoints attached to shapes: [start shape id, end shape id]. */
  connects?: [string | null, string | null];
}

export type CanvasObject = StrokeObject | TextObject | ImageObject | ClipObject | ShapeObject;

// ---------------------------------------------------------------- marks

export type MarkKind = 'note' | 'problem' | 'solution' | 'question';

export interface Mark {
  /** lowercase base-36, also the file name `marks/<id>.md` */
  id: string;
  objects: string[];
  region: Rect;
  kind: MarkKind;
  /** gym topic path or '' */
  topic: string;
  /** gym problem path, for solutions */
  problem: string;
  comment: string;
  created: Ms;
}

/** Parsed line of `journal/formalized.md`. */
export type FormalizedRecord =
  | { id: string; dismissed: false; path: string; heading?: string; date: string }
  | { id: string; dismissed: true; date: string };

// ---------------------------------------------------------------- source links

export type SourceType = 'book' | 'clipping' | 'gym' | 'canvas';

/** W3C Web Annotation text quote selector. */
export interface TextQuote {
  exact: string;
  prefix: string;
  suffix: string;
}

export interface PdfLocator {
  type: 'pdf';
  /** 1-based page */
  page: number;
  /** normalised to the page, 0..1 */
  region: Rect;
  quote: string;
}

export interface EpubLocator {
  type: 'epub';
  chapter: string;
  quote: TextQuote;
  /** position in the chapter, 0..1 */
  position: number;
}

export interface ClippingLocator {
  type: 'clipping';
  quote: TextQuote;
  /** character offset into the clipping's text, fallback when the quote is not found */
  offset: number;
  /** view the capture was made in */
  view?: 'reader' | 'original';
  /** normalised region of the capture within the rendered document, for flashing */
  region?: Rect;
}

export interface GymLocator {
  type: 'gym';
  path: string;
  commit: string;
  quote: TextQuote;
}

export interface CanvasLocator {
  type: 'canvas';
  canvas: string;
  region: Rect;
}

export type Locator = PdfLocator | EpubLocator | ClippingLocator | GymLocator | CanvasLocator;

export interface SourceLink {
  type: SourceType;
  /** book id, clipping id, gym path or canvas slug */
  id: string;
  /** display title captured with the link */
  title: string;
  locator: Locator;
  capturedAt: Ms;
  /** hash of the source content at capture time (book file hash, clipping content hash, gym blob sha) */
  contentHash: string;
}

// ---------------------------------------------------------------- canvases

export interface CanvasMeta {
  id: string;
  /** folder name under journal/ */
  slug: string;
  title: string;
  topics: string[];
  /** month → bounding box of the month's objects, for loading segments on demand */
  segments?: Record<string, Rect | null>;
}

// ---------------------------------------------------------------- library

export interface TocEntry {
  title: string;
  /** PDF: 1-based page */
  page?: number;
  /** EPUB: chapter href */
  href?: string;
  children?: TocEntry[];
}

export interface BookMeta {
  id: string;
  /** folder name under library/books/ */
  slug: string;
  format: 'pdf' | 'epub';
  title: string;
  authors: string[];
  year?: number;
  edition?: string;
  /** citation in gym's reference format: author, title, edition */
  citation: string;
  /** SHA-256 of the file */
  fileHash: string;
  fileName: string;
  size: number;
  pages?: number;
  toc?: TocEntry[];
  added: Ms;
  topics?: string[];
}

export interface ClippingMeta {
  id: string;
  /** folder name under library/clippings/: YYYY-MM-DD-<slug> */
  slug: string;
  origin: 'link' | 'clipboard';
  title: string;
  format: 'markdown' | 'plain';
  url?: string;
  canonicalUrl?: string;
  site?: string;
  author?: string;
  published?: string;
  fetched?: Ms;
  /** "ChatGPT", "Claude", a URL… */
  sourceLabel?: string;
  added: Ms;
  /** SHA-256 of clipping.md, for source links */
  contentHash: string;
  /** run the snapshot's scripts in the sandbox (L8) */
  scripts?: boolean;
  topics?: string[];
}

export type AnnotationKind = 'highlight' | 'ink' | 'note';

export interface Annotation {
  id: string;
  kind: AnnotationKind;
  locator: Locator;
  color: string;
  /** ink: strokes in page-normalised units (x, y in 0..1 of the page width) */
  strokes?: { pts: number[]; color: string; size: number; tool: StrokeTool }[];
  /** note text, or the highlighted text */
  text?: string;
  /** PDF highlights: normalised rects on the page */
  rects?: Rect[];
  created: Ms;
}

// ---------------------------------------------------------------- settings

export interface PenPreset {
  tool: StrokeTool;
  color: string;
  size: number;
}

export interface ReadingPosition {
  sourceId: string;
  locator: Locator | { type: 'scroll'; fraction: number };
  updated: Ms;
  device: string;
}

export interface PaneState {
  /** open side-pane tabs, most recent first */
  tabs: PaneTab[];
  active: number;
  divider: number;
  swapped: boolean;
  /** whether the side pane is open (absent: open when there are tabs) */
  open?: boolean;
  /** slug of the canvas in the main pane */
  canvas?: string;
  updated: Ms;
  device: string;
}

export type PaneTab =
  | { kind: 'book'; id: string }
  | { kind: 'clipping'; id: string }
  | { kind: 'gym'; path: string }
  | { kind: 'canvas'; slug: string }
  | { kind: 'todos' }
  | { kind: 'revision' }
  | { kind: 'library' };

/** `library/settings.json`: non-secret, synced settings (R11). */
export interface SyncedSettings {
  pens: PenPreset[];
  highlighters: PenPreset[];
  /** custom colours added by the owner */
  colors: string[];
  readingPositions: Record<string, ReadingPosition>;
  panes?: PaneState;
  /** Git LFS mode: book files are committed under library/books/<slug>/ */
  lfs?: boolean;
  updated: Ms;
}
