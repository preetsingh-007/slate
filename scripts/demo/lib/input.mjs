/**
 * Visible, human-paced input for the recording: the pointer glides to its target before it
 * presses, typing has a natural rhythm, pen strokes are real pen pointer events with pressure
 * (DevTools Input.dispatchMouseEvent, like tests/e2e/canvas-helpers.ts), and shortcuts show
 * their keys on screen.
 */
import { sleep } from './util.mjs';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Director {
  constructor(page, rec) {
    this.page = page;
    this.rec = rec;
    this.x = 900;
    this.y = 560;
  }

  async cdp() {
    if (!this._cdp) this._cdp = await this.page.context().newCDPSession(this.page);
    return this._cdp;
  }

  wait(ms) {
    return sleep(ms);
  }

  /** Shows a caption card; holds `ms` afterwards. */
  async caption(c, ms = 0) {
    if (c && this.capPos && !c.pos) c = { ...c, pos: this.capPos };
    await this.page.evaluate((c) => window.__demo?.caption(c), c ?? null);
    if (ms) await sleep(ms);
  }

  /** Shows a full-screen section title for `ms`, then reveals the app. */
  async section(c, ms = 1900) {
    await this.page.evaluate(([c, ms]) => window.__demo?.section(c, ms), [c, ms]);
    await sleep(ms + 450);
  }

  async keys(list, ms) {
    await this.page.evaluate(([l, m]) => window.__demo?.keys(l, m), [list, ms]);
  }

  /** Client centre of a locator (scrolled into view). */
  async centre(loc, dx = 0.5, dy = 0.5) {
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const b = await loc.boundingBox();
    if (!b) throw new Error(`not visible: ${loc}`);
    return [b.x + b.width * dx, b.y + b.height * dy];
  }

  async point(target) {
    return Array.isArray(target) ? target : this.centre(target);
  }

  /** Moves the mouse smoothly to (x, y). Each move waits for a frame, so steps follow the clock. */
  async glide(x, y, ms) {
    const d = Math.hypot(x - this.x, y - this.y);
    const dur = ms ?? Math.min(650, 220 + d * 0.45);
    const x0 = this.x;
    const y0 = this.y;
    const t0 = Date.now();
    for (;;) {
      const k = Math.min(1, (Date.now() - t0 + 16) / dur);
      const e = ease(k);
      await this.page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e);
      if (this.syncPointer) await this.page.evaluate(([x, y]) => window.__demo?.at(x, y, 'mouse'), [x0 + (x - x0) * e, y0 + (y - y0) * e]);
      if (k >= 1) break;
    }
    this.x = x;
    this.y = y;
    await this.page.evaluate(([x, y]) => window.__demo?.at(x, y, 'mouse'), [x, y]);
  }

  async hover(target, ms) {
    const [x, y] = await this.point(target);
    await this.glide(x, y, ms);
  }

  async click(target, { hold = 70, after = 250, before = 120, ms } = {}) {
    const [x, y] = await this.point(target);
    await this.glide(x, y, ms);
    await sleep(before);
    if (this.syncPointer) await this.page.evaluate(([x, y]) => window.__demo?.tap(x, y), [x, y]);
    await this.page.mouse.down();
    await sleep(hold);
    await this.page.mouse.up();
    await sleep(after);
  }

  async dblclick(target) {
    const [x, y] = await this.point(target);
    await this.glide(x, y);
    await sleep(120);
    await this.page.mouse.dblclick(x, y);
    await sleep(250);
  }

  /** Presses at `from`, drags along a path or to `to` over `ms`. */
  async drag(from, to, { ms = 700, hold = 120, after = 200 } = {}) {
    const [x0, y0] = await this.point(from);
    await this.glide(x0, y0);
    await sleep(100);
    await this.page.mouse.down();
    await sleep(hold);
    const path = Array.isArray(to[0]) ? to : [to];
    const pts = [[x0, y0], ...path];
    // walk the polyline with easing over the whole path, following the clock
    const segs = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      segs.push(l);
      total += l;
    }
    const t0 = Date.now();
    for (;;) {
      const k = Math.min(1, (Date.now() - t0 + 16) / ms);
      let dist = ease(k) * total;
      let i = 0;
      while (i < segs.length - 1 && dist > segs[i]) dist -= segs[i++];
      const f = segs[i] ? Math.min(1, dist / segs[i]) : 1;
      const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f;
      const y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
      await this.page.mouse.move(x, y);
      if (this.syncPointer) await this.page.evaluate(([x, y]) => window.__demo?.at(x, y, 'mouse'), [x, y]);
      this.x = x;
      this.y = y;
      if (k >= 1) break;
    }
    await sleep(80);
    await this.page.mouse.up();
    await sleep(after);
  }

  /** Types into the focused element at a natural pace. */
  async type(text, { delay = 38 } = {}) {
    for (const ch of text) {
      if (ch === '\n') await this.page.keyboard.press('Enter');
      else await this.page.keyboard.insertText(ch).catch(() => this.page.keyboard.type(ch));
      await sleep(delay * (0.6 + Math.random() * 0.8) + (ch === ' ' ? 25 : 0));
    }
  }

  /** Types with key events (for fields that listen to keys). */
  async typeKeys(text, { delay = 38 } = {}) {
    for (const ch of text) {
      if (ch === '\n') await this.page.keyboard.press('Enter');
      else await this.page.keyboard.type(ch);
      await sleep(delay * (0.6 + Math.random() * 0.8));
    }
  }

  /** Presses a shortcut and shows its keys, e.g. press('Control+z', ['⌘', 'Z']). */
  async press(key, label, after = 350) {
    if (label) await this.keys(label);
    await sleep(label ? 200 : 0);
    await this.page.keyboard.press(key);
    await sleep(after);
  }

  async pen(type, x, y, force, buttons) {
    const s = await this.cdp();
    await s.send('Input.dispatchMouseEvent', { type, x, y, button: buttons ? 'left' : 'none', buttons, clickCount: 1, pointerType: 'pen', force });
  }

  /**
   * Draws strokes with the pen: each stroke is [[x, y, pressure?], ...] in client pixels.
   * Between strokes the pen hovers to the next start. `speed` is in pixels per millisecond.
   */
  async write(strokes, { speed = 0.9, gap = 40 } = {}) {
    const s = await this.cdp();
    // events are sent without waiting for each frame (the renderer keeps every point) and paced here
    const send = (type, x, y, buttons, force) =>
      s.send('Input.dispatchMouseEvent', { type, x, y, button: buttons || type === 'mouseReleased' ? 'left' : 'none', buttons, clickCount: 1, pointerType: 'pen', force }).catch(() => {});
    for (const st of strokes) {
      if (st.length < 2) continue;
      const pending = [];
      const [sx, sy] = st[0];
      // hover to the start
      const d = Math.hypot(sx - this.x, sy - this.y);
      const n = Math.min(10, Math.max(2, Math.round(d / 30)));
      for (let i = 1; i <= n; i++) {
        const k = ease(i / n);
        pending.push(send('mouseMoved', this.x + (sx - this.x) * k, this.y + (sy - this.y) * k, 0, 0));
        await sleep(Math.min(14, 4 + d / n / 3));
      }
      await sleep(gap * 0.5);
      pending.push(send('mousePressed', sx, sy, 1, st[0][2] ?? 0.4));
      let px = sx;
      let py = sy;
      let budget = 0;
      for (const [x, y, p] of st.slice(1)) {
        pending.push(send('mouseMoved', x, y, 1, p ?? 0.6));
        budget += Math.hypot(x - px, y - py) / speed;
        px = x;
        py = y;
        if (budget >= 12) {
          await sleep(budget);
          budget = 0;
        }
      }
      const [ex, ey] = st[st.length - 1];
      pending.push(send('mouseReleased', ex, ey, 0, 0));
      await Promise.all(pending);
      this.x = ex;
      this.y = ey;
      await sleep(gap);
    }
  }

  /** Smooth wheel scrolling (ctrl: zoom) at the current pointer position. */
  async wheel(dx, dy, { ctrl = false, ms = 600 } = {}) {
    const steps = Math.max(3, Math.round(ms / 16));
    if (ctrl) await this.page.keyboard.down('Control');
    for (let i = 0; i < steps; i++) {
      await this.page.mouse.wheel(dx / steps, dy / steps);
      await sleep(ms / steps - 2);
    }
    if (ctrl) await this.page.keyboard.up('Control');
  }
}
