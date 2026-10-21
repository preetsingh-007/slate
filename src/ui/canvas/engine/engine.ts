/**
 * CanvasEngine: the imperative core of a canvas view (adapted from Axiom's InkSurface and
 * FocusView, generalised from a fixed-width block to an unbounded, tiled 2D canvas).
 *
 * Layers, bottom to top: DOM objects (text boxes, images, clips; React), the committed ink
 * (tiles composited onto one canvas), the wet layer (the stroke being drawn with predicted
 * points, the lasso, the eraser, dragged selections, space insertion previews).
 *
 * Input (C2, C4, C6, C11–C14): pointer events with coalesced and predicted points; once a
 * Pencil is seen only the Pencil draws, one finger pans and two fingers pan and zoom (unless
 * finger drawing is allowed); two fingers held still switch to space insertion; wheel and
 * trackpad pinch on laptops. React is told only about rare events (selection, taps, text
 * requests); the camera is broadcast once per animation frame to imperative listeners.
 *
 * No stroke waits on storage: a stroke is written to the in-memory CRDT on pointer-up and
 * painted straight into the cached tiles; persistence happens later in the DocStore.
 */
import type { CanvasObject, Pt, Rect, StrokeObject } from '../../../core/model/types';
import type { ObjectPatch } from '../../../core/canvas/model';
import type { DevicePrefs } from '../../../core/stores/settings';
import { baseScale, centerOn, clampZoom, fitRect, panBy, pinch, toCanvas, viewRect, zoomAt, type Camera } from '../../../core/canvas/camera';
import { objectBounds, rectsIntersect } from '../../../core/canvas/bounds';
import { splitStroke, touchesStroke } from '../../../core/canvas/erase';
import { expandGroups, hitObject, lassoSelect, rectPolygon, topHit } from '../../../core/canvas/hit';
import { makeStroke } from '../../../core/canvas/objects';
import { dominantAxis, planSpace, prepareSpace, spaceUnits, type Axis, type SpacePlan, type SpaceSetup } from '../../../core/canvas/space';
import { previewLineY } from '../../../core/canvas/daylines';
import { attachedStrokes, shapeFrame, transformSelection, translateObject, type Affine } from '../../../core/canvas/transform';
import { bbox, pointInPolygon } from '../../../core/ink/geometry';
import { HIGHLIGHTER_ALPHA, resolveInkColor, strokeOutline, traceOutline } from '../../../core/ink/render';
import { PointSmoother, PressureSimulator, quantizePoints } from '../../../core/ink/smoothing';
import { Emitter } from '../../../core/util/emitter';
import { compareZ } from '../../../core/util/zindex';
import type { CanvasController } from '../controller';
import { ERASER_PX, useTools, type Tool } from '../toolStore';
import { ctx2d, drawInk, makeCanvas } from './draw';
import { TileLayer } from './tileLayer';

type Bitmap = HTMLCanvasElement | OffscreenCanvas;

interface Sprite {
  canvas: Bitmap;
  /** canvas-unit rectangle the bitmap covers */
  rect: Rect;
}

type DrawGesture = {
  kind: 'draw';
  id: number;
  tool: 'pen' | 'highlighter';
  color: string;
  size: number;
  pts: number[];
  predicted: number[];
  smoother: PointSmoother | null;
  pressure: PressureSimulator | null;
  real: boolean;
};

type Gesture =
  | DrawGesture
  | { kind: 'erase'; id: number; last: Pt | null; partial: boolean; erased: Set<string>; pieces: Map<string, number[][]> }
  | { kind: 'lasso'; id: number; rect: boolean; pts: Pt[] }
  | { kind: 'pan'; id: number; lastX: number; lastY: number; moved: number; tapTool: Tool | 'finger' }
  | { kind: 'tap'; id: number; x: number; y: number; tool: Tool }
  | { kind: 'transform'; id: number; mode: 'move' | 'scale' | 'rotate'; start: Pt; anchor: Pt; t: Affine; moved: boolean; client: Pt; base: number }
  | { kind: 'width'; id: number; target: string; start: Pt; w0: number }
  | { kind: 'endpoint'; id: number; target: string; end: 'a' | 'b' }
  | { kind: 'space1'; id: number; start: Pt; startClient: Pt; space: SpaceState | null }
  | { kind: 'two'; ids: [number, number]; p0: [Pt, Pt]; cam0: Camera; mode: 'pending' | 'pinch' | 'space'; t0: number; timer: ReturnType<typeof setTimeout> | null; ref: [Pt, Pt] | null; space: SpaceState | null; moved: boolean };

interface SpaceState {
  axis: Axis;
  split: number;
  setup: SpaceSetup;
  members: Map<string, string[]>;
  plan: SpacePlan | null;
  sprites: { before: Sprite | null; after: Sprite | null };
  /** the finger on the before side (two-finger mode) */
  beforeFinger?: number;
}

export interface EngineOptions {
  root: HTMLElement;
  display: HTMLCanvasElement;
  wet: HTMLCanvasElement;
  controller: CanvasController;
  prefs(): DevicePrefs;
}

const TAP_PX = 8;
const DOUBLE_TAP_MS = 320;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Elements that handle their own pointer input. */
const INTERACTIVE = 'textarea, input, select, button, a[href], label, .cv-ui, [data-interactive], .md-task';

export class CanvasEngine {
  /** fires once per animation frame in which the camera changed */
  readonly frame = new Emitter<Camera>();
  /** fires when the camera has been still for a moment (segment loading) */
  readonly settled = new Emitter<Rect>();
  readonly selection = new Emitter<string[]>();
  /** live patches for DOM objects while a selection is dragged or space is inserted */
  readonly preview = new Emitter<Map<string, ObjectPatch> | null>();
  readonly textRequest = new Emitter<{ at: Pt; id?: string }>();
  readonly tapEmpty = new Emitter<Pt>();
  readonly hint = new Emitter<string | null>();
  /** a request to flash a region (canvas units) */
  readonly flash = new Emitter<Rect>();

  camera: Camera = { x: -24, y: -24, zoom: 1 };
  base = 1;
  dpr = 1;
  width = 0;
  height = 0;
  readonly tiles: TileLayer;
  readonly ctl: CanvasController;

  private root: HTMLElement;
  private display: HTMLCanvasElement;
  private wet: HTMLCanvasElement;
  private dctx: CanvasRenderingContext2D | null;
  private wctx: CanvasRenderingContext2D | null;
  private prefs: () => DevicePrefs;
  private raf = 0;
  private camDirty = true;
  private wetDirty = true;
  private tilesPending = true;
  private destroyed = false;
  private gesture: Gesture | null = null;
  private touches = new Map<number, Pt>();
  private rect: DOMRect | null = null;
  private sel: string[] = [];
  private selBox: Rect | null = null;
  private hiddenDrag = new Set<string>();
  private hiddenErase = new Set<string>();
  private hiddenSpace = new Set<string>();
  /** objects drawn on the wet layer until the tiles under the view are fresh */
  private pendingWet: CanvasObject[] = [];
  private pendingSprite: { sprite: Sprite; t: Affine | null; extra: CanvasObject[] } | null = null;
  private dragSprite: Sprite | null = null;
  private dragExtra: CanvasObject[] = [];
  private hover: Pt | null = null;
  private lastTap: { t: number; x: number; y: number } | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private anim: { from: Camera; to: Camera; t0: number; ms: number } | null = null;
  private cleanup: (() => void)[] = [];
  private accentColor = '';
  private inkColor = '#1f2328';
  /** the space key is held: the hand tool, temporarily */
  spaceKey = false;
  /** last pointer position on the canvas, for pasting and typing */
  lastPoint: Pt | null = null;
  /** frame-time samples for the performance test hook */
  frameTimes: number[] | null = null;

  constructor(opts: EngineOptions) {
    this.root = opts.root;
    this.display = opts.display;
    this.wet = opts.wet;
    this.ctl = opts.controller;
    this.prefs = opts.prefs;
    this.dctx = typeof Path2D === 'undefined' ? null : (this.display.getContext('2d') as CanvasRenderingContext2D | null);
    this.wctx =
      typeof Path2D === 'undefined'
        ? null
        : ((this.wet.getContext('2d', { desynchronized: true } as CanvasRenderingContext2DSettings) ?? this.wet.getContext('2d')) as CanvasRenderingContext2D | null);
    this.base = baseScale(typeof window !== 'undefined' ? window.innerWidth : 1200);
    this.dpr = typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1;
    this.tiles = new TileLayer(this.ctl.model, this.base, this.dpr, 128);
    this.resolveColors();
    this.cleanup.push(
      this.ctl.model.onChange.on((c) => {
        this.tiles.onChange(c);
        this.tilesPending = true;
        if (this.sel.length && (c.removed.size || [...c.changed].some((id) => this.sel.includes(id)))) this.refreshSelection();
        this.schedule();
      }),
    );
    this.bindDom();
  }

  // ------------------------------------------------------------------ lifecycle

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.settleTimer);
    for (const c of this.cleanup) c();
    this.cleanup = [];
    this.tiles.clear();
  }

  /** The view's size changed (ResizeObserver) or the window was resized. */
  resize(w: number, h: number) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const base = baseScale(window.innerWidth);
    if (base !== this.base || dpr !== this.dpr) {
      // keep the canvas point at the view's centre in place across a change of the 100% scale
      const c = toCanvas(this.camera, this.base, this.width / 2, this.height / 2);
      this.base = base;
      this.dpr = dpr;
      this.tiles.setBase(base, dpr);
      if (this.width) this.camera = centerOn(c, w, h, base, this.camera.zoom);
    }
    this.width = w;
    this.height = h;
    this.tiles.sizeFor(w, h);
    for (const c of [this.display, this.wet]) {
      c.width = Math.max(1, Math.round(w * dpr));
      c.height = Math.max(1, Math.round(h * dpr));
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    this.camDirty = true;
    this.wetDirty = true;
    this.tilesPending = true;
    this.schedule();
  }

  /** Re-reads theme colours (ink follows the theme). */
  resolveColors() {
    try {
      const cs = getComputedStyle(this.root);
      this.inkColor = cs.getPropertyValue('--ink-default').trim() || '#1f2328';
      this.accentColor = cs.getPropertyValue('--accent').trim() || '#2f6fde';
    } catch {
      /* tests */
    }
    this.tiles.setInk(this.inkColor);
    this.tilesPending = true;
    this.camDirty = true;
    this.schedule();
  }

  // ------------------------------------------------------------------ camera

  get view(): Rect {
    return viewRect(this.camera, this.base, this.width, this.height);
  }

  get pxPerUnit(): number {
    return this.camera.zoom * this.base;
  }

  setCamera(cam: Camera, animate = false) {
    const next = { x: cam.x, y: cam.y, zoom: clampZoom(cam.zoom) };
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (animate && !reduce && this.width) {
      this.anim = { from: { ...this.camera }, to: next, t0: performance.now(), ms: 260 };
    } else {
      this.anim = null;
      this.camera = next;
    }
    this.camDirty = true;
    this.schedule();
  }

  zoomAtScreen(zoom: number, sx = this.width / 2, sy = this.height / 2) {
    this.setCamera(zoomAt(this.camera, this.base, zoom, sx, sy));
  }

  zoomBy(f: number) {
    this.zoomAtScreen(this.camera.zoom * f);
  }

  /** Shows a canvas rectangle (fit, at most 100% unless `maxZoom`). */
  showRect(r: Rect, animate = true, maxZoom = 1) {
    if (!this.width) return;
    this.setCamera(fitRect(r, this.width, this.height, this.base, 48, maxZoom), animate);
  }

  async fitAll() {
    await this.ctl.loadAll();
    const b = this.ctl.allContentBounds();
    if (b) this.showRect(b, true, 2);
  }

  fitSelection() {
    if (this.selBox) this.showRect(this.selBox, true, 2);
  }

  /** C20 / "jump to now": just below the latest content, where today's line is or will be. */
  jumpToNow(animate = true) {
    // where new work goes: just below the latest content (today's line or its preview)
    const bottom = this.ctl.contentBottom();
    const y = previewLineY(bottom);
    // left edge: the left of the latest content (the bottom 600 units of it), or the origin
    let left = 0;
    const recent = bottom === null ? [] : this.ctl.model.query({ x: -1e9, y: bottom - 600, w: 2e9, h: 600 });
    if (recent.length) left = Math.min(...recent.map((o) => objectBounds(o).x));
    const zoom = this.camera.zoom === 0 ? 1 : Math.min(Math.max(this.camera.zoom, 0.5), 2);
    const k = zoom * this.base;
    this.setCamera({ x: left - 24 / k - 16, y: y - (this.height * 0.3) / k, zoom }, animate);
  }

  /** Scrolls a region into view and flashes it for 2 seconds (S6, G4). */
  revealRegion(r: Rect) {
    const v = this.view;
    const fits = r.w <= v.w * 0.9 && r.h <= v.h * 0.9;
    if (fits) this.setCamera(centerOn({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, this.width, this.height, this.base, this.camera.zoom), true);
    else this.showRect(r, true, this.camera.zoom);
    this.flash.emit(r);
  }

  /** Client (viewport) point → canvas point, or null when outside this view. */
  clientToCanvas(x: number, y: number): Pt | null {
    const r = this.root.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    return toCanvas(this.camera, this.base, x - r.left, y - r.top);
  }

  private toCanvasPt(clientX: number, clientY: number): Pt {
    const r = this.rect ?? this.root.getBoundingClientRect();
    return toCanvas(this.camera, this.base, clientX - r.left, clientY - r.top);
  }

  private local(clientX: number, clientY: number): Pt {
    const r = this.rect ?? this.root.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  // ------------------------------------------------------------------ selection

  getSelection(): string[] {
    return this.sel;
  }

  getSelectionBounds(): Rect | null {
    return this.selBox;
  }

  select(ids: string[], expand = true) {
    const all = expand ? expandGroups(ids, (id) => this.ctl.get(id), (g) => this.ctl.members(g)) : ids;
    this.sel = all.filter((id) => this.ctl.model.has(id));
    this.selBox = this.ctl.boundsOf(this.sel);
    this.selection.emit(this.sel);
    this.wetDirty = true;
    this.schedule();
  }

  clearSelection() {
    if (!this.sel.length) return;
    this.sel = [];
    this.selBox = null;
    this.selection.emit(this.sel);
  }

  private refreshSelection() {
    const alive = this.sel.filter((id) => this.ctl.model.has(id));
    this.sel = alive;
    this.selBox = this.ctl.boundsOf(alive);
    this.selection.emit(this.sel);
  }

  // ------------------------------------------------------------------ frame loop

  private schedule() {
    if (this.raf || this.destroyed) return;
    this.raf = requestAnimationFrame((t) => {
      this.raf = 0;
      this.frameTick(t);
    });
  }

  private lastFrame = 0;

  private frameTick(now: number) {
    if (this.frameTimes && this.lastFrame) this.frameTimes.push(now - this.lastFrame);
    this.lastFrame = now;
    if (this.anim) {
      const a = this.anim;
      const t = Math.min(1, (performance.now() - a.t0) / a.ms);
      const e = 1 - Math.pow(1 - t, 3);
      // interpolate in log-zoom so zooming feels even
      const z = Math.exp(Math.log(a.from.zoom) + (Math.log(a.to.zoom) - Math.log(a.from.zoom)) * e);
      const ca = { x: a.from.x + (this.width / 2) / (a.from.zoom * this.base), y: a.from.y + (this.height / 2) / (a.from.zoom * this.base) };
      const cb = { x: a.to.x + (this.width / 2) / (a.to.zoom * this.base), y: a.to.y + (this.height / 2) / (a.to.zoom * this.base) };
      this.camera = centerOn({ x: ca.x + (cb.x - ca.x) * e, y: ca.y + (cb.y - ca.y) * e }, this.width, this.height, this.base, z);
      if (t >= 1) {
        this.anim = null;
        this.camera = a.to;
      }
      this.camDirty = true;
    }
    let again = !!this.anim;
    if (this.camDirty || this.tilesPending) {
      // render what the budget allows, then composite (stand-ins fill the rest)
      const fresh = this.tiles.renderPending(this.camera, this.width, this.height, this.camDirty ? 5 : 9);
      if (this.dctx) this.tiles.composite(this.dctx, this.camera, this.width, this.height);
      this.tilesPending = !fresh;
      if (!fresh) again = true;
      if (fresh && (this.pendingWet.length || this.pendingSprite)) {
        this.pendingWet = [];
        this.pendingSprite = null;
        this.wetDirty = true;
      }
    }
    if (this.camDirty) {
      this.camDirty = false;
      this.wetDirty = true;
      this.frame.emit(this.camera);
      clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => this.settled.emit(this.view), 180);
    }
    if (this.wetDirty) {
      this.wetDirty = false;
      this.drawWet();
    }
    const g = this.gesture;
    if (g && g.kind === 'lasso') {
      this.wetDirty = true; // marching ants
      again = true;
    }
    if (again) this.schedule();
  }

  // ------------------------------------------------------------------ wet layer

  private setCamTransform(ctx: CanvasRenderingContext2D) {
    const k = this.camera.zoom * this.base * this.dpr;
    ctx.setTransform(k, 0, 0, k, -this.camera.x * k, -this.camera.y * k);
  }

  private drawSprite(ctx: CanvasRenderingContext2D, s: Sprite, t: Affine | null, axisShift?: { axis: Axis; d: number }) {
    this.setCamTransform(ctx);
    if (t) {
      ctx.translate(t.ox + t.dx, t.oy + t.dy);
      ctx.rotate((t.rot * Math.PI) / 180);
      ctx.scale(t.s, t.s);
      ctx.translate(-t.ox, -t.oy);
    }
    if (axisShift) ctx.translate(axisShift.axis === 'x' ? axisShift.d : 0, axisShift.axis === 'y' ? axisShift.d : 0);
    ctx.drawImage(s.canvas as CanvasImageSource, s.rect.x, s.rect.y, s.rect.w, s.rect.h);
  }

  private drawWet() {
    const ctx = this.wctx;
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.wet.width, this.wet.height);
    const st = { ink: this.inkColor, pxPerUnit: this.pxPerUnit };
    if (this.pendingWet.length) {
      this.setCamTransform(ctx);
      drawInk(ctx, this.pendingWet, st);
    }
    if (this.pendingSprite) {
      this.drawSprite(ctx, this.pendingSprite.sprite, this.pendingSprite.t);
      this.setCamTransform(ctx);
      drawInk(ctx, this.pendingSprite.extra, st);
    }
    const g = this.gesture;
    if (!g) {
      if (this.hover && useTools.getState().tool === 'eraser') this.drawEraserCursor(ctx, this.hover);
      return;
    }
    switch (g.kind) {
      case 'draw': {
        this.setCamTransform(ctx);
        const outline = strokeOutline({ pts: g.pts, size: g.size, tool: g.tool }, { last: false, extra: g.predicted });
        if (!outline.length) break;
        const path = new Path2D();
        traceOutline(path, outline);
        ctx.globalAlpha = g.tool === 'highlighter' ? HIGHLIGHTER_ALPHA : 1;
        ctx.fillStyle = resolveInkColor(g.color, this.inkColor);
        ctx.fill(path);
        ctx.globalAlpha = 1;
        break;
      }
      case 'erase': {
        if (g.partial && g.pieces.size) {
          this.setCamTransform(ctx);
          for (const [id, pieces] of g.pieces) {
            const o = this.ctl.get(id);
            if (o?.kind !== 'stroke') continue;
            for (const pts of pieces) drawInk(ctx, [{ ...o, pts }], st);
          }
        }
        if (g.last) this.drawEraserCursor(ctx, g.last);
        break;
      }
      case 'lasso': {
        if (g.pts.length < 2) break;
        this.setCamTransform(ctx);
        const k = this.pxPerUnit;
        const poly = g.rect ? rectPolygon(rectOf(g.pts[0], g.pts[g.pts.length - 1])) : g.pts;
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (const p of poly) ctx.lineTo(p.x, p.y);
        if (g.rect) ctx.closePath();
        ctx.lineWidth = 1.5 / k;
        ctx.setLineDash([6 / k, 5 / k]);
        ctx.lineDashOffset = -((performance.now() / 40) % 11) / k;
        ctx.strokeStyle = this.accentColor;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = this.accentColor;
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case 'transform':
        if (g.moved && this.dragSprite) {
          this.drawSprite(ctx, this.dragSprite, g.t);
          this.setCamTransform(ctx);
          drawInk(ctx, this.dragExtra, st);
        }
        break;
      case 'space1':
      case 'two':
        if (g.space) this.drawSpace(ctx, g.space);
        break;
      default:
        break;
    }
  }

  private drawEraserCursor(ctx: CanvasRenderingContext2D, p: Pt) {
    this.setCamTransform(ctx);
    const k = this.pxPerUnit;
    ctx.beginPath();
    ctx.arc(p.x, p.y, ERASER_PX / k, 0, Math.PI * 2);
    ctx.lineWidth = 1 / k;
    ctx.strokeStyle = this.inkColor;
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawSpace(ctx: CanvasRenderingContext2D, s: SpaceState) {
    const plan = s.plan;
    const before = plan?.before ?? 0;
    const after = plan?.after ?? 0;
    if (s.sprites.before) this.drawSprite(ctx, s.sprites.before, null, { axis: s.axis, d: before });
    if (s.sprites.after) this.drawSprite(ctx, s.sprites.after, null, { axis: s.axis, d: after });
    // guide: the split line and the band of space being inserted or removed
    this.setCamTransform(ctx);
    const v = this.view;
    const k = this.pxPerUnit;
    const a = s.split + Math.min(before, 0);
    const b = s.split + Math.max(after, 0);
    ctx.fillStyle = this.accentColor;
    ctx.globalAlpha = 0.07;
    if (s.axis === 'y') ctx.fillRect(v.x, a, v.w, b - a);
    else ctx.fillRect(a, v.y, b - a, v.h);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = this.accentColor;
    ctx.lineWidth = 1.5 / k;
    ctx.setLineDash([8 / k, 6 / k]);
    ctx.beginPath();
    for (const pos of new Set([s.split + before, s.split + after])) {
      if (s.axis === 'y') {
        ctx.moveTo(v.x, pos);
        ctx.lineTo(v.x + v.w, pos);
      } else {
        ctx.moveTo(pos, v.y);
        ctx.lineTo(pos, v.y + v.h);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  /** Renders ink objects into a bitmap covering their bounds (clipped near the view). */
  private makeSprite(objs: CanvasObject[]): Sprite | null {
    const ink = objs.filter((o) => o.kind === 'stroke' || o.kind === 'shape').sort(compareZ);
    if (!ink.length) return null;
    let r: Rect | null = null;
    for (const o of ink) {
      const b = objectBounds(o);
      r = r ? union(r, b) : b;
    }
    const v = this.view;
    const clip = { x: v.x - v.w, y: v.y - v.h, w: v.w * 3, h: v.h * 3 };
    const x0 = Math.max(r!.x, clip.x);
    const y0 = Math.max(r!.y, clip.y);
    const x1 = Math.min(r!.x + r!.w, clip.x + clip.w);
    const y1 = Math.min(r!.y + r!.h, clip.y + clip.h);
    if (x1 <= x0 || y1 <= y0) return null;
    const rect = { x: x0 - 2, y: y0 - 2, w: x1 - x0 + 4, h: y1 - y0 + 4 };
    let k = this.pxPerUnit * this.dpr;
    const max = 4096;
    k = Math.min(k, max / rect.w, max / rect.h);
    const c = makeCanvas(Math.ceil(rect.w * k), Math.ceil(rect.h * k));
    const ctx = ctx2d(c);
    if (!ctx) return null;
    ctx.setTransform(k, 0, 0, k, -rect.x * k, -rect.y * k);
    drawInk(ctx, ink, { ink: this.inkColor, pxPerUnit: k / this.dpr });
    return { canvas: c, rect };
  }

  private updateHidden() {
    this.tiles.setHidden([...this.hiddenDrag, ...this.hiddenErase, ...this.hiddenSpace]);
    this.tilesPending = true;
    this.schedule();
  }

  // ------------------------------------------------------------------ DOM events

  private bindDom() {
    const opts = { passive: false } as AddEventListenerOptions;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, o: AddEventListenerOptions = opts) => {
      this.root.addEventListener(type, fn as EventListener, o);
      this.cleanup.push(() => this.root.removeEventListener(type, fn as EventListener, o));
    };
    on('pointerdown', (e) => this.onDown(e));
    on('pointermove', (e) => this.onMove(e));
    on('pointerup', (e) => this.onUp(e));
    on('pointercancel', (e) => this.onCancel(e));
    on('pointerleave', () => {
      this.hover = null;
      this.wetDirty = true;
      this.schedule();
    });
    on('wheel', (e) => this.onWheel(e));
    on('contextmenu', (e) => {
      if (!(e.target as Element).closest?.(INTERACTIVE)) e.preventDefault();
    });
    // Safari trackpad pinch (desktop); on iPad the pointer events drive pinch instead
    let gz = 1;
    const gs = (e: Event) => {
      e.preventDefault();
      gz = this.camera.zoom;
    };
    const gc = (e: Event) => {
      e.preventDefault();
      if (this.touches.size) return;
      const ge = e as Event & { scale: number; clientX: number; clientY: number };
      const p = this.local(ge.clientX, ge.clientY);
      this.zoomAtScreen(gz * ge.scale, p.x, p.y);
    };
    this.root.addEventListener('gesturestart', gs, opts);
    this.root.addEventListener('gesturechange', gc, opts);
    this.cleanup.push(() => {
      this.root.removeEventListener('gesturestart', gs, opts);
      this.root.removeEventListener('gesturechange', gc, opts);
    });
    // iOS: keep the Pencil from scrolling or selecting text
    const stylus = (e: TouchEvent) => {
      if ((e.target as Element | null)?.closest?.(INTERACTIVE)) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if ((e.changedTouches[i] as Touch & { touchType?: string }).touchType === 'stylus') {
          if (e.cancelable) e.preventDefault();
          return;
        }
      }
    };
    on('touchstart', stylus);
    on('touchmove', stylus);
  }

  private interactiveTarget(e: PointerEvent): boolean {
    const t = e.target as Element | null;
    if (!t?.closest) return false;
    const el = t.closest(INTERACTIVE);
    if (!el) return false;
    // links inside rendered Markdown only react to non-drawing tools
    if (el.tagName === 'A' && ['pen', 'highlighter', 'eraser'].includes(useTools.getState().tool)) return false;
    return true;
  }

  private effectiveTool(e: PointerEvent): Tool {
    const tools = useTools.getState();
    if (this.spaceKey) return 'hand';
    if (e.pointerType === 'pen') {
      if (e.button === 5 || (e.buttons & 32) !== 0) return 'eraser';
      if (e.button === 2 || (e.buttons & 2) !== 0) {
        // C11: the stylus barrel button stands in for Pencil double-tap/squeeze, which browsers do not expose
        const act = this.prefs().pencilDoubleTap;
        if (act === 'eraser') return 'eraser';
        if (act === 'previous') return tools.prevTool;
      }
    }
    return tools.tool;
  }

  private onDown(e: PointerEvent) {
    if (this.interactiveTarget(e)) {
      this.lastTap = null;
      return;
    }
    const tools = useTools.getState();
    if (e.pointerType === 'pen' && !tools.penDetected) tools.setPenDetected(true);
    this.rect = this.root.getBoundingClientRect();
    const p = this.toCanvasPt(e.clientX, e.clientY);
    this.lastPoint = p;

    if (e.pointerType === 'touch') {
      // a Pencil gesture in progress: palms and fingers are ignored entirely (C13)
      if (this.gesture && this.gesture.kind !== 'two' && this.touches.size === 0) return;
      if (tools.penDetected && (e.width > 60 || e.height > 60)) return; // palm
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        this.startTwo();
        e.preventDefault();
        return;
      }
      if (this.touches.size > 2) return;
    } else if (this.gesture) return;

    if (e.pointerType === 'mouse' && e.button === 1) {
      this.begin(e, { kind: 'pan', id: e.pointerId, lastX: e.clientX, lastY: e.clientY, moved: 0, tapTool: 'hand' });
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    // handles of the selection (scale, rotate, width, line ends)
    const handle = (e.target as Element | null)?.closest?.('[data-handle]') as HTMLElement | null;
    if (handle && this.sel.length) {
      this.startHandle(e, handle.dataset.handle!, p);
      return;
    }

    const fingerPans = e.pointerType === 'touch' && tools.penDetected && !this.prefs().fingerDrawing;
    const tool = fingerPans ? 'hand' : this.effectiveTool(e);

    // inside the selection: move it (drawing tools draw instead)
    if (this.selBox && !['pen', 'highlighter', 'eraser', 'space'].includes(tool) && this.inSelection(p)) {
      this.begin(e, { kind: 'transform', id: e.pointerId, mode: 'move', start: p, anchor: p, t: noMove(), moved: false, client: { x: e.clientX, y: e.clientY }, base: 0 });
      return;
    }

    switch (tool) {
      case 'pen':
      case 'highlighter': {
        this.clearSelection();
        const style = tool === 'pen' ? tools.pen : tools.highlighter;
        const real = e.pointerType === 'pen' && e.pressure > 0;
        const g: DrawGesture = {
          kind: 'draw',
          id: e.pointerId,
          tool,
          color: style.color,
          size: style.size,
          pts: [],
          predicted: [],
          smoother: e.pointerType === 'pen' ? null : new PointSmoother(),
          pressure: real ? null : new PressureSimulator(),
          real,
        };
        this.begin(e, g);
        this.addDrawPoint(g, e);
        break;
      }
      case 'eraser': {
        this.clearSelection();
        const g: Gesture = { kind: 'erase', id: e.pointerId, last: null, partial: tools.eraserMode === 'partial', erased: new Set(), pieces: new Map() };
        this.begin(e, g);
        this.eraseTo(g, p);
        break;
      }
      case 'lasso':
        this.begin(e, { kind: 'lasso', id: e.pointerId, rect: tools.lassoMode === 'rect', pts: [p] });
        break;
      case 'space':
        this.clearSelection();
        this.begin(e, { kind: 'space1', id: e.pointerId, start: p, startClient: { x: e.clientX, y: e.clientY }, space: null });
        break;
      case 'text':
        this.begin(e, { kind: 'tap', id: e.pointerId, x: e.clientX, y: e.clientY, tool: 'text' });
        break;
      case 'hand':
        this.begin(e, { kind: 'pan', id: e.pointerId, lastX: e.clientX, lastY: e.clientY, moved: 0, tapTool: fingerPans ? 'finger' : 'hand' });
        break;
    }
  }

  private begin(e: PointerEvent, g: Gesture) {
    this.gesture = g;
    e.preventDefault();
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
    this.wetDirty = true;
    this.schedule();
  }

  private inSelection(p: Pt): boolean {
    const b = this.selBox;
    if (!b) return false;
    const pad = 8 / this.pxPerUnit;
    return p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;
  }

  private onMove(e: PointerEvent) {
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = this.gesture;
    if (!g) {
      if (e.pointerType !== 'touch') {
        this.lastPoint = this.toCanvasPt(e.clientX, e.clientY);
        if (useTools.getState().tool === 'eraser') {
          this.hover = this.lastPoint;
          this.wetDirty = true;
          this.schedule();
        }
      }
      return;
    }
    if (g.kind === 'two') {
      this.moveTwo(g);
      return;
    }
    if (e.pointerId !== g.id) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const list = events.length ? events : [e];
    switch (g.kind) {
      case 'draw': {
        for (const ev of list) this.addDrawPoint(g, ev);
        g.predicted = [];
        const pred = typeof e.getPredictedEvents === 'function' ? e.getPredictedEvents() : [];
        const lastP = g.pts[g.pts.length - 1] ?? 0.5;
        for (const ev of pred) {
          const q = this.toCanvasPt(ev.clientX, ev.clientY);
          g.predicted.push(q.x, q.y, lastP);
        }
        break;
      }
      case 'erase':
        for (const ev of list) this.eraseTo(g, this.toCanvasPt(ev.clientX, ev.clientY));
        break;
      case 'lasso':
        for (const ev of list) {
          const p = this.toCanvasPt(ev.clientX, ev.clientY);
          const l = g.pts[g.pts.length - 1];
          if (g.rect) g.pts = [g.pts[0], p];
          else if (!l || Math.hypot(p.x - l.x, p.y - l.y) * this.pxPerUnit > 1.5) g.pts.push(p);
        }
        break;
      case 'pan': {
        const dx = e.clientX - g.lastX;
        const dy = e.clientY - g.lastY;
        g.lastX = e.clientX;
        g.lastY = e.clientY;
        g.moved += Math.abs(dx) + Math.abs(dy);
        this.setCamera(panBy(this.camera, this.base, dx, dy));
        return;
      }
      case 'tap':
        if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > TAP_PX) {
          // the text tool drags the canvas
          this.gesture = { kind: 'pan', id: g.id, lastX: e.clientX, lastY: e.clientY, moved: TAP_PX, tapTool: 'text' };
        }
        return;
      case 'transform':
        this.moveTransform(g, e);
        return;
      case 'width': {
        const p = this.toCanvasPt(e.clientX, e.clientY);
        const o = this.ctl.get(g.target);
        if (!o) return;
        const w = Math.max(80, r1(g.w0 + (p.x - g.start.x)));
        this.preview.emit(new Map([[g.target, { w }]]));
        return;
      }
      case 'endpoint': {
        const p = this.toCanvasPt(e.clientX, e.clientY);
        const o = this.ctl.get(g.target);
        if (o?.kind !== 'shape' || (o.geometry.kind !== 'line' && o.geometry.kind !== 'arrow')) return;
        const geometry = { ...o.geometry, [g.end]: { x: r1(p.x), y: r1(p.y) } };
        this.dragExtra = [{ ...o, geometry }];
        this.hiddenDrag = new Set([o.id]);
        this.updateHidden();
        this.pendingWet = this.dragExtra;
        this.wetDirty = true;
        this.schedule();
        return;
      }
      case 'space1': {
        const p = this.toCanvasPt(e.clientX, e.clientY);
        if (!g.space) {
          if (Math.hypot(e.clientX - g.startClient.x, e.clientY - g.startClient.y) < TAP_PX) return;
          const axis = dominantAxis(p.x - g.start.x, p.y - g.start.y);
          g.space = this.startSpace(axis, axis === 'y' ? g.start.y : g.start.x);
        }
        const d = g.space.axis === 'y' ? p.y - g.start.y : p.x - g.start.x;
        this.updateSpace(g.space, 0, d);
        return;
      }
    }
    this.wetDirty = true;
    this.schedule();
  }

  private onUp(e: PointerEvent) {
    const wasTouch = e.pointerType === 'touch' && this.touches.has(e.pointerId);
    if (wasTouch) this.touches.delete(e.pointerId);
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'two') {
      if (!g.ids.includes(e.pointerId)) return;
      this.endTwo(g);
      return;
    }
    if (g.id !== e.pointerId) return;
    this.gesture = null;
    switch (g.kind) {
      case 'draw':
        this.finishDraw(g, e);
        this.commitStroke(g);
        break;
      case 'erase':
        this.commitErase(g);
        break;
      case 'lasso':
        this.finishLasso(g, e);
        break;
      case 'pan':
        if (g.moved < TAP_PX) this.tap(e, g.tapTool === 'finger' ? 'hand' : g.tapTool);
        break;
      case 'tap':
        this.tap(e, g.tool);
        break;
      case 'transform':
        if (g.moved) this.commitTransform(g);
        else this.tap(e, useTools.getState().tool);
        break;
      case 'width': {
        const p = this.toCanvasPt(e.clientX, e.clientY);
        const w = Math.max(80, r1(g.w0 + (p.x - g.start.x)));
        this.preview.emit(null);
        if (Math.abs(w - g.w0) > 0.5) this.ctl.update([[g.target, { w }]]);
        this.refreshSelection();
        break;
      }
      case 'endpoint':
        this.commitEndpoint(g, this.toCanvasPt(e.clientX, e.clientY));
        break;
      case 'space1':
        if (g.space) this.commitSpace(g.space);
        else this.tap(e, 'space');
        break;
    }
    this.rect = null;
    this.wetDirty = true;
    this.schedule();
  }

  private onCancel(e: PointerEvent) {
    this.touches.delete(e.pointerId);
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'two' ? g.ids.includes(e.pointerId) : g.id === e.pointerId) this.cancelGesture();
  }

  /** Drops the gesture in progress without committing anything. */
  cancelGesture() {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    if (g.kind === 'two' && g.timer) clearTimeout(g.timer);
    if (g.kind === 'erase') this.hiddenErase.clear();
    if (g.kind === 'transform' || g.kind === 'endpoint') {
      this.hiddenDrag.clear();
      this.dragSprite = null;
      this.dragExtra = [];
      this.pendingWet = [];
      this.preview.emit(null);
    }
    if (g.kind === 'width') this.preview.emit(null);
    if ((g.kind === 'two' || g.kind === 'space1') && g.space) {
      this.hiddenSpace.clear();
      this.preview.emit(null);
      this.hint.emit(null);
    }
    this.updateHidden();
    this.wetDirty = true;
    this.schedule();
  }

  private onWheel(e: WheelEvent) {
    if ((e.target as Element | null)?.closest?.('.cv-ui, textarea')) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.height : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    const p = this.local(e.clientX, e.clientY);
    if (e.ctrlKey || e.metaKey) {
      // trackpad pinch arrives as ctrl+wheel (Chrome, Firefox, Edge)
      this.zoomAtScreen(this.camera.zoom * Math.exp(-dy * 0.01), p.x, p.y);
    } else if (e.shiftKey && !dx) this.setCamera(panBy(this.camera, this.base, -dy, 0));
    else this.setCamera(panBy(this.camera, this.base, -dx, -dy));
  }

  // ------------------------------------------------------------------ taps

  private tap(e: PointerEvent, tool: Tool | 'finger') {
    const p = this.toCanvasPt(e.clientX, e.clientY);
    const now = e.timeStamp;
    const dbl = !!this.lastTap && now - this.lastTap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < 24;
    this.lastTap = dbl ? null : { t: now, x: e.clientX, y: e.clientY };
    const tol = 6 / this.pxPerUnit;
    const hit = topHit(this.ctl.model.query({ x: p.x - tol, y: p.y - tol, w: 2 * tol, h: 2 * tol }), p, tol);
    if (tool === 'text') {
      if (hit?.kind === 'text') this.textRequest.emit({ at: p, id: hit.id });
      else if (hit && hit.kind !== 'stroke' && hit.kind !== 'shape') this.select([hit.id]);
      else {
        this.clearSelection();
        this.textRequest.emit({ at: p });
      }
      return;
    }
    if (dbl && (!hit || hit.kind === 'text')) {
      // double tap: edit a text box, or start one on an empty spot
      if (hit) this.textRequest.emit({ at: p, id: hit.id });
      else this.textRequest.emit({ at: p });
      return;
    }
    if (hit) this.select([hit.id]);
    else {
      this.clearSelection();
      this.tapEmpty.emit(p);
    }
  }

  // ------------------------------------------------------------------ drawing (C6)

  private addDrawPoint(g: DrawGesture, ev: PointerEvent) {
    let { x, y } = this.toCanvasPt(ev.clientX, ev.clientY);
    if (g.smoother) [x, y] = g.smoother.filter(x, y, ev.timeStamp);
    const n = g.pts.length;
    const minD = 0.25 / this.pxPerUnit;
    if (n >= 3 && Math.abs(g.pts[n - 3] - x) < minD && Math.abs(g.pts[n - 2] - y) < minD) return;
    const p = g.real ? ev.pressure || 0.5 : g.pressure!.next(x * this.pxPerUnit, y * this.pxPerUnit, ev.timeStamp);
    g.pts.push(x, y, p);
  }

  /** Smoothed input lags slightly: end the stroke exactly where the pointer was lifted. */
  private finishDraw(g: DrawGesture, e: PointerEvent) {
    g.predicted = [];
    if (!g.smoother || g.pts.length < 3) return;
    const p = this.toCanvasPt(e.clientX, e.clientY);
    const n = g.pts.length;
    if (Math.hypot(g.pts[n - 3] - p.x, g.pts[n - 2] - p.y) < 0.5 / this.pxPerUnit) return;
    g.pts.push(p.x, p.y, g.pts[n - 1]);
  }

  private commitStroke(g: DrawGesture) {
    if (!g.pts.length) return;
    let pts = quantizePoints(g.pts);
    if (pts.length === 3) pts = [...pts, r1(pts[0] + 0.1), pts[1], pts[2]]; // a tap leaves a dot
    const stroke = makeStroke(
      { id: this.ctl.newId(), now: Date.now(), device: this.ctl.device, z: this.ctl.model.topZ() },
      { pts, tool: g.tool, color: g.color, size: g.size, attached: this.imageUnder(pts) },
    );
    this.pendingWet = [...this.pendingWet, stroke];
    this.ctl.addObjects([stroke]);
    this.tilesPending = true;
    this.wetDirty = true;
    this.schedule();
  }

  /** C8: a stroke drawn over an image (most of its points inside the frame) attaches to it. */
  private imageUnder(pts: number[]): string | undefined {
    const b = bbox(ptsOf(pts));
    const images = this.ctl.model.query(b).filter((o) => o.kind === 'image').sort(compareZ).reverse();
    for (const img of images) {
      const poly = rectPolygonRotated(img);
      let inside = 0;
      const n = pts.length / 3;
      for (let i = 0; i + 1 < pts.length; i += 3) if (pointInPolygon({ x: pts[i], y: pts[i + 1] }, poly)) inside++;
      if (inside / n >= 0.6) return img.id;
    }
    return undefined;
  }

  // ------------------------------------------------------------------ eraser (C12)

  private eraseTo(g: Extract<Gesture, { kind: 'erase' }>, p: Pt) {
    const a = g.last ?? p;
    g.last = p;
    const r = ERASER_PX / this.pxPerUnit;
    const box = { x: Math.min(a.x, p.x) - r - 20, y: Math.min(a.y, p.y) - r - 20, w: Math.abs(p.x - a.x) + 2 * r + 40, h: Math.abs(p.y - a.y) + 2 * r + 40 };
    let changed = false;
    for (const o of this.ctl.model.query(box)) {
      if (o.kind !== 'stroke' || o.beautifiedInto) continue;
      if (g.partial) {
        const cur = g.pieces.get(o.id) ?? [o.pts];
        let touched = false;
        const next: number[][] = [];
        for (const piece of cur) {
          const split = splitStroke(piece, [a, p], r + o.size / 2);
          if (split) {
            touched = true;
            next.push(...split);
          } else next.push(piece);
        }
        if (touched) {
          g.pieces.set(o.id, next);
          if (!this.hiddenErase.has(o.id)) this.hiddenErase.add(o.id);
          changed = true;
        }
      } else if (!g.erased.has(o.id) && touchesStroke(o, a, p, r)) {
        g.erased.add(o.id);
        this.hiddenErase.add(o.id);
        changed = true;
      }
    }
    if (changed) this.updateHidden();
    this.wetDirty = true;
    this.schedule();
  }

  private commitErase(g: Extract<Gesture, { kind: 'erase' }>) {
    const now = Date.now();
    if (g.partial && g.pieces.size) {
      const added: StrokeObject[] = [];
      this.ctl.model.transact((tx) => {
        for (const [id, pieces] of g.pieces) {
          const o = this.ctl.get(id);
          if (o?.kind !== 'stroke') continue;
          tx.remove(id);
          for (const pts of pieces) {
            // the pieces keep the original's creation time (and so its segment and day)
            const piece: StrokeObject = { ...o, ...makeStroke({ id: this.ctl.newId(), now: o.created, device: o.device, z: o.z }, { pts, tool: o.tool, color: o.color, size: o.size, attached: o.attached }), topics: o.topics, edited: now };
            if (o.group) piece.group = o.group;
            added.push(piece);
            tx.add(piece);
          }
        }
      });
      this.pendingWet = added;
    } else if (g.erased.size) {
      this.ctl.remove(g.erased);
    }
    this.hiddenErase.clear();
    this.updateHidden();
  }

  // ------------------------------------------------------------------ lasso (C14)

  private finishLasso(g: Extract<Gesture, { kind: 'lasso' }>, e: PointerEvent) {
    const poly = g.rect ? rectPolygon(rectOf(g.pts[0], g.pts[g.pts.length - 1])) : g.pts;
    const b = bbox(poly);
    if ((b.w + b.h) * this.pxPerUnit < 10 || poly.length < 3) {
      this.tap(e, 'lasso');
      return;
    }
    const ids = lassoSelect(this.ctl.model.query(b), poly);
    if (ids.length) this.select(ids);
    else this.clearSelection();
  }

  // ------------------------------------------------------------------ selection transforms (C15)

  private startHandle(e: PointerEvent, handle: string, p: Pt) {
    const b = this.selBox!;
    if (handle === 'rotate') {
      const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      this.begin(e, { kind: 'transform', id: e.pointerId, mode: 'rotate', start: p, anchor: c, t: noMove(), moved: false, client: { x: e.clientX, y: e.clientY }, base: 0 });
    } else if (handle === 'width') {
      const o = this.ctl.get(this.sel[0]);
      if (o) this.begin(e, { kind: 'width', id: e.pointerId, target: o.id, start: p, w0: o.w });
    } else if (handle === 'a' || handle === 'b') {
      this.begin(e, { kind: 'endpoint', id: e.pointerId, target: this.sel[0], end: handle });
    } else {
      // corners: scale around the opposite corner
      const anchor = { x: handle.includes('w') ? b.x + b.w : b.x, y: handle.includes('n') ? b.y + b.h : b.y };
      this.begin(e, { kind: 'transform', id: e.pointerId, mode: 'scale', start: p, anchor, t: noMove(), moved: false, client: { x: e.clientX, y: e.clientY }, base: 0 });
    }
  }

  private selectedWithDependents(): CanvasObject[] {
    const objs = this.ctl.objectsOf(this.sel);
    const ids = new Set(this.sel);
    for (const o of [...objs]) {
      if (o.kind !== 'image') continue;
      for (const s of attachedStrokes(this.ctl.model.objects(), o)) if (!ids.has(s.id)) (ids.add(s.id), objs.push(s));
    }
    return objs;
  }

  private moveTransform(g: Extract<Gesture, { kind: 'transform' }>, e: PointerEvent) {
    const p = this.toCanvasPt(e.clientX, e.clientY);
    if (!g.moved) {
      if (Math.hypot(e.clientX - g.client.x, e.clientY - g.client.y) < 4) return;
      g.moved = true;
      const objs = this.selectedWithDependents();
      this.dragSprite = this.makeSprite(objs);
      this.hiddenDrag = new Set(objs.filter((o) => o.kind === 'stroke' || o.kind === 'shape').map((o) => o.id));
      // arrows connected to moving shapes follow live
      for (const o of objs) if (o.kind === 'shape') for (const c of this.ctl.connectedTo(o.id)) this.hiddenDrag.add(c.id);
      this.updateHidden();
    }
    if (g.mode === 'move') g.t = { ox: 0, oy: 0, s: 1, rot: 0, dx: p.x - g.start.x, dy: p.y - g.start.y };
    else if (g.mode === 'scale') {
      const d0 = Math.hypot(g.start.x - g.anchor.x, g.start.y - g.anchor.y) || 1;
      const d1 = Math.hypot(p.x - g.anchor.x, p.y - g.anchor.y);
      g.t = { ox: g.anchor.x, oy: g.anchor.y, s: Math.max(0.05, Math.min(20, d1 / d0)), rot: 0, dx: 0, dy: 0 };
    } else {
      const a0 = Math.atan2(g.start.y - g.anchor.y, g.start.x - g.anchor.x);
      const a1 = Math.atan2(p.y - g.anchor.y, p.x - g.anchor.x);
      let deg = ((a1 - a0) * 180) / Math.PI;
      const snap = Math.round(deg / 15) * 15;
      if (Math.abs(deg - snap) < 3) deg = snap;
      g.t = { ox: g.anchor.x, oy: g.anchor.y, s: 1, rot: deg, dx: 0, dy: 0 };
    }
    const objs = this.ctl.objectsOf(this.sel);
    const patches = transformSelection(objs, g.t, this.ctl);
    // DOM objects follow through the preview; ink connected to the selection is drawn wet
    const dom = new Map<string, ObjectPatch>();
    const extra: CanvasObject[] = [];
    const selected = new Set(this.sel);
    for (const [id, patch] of patches) {
      const o = this.ctl.get(id);
      if (!o) continue;
      if (o.kind === 'text' || o.kind === 'image' || o.kind === 'clip') dom.set(id, patch);
      else if (o.kind === 'shape' && !selected.has(id)) extra.push({ ...o, ...patch } as CanvasObject);
    }
    this.dragExtra = extra;
    this.preview.emit(dom);
    this.wetDirty = true;
    this.schedule();
  }

  private commitTransform(g: Extract<Gesture, { kind: 'transform' }>) {
    const sprite = this.dragSprite;
    const objs = this.ctl.objectsOf(this.sel);
    const patches = transformSelection(objs, g.t, this.ctl);
    this.pendingSprite = sprite ? { sprite, t: g.t, extra: this.dragExtra } : null;
    this.dragSprite = null;
    this.dragExtra = [];
    this.hiddenDrag.clear();
    this.ctl.update(patches);
    this.preview.emit(null);
    this.updateHidden();
    this.refreshSelection();
  }

  private commitEndpoint(g: Extract<Gesture, { kind: 'endpoint' }>, p: Pt) {
    const o = this.ctl.get(g.target);
    this.hiddenDrag.clear();
    this.dragExtra = [];
    if (o?.kind === 'shape' && (o.geometry.kind === 'line' || o.geometry.kind === 'arrow')) {
      const geometry = { ...o.geometry, [g.end]: { x: r1(p.x), y: r1(p.y) } };
      // glue the end to a shape it was dropped on
      const tol = 10 / this.pxPerUnit;
      const target = this.ctl.model
        .query({ x: p.x - tol, y: p.y - tol, w: 2 * tol, h: 2 * tol })
        .filter((s) => s.kind === 'shape' && s.id !== o.id && s.geometry.kind !== 'line' && s.geometry.kind !== 'arrow')
        .find((s) => hitObject(s, p, tol));
      const connects: [string | null, string | null] = [...(o.connects ?? [null, null])] as [string | null, string | null];
      connects[g.end === 'a' ? 0 : 1] = target?.id ?? null;
      const { x, y, w, h } = shapeFrame(geometry, o.lineWidth);
      this.ctl.update([[o.id, { geometry, connects: connects[0] || connects[1] ? connects : undefined, x, y, w, h }]]);
      this.pendingWet = [{ ...o, geometry }];
    }
    this.updateHidden();
    this.refreshSelection();
  }

  // ------------------------------------------------------------------ space insertion (C4)

  private startSpace(axis: Axis, split: number): SpaceState {
    const all = [...this.ctl.model.objects()];
    const { items, members } = spaceUnits(all);
    const setup = prepareSpace({ items, visible: this.view, axis, split });
    const ids = (list: { id: string }[]) => list.flatMap((u) => members.get(u.id) ?? []);
    const beforeObjs = this.ctl.objectsOf(ids(setup.before));
    const afterObjs = this.ctl.objectsOf(ids(setup.after));
    const s: SpaceState = { axis, split, setup, members, plan: null, sprites: { before: this.makeSprite(beforeObjs), after: this.makeSprite(afterObjs) } };
    this.hiddenSpace = new Set([...beforeObjs, ...afterObjs].filter((o) => o.kind === 'stroke' || o.kind === 'shape').map((o) => o.id));
    this.updateHidden();
    this.hint.emit(axis === 'y' ? 'Space: spread to insert, pinch to remove' : 'Space (horizontal)');
    return s;
  }

  private updateSpace(s: SpaceState, before: number, after: number) {
    s.plan = planSpace(s.setup, before, after);
    const dom = new Map<string, ObjectPatch>();
    for (const side of [s.setup.before, s.setup.after]) {
      for (const u of side) {
        const d = s.plan.moves.get(u.id);
        if (!d) continue;
        for (const id of s.members.get(u.id) ?? []) {
          const o = this.ctl.get(id);
          if (o && (o.kind === 'text' || o.kind === 'image' || o.kind === 'clip')) dom.set(id, s.axis === 'y' ? { y: o.y + d } : { x: o.x + d });
        }
      }
    }
    this.preview.emit(dom);
    this.wetDirty = true;
    this.schedule();
  }

  private commitSpace(s: SpaceState) {
    const plan = s.plan;
    this.hint.emit(null);
    this.preview.emit(null);
    if (plan && plan.moves.size) {
      const patches: [string, ObjectPatch][] = [];
      for (const [unit, d] of plan.moves) {
        for (const id of s.members.get(unit) ?? []) {
          const o = this.ctl.get(id);
          if (o) patches.push([id, translateObject(o, s.axis === 'x' ? d : 0, s.axis === 'y' ? d : 0)]);
        }
      }
      // keep showing the moved ink until the tiles have it
      const sprites: CanvasObject[] = [];
      for (const [id, patch] of patches) {
        const o = this.ctl.get(id);
        if (o && (o.kind === 'stroke' || o.kind === 'shape') && rectsIntersect(objectBounds(o), this.view)) sprites.push({ ...o, ...patch } as CanvasObject);
      }
      this.ctl.update(patches);
      this.pendingWet = sprites;
    }
    this.hiddenSpace.clear();
    this.updateHidden();
  }

  // ------------------------------------------------------------------ two fingers (C2, C4)

  private startTwo() {
    const prev = this.gesture;
    // a finger stroke just started becomes a pinch; anything else in progress is dropped
    if (prev && prev.kind !== 'two') this.cancelGesture();
    const ids = [...this.touches.keys()].slice(0, 2) as [number, number];
    const p0: [Pt, Pt] = [this.local(this.touches.get(ids[0])!.x, this.touches.get(ids[0])!.y), this.local(this.touches.get(ids[1])!.x, this.touches.get(ids[1])!.y)];
    const g: Extract<Gesture, { kind: 'two' }> = { kind: 'two', ids, p0, cam0: { ...this.camera }, mode: 'pending', t0: performance.now(), timer: null, ref: null, space: null, moved: false };
    const spaceTool = useTools.getState().tool === 'space';
    if (spaceTool) {
      g.mode = 'space';
      g.ref = p0;
    } else {
      // C4: two fingers held still switch the pinch from zooming to inserting space
      g.timer = setTimeout(() => {
        if (this.gesture === g && g.mode === 'pending') {
          g.mode = 'space';
          g.ref = this.twoPoints(g);
          this.hint.emit('Space: spread to insert, pinch to remove');
          if (navigator.vibrate) navigator.vibrate(10);
        }
      }, this.prefs().spaceHoldMs);
    }
    this.gesture = g;
  }

  private twoPoints(g: Extract<Gesture, { kind: 'two' }>): [Pt, Pt] {
    const a = this.touches.get(g.ids[0]);
    const b = this.touches.get(g.ids[1]);
    return [a ? this.local(a.x, a.y) : g.p0[0], b ? this.local(b.x, b.y) : g.p0[1]];
  }

  private moveTwo(g: Extract<Gesture, { kind: 'two' }>) {
    const [a, b] = this.twoPoints(g);
    if (g.mode === 'pending') {
      const moved = Math.max(Math.hypot(a.x - g.p0[0].x, a.y - g.p0[0].y), Math.hypot(b.x - g.p0[1].x, b.y - g.p0[1].y));
      if (moved < 10) return;
      if (g.timer) clearTimeout(g.timer);
      g.mode = 'pinch';
    }
    g.moved = true;
    if (g.mode === 'pinch') {
      const m0 = mid(g.p0[0], g.p0[1]);
      const m1 = mid(a, b);
      const d0 = Math.hypot(g.p0[0].x - g.p0[1].x, g.p0[0].y - g.p0[1].y);
      const d1 = Math.hypot(a.x - b.x, a.y - b.y);
      this.setCamera(pinch(g.cam0, this.base, m0, d0, m1, d1));
      return;
    }
    // space mode
    const ref = g.ref ?? g.p0;
    if (!g.space) {
      const sep0 = { x: ref[1].x - ref[0].x, y: ref[1].y - ref[0].y };
      const sep1 = { x: b.x - a.x, y: b.y - a.y };
      const ddx = Math.abs(sep1.x) - Math.abs(sep0.x);
      const ddy = Math.abs(sep1.y) - Math.abs(sep0.y);
      if (Math.max(Math.abs(ddx), Math.abs(ddy)) < 10) return;
      const axis = dominantAxis(ddx, ddy);
      const midC = toCanvas(this.camera, this.base, (ref[0].x + ref[1].x) / 2, (ref[0].y + ref[1].y) / 2);
      g.space = this.startSpace(axis, axis === 'y' ? midC.y : midC.x);
      const c0 = axis === 'y' ? ref[0].y : ref[0].x;
      const c1 = axis === 'y' ? ref[1].y : ref[1].x;
      g.space.beforeFinger = c0 <= c1 ? 0 : 1;
    }
    const s = g.space;
    const k = this.pxPerUnit;
    const bi = s.beforeFinger ?? 0;
    const cur = [a, b];
    const delta = (i: number) => (s.axis === 'y' ? cur[i].y - ref[i].y : cur[i].x - ref[i].x) / k;
    this.updateSpace(s, delta(bi), delta(1 - bi));
  }

  private endTwo(g: Extract<Gesture, { kind: 'two' }>) {
    if (g.timer) clearTimeout(g.timer);
    this.gesture = null;
    this.hint.emit(null);
    if (g.space) this.commitSpace(g.space);
    else if (!g.moved && performance.now() - g.t0 < 300 && g.mode === 'pending') {
      // two-finger tap: undo
      this.ctl.model.undo();
    }
    this.touches.clear();
    this.wetDirty = true;
    this.schedule();
  }

  // ------------------------------------------------------------------ test hooks

  /** Starts recording frame times (performance test). */
  recordFrames(on: boolean): number[] {
    const out = this.frameTimes ?? [];
    this.frameTimes = on ? [] : null;
    this.lastFrame = 0;
    return out;
  }
}

function noMove(): Affine {
  return { ox: 0, oy: 0, s: 1, rot: 0, dx: 0, dy: 0 };
}

function mid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function rectOf(a: Pt, b: Pt): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function ptsOf(flat: number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 3) out.push({ x: flat[i], y: flat[i + 1] });
  return out;
}

function rectPolygonRotated(o: CanvasObject): Pt[] {
  const poly = rectPolygon(o);
  if (!o.rotation) return poly;
  const c = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
  const a = (o.rotation * Math.PI) / 180;
  return poly.map((p) => ({ x: c.x + (p.x - c.x) * Math.cos(a) - (p.y - c.y) * Math.sin(a), y: c.y + (p.x - c.x) * Math.sin(a) + (p.y - c.y) * Math.cos(a) }));
}

