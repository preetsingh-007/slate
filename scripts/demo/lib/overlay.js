/**
 * In-page overlay for the demo recording (installed with context.addInitScript; never part of
 * the app): a pointer indicator that follows mouse, pen and touch input with a ripple on each
 * press, a caption card at the bottom, and a keycap chip for keyboard shortcuts. Everything
 * lives in a closed shadow root above the app with pointer-events: none, so it cannot change
 * how the app behaves. Controlled from the recorder through window.__demo.
 */
(() => {
  if (window.top !== window || window.__demo) return;
  const css = `
    :host { all: initial; }
    .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; font-family: Inter, system-ui, sans-serif; }
    .ptr { position: fixed; left: 0; top: 0; width: 0; height: 0; transition: opacity .25s; opacity: 0; will-change: transform; }
    .ptr.on { opacity: 1; }
    .ptr .ring { position: absolute; left: -13px; top: -13px; width: 26px; height: 26px; border-radius: 50%;
      background: rgba(47, 111, 222, .18); border: 2px solid rgba(47, 111, 222, .75); box-shadow: 0 1px 4px rgba(0,0,0,.18);
      transition: transform .12s, background .12s; }
    .ptr.down .ring { transform: scale(.78); background: rgba(47, 111, 222, .35); }
    .ptr.pen .ring { left: -7px; top: -7px; width: 14px; height: 14px; background: rgba(31, 35, 40, .08); border: 2px solid rgba(31, 35, 40, .55); }
    .ptr.pen.down .ring { transform: scale(.6); background: rgba(31, 35, 40, .25); }
    .ptr .tip { display: none; position: absolute; left: 4px; top: -46px; width: 14px; height: 52px; transform-origin: 0 100%; transform: rotate(28deg); }
    .ptr.pen .tip { display: block; }
    .ripple { position: fixed; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; border: 2px solid rgba(47,111,222,.8);
      animation: rip .5s ease-out forwards; }
    @keyframes rip { from { transform: scale(.3); opacity: .9; } to { transform: scale(1.3); opacity: 0; } }
    .cap { position: fixed; left: 50%; bottom: 26px; transform: translate(-50%, 12px); max-width: min(860px, calc(100vw - 48px)); width: max-content;
      background: rgba(28, 31, 36, .92); color: #fff; border-radius: 14px; padding: 13px 22px 14px; box-shadow: 0 10px 30px rgba(0,0,0,.25);
      opacity: 0; transition: opacity .35s ease, transform .35s ease; backdrop-filter: blur(6px); }
    .cap.on { opacity: 1; transform: translate(-50%, 0); }
    .cap.top { bottom: auto; top: 112px; }
    .cap.left { left: 24px; transform: translate(0, 12px); max-width: min(800px, calc(100vw - 48px)); }
    .cap.left.on { transform: none; }
    .cap.right { box-sizing: border-box; left: auto; right: 24px; transform: translate(0, 12px); width: auto; max-width: 400px; }
    .cap.right.on { transform: none; }
    .kicker { font-size: 11.5px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: #8fb4ff; margin-bottom: 3px; }
    .title { font-size: 21px; font-weight: 600; line-height: 1.25; letter-spacing: -.005em; }
    .body { font-size: 15.5px; font-weight: 400; line-height: 1.4; color: rgba(255,255,255,.82); margin-top: 3px; }
    .body b { color: #fff; font-weight: 600; }
    .body code { font: 500 14px 'JetBrains Mono', ui-monospace, monospace; background: rgba(255,255,255,.14); padding: 1px 6px; border-radius: 5px; color: #fff; }
    .keys { position: fixed; right: 26px; bottom: 30px; display: flex; gap: 6px; opacity: 0; transform: translateY(8px); transition: opacity .2s, transform .2s; }
    .keys.on { opacity: 1; transform: none; }
    .key { min-width: 34px; height: 38px; padding: 0 10px; box-sizing: border-box; border-radius: 8px; background: #fff; color: #1f2328;
      border: 1px solid #c9ced6; border-bottom-width: 3px; font: 600 17px Inter, system-ui, sans-serif; display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 14px rgba(0,0,0,.15); }
    .sec { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
      background: rgba(250, 249, 246, .9); backdrop-filter: blur(10px); opacity: 0; transition: opacity .5s ease; }
    .sec.on { opacity: 1; }
    .sec .num { font: 700 15px Inter, system-ui, sans-serif; letter-spacing: .14em; color: #2f6fde; text-transform: uppercase; }
    .sec .h { font: 700 54px/1.1 Inter, system-ui, sans-serif; letter-spacing: -.02em; color: #1f2328; transform: translateY(8px); transition: transform .6s ease; }
    .sec.on .h { transform: none; }
    .sec .sub { font: 400 21px Inter, system-ui, sans-serif; color: #57606a; max-width: 820px; text-align: center; line-height: 1.4; }
    .phone .cap { bottom: 16px; max-width: calc(100vw - 24px); padding: 10px 14px; }
    .phone .title { font-size: 16px; }
    .phone .body { font-size: 13px; }
  `;
  const PEN_SVG = `<svg viewBox="0 0 14 52" width="14" height="52"><path d="M7 52 L3 40 L3 4 Q3 0 7 0 Q11 0 11 4 L11 40 Z" fill="#f4f4f2" stroke="#9aa1ab" stroke-width="1"/><path d="M7 52 L5 46 L9 46 Z" fill="#6e7681"/></svg>`;

  let host, root, ptr, cap, keys;
  const state = { x: -100, y: -100, kind: 'mouse', visible: false };

  function mount() {
    if (host) return;
    host = document.createElement('demo-overlay');
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${css}</style><div class="layer"><div class="ptr"><div class="tip">${PEN_SVG}</div><div class="ring"></div></div><div class="cap"></div><div class="keys"></div><div class="sec"></div></div>`;
    ptr = root.querySelector('.ptr');
    cap = root.querySelector('.cap');
    keys = root.querySelector('.keys');
    document.documentElement.appendChild(host);
    // the app's toasts sit above the caption card while recording
    const st = document.createElement('style');
    st.textContent = '.toast-host { bottom: 132px !important; }';
    document.documentElement.appendChild(st);
    place();
  }
  function ensure() {
    if (!host) mount();
    else if (!host.isConnected) document.documentElement.appendChild(host);
  }
  function place() {
    if (!ptr) return;
    ptr.style.transform = `translate(${state.x}px, ${state.y}px)`;
    ptr.classList.toggle('pen', state.kind === 'pen');
    ptr.classList.toggle('on', state.visible);
  }
  function ripple(x, y) {
    ensure();
    const r = document.createElement('div');
    r.className = 'ripple';
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    root.querySelector('.layer').appendChild(r);
    setTimeout(() => r.remove(), 600);
  }
  const opts = { capture: true, passive: true };
  addEventListener('pointermove', (e) => {
    ensure();
    state.x = e.clientX;
    state.y = e.clientY;
    state.kind = e.pointerType === 'pen' ? 'pen' : 'mouse';
    state.visible = true;
    place();
  }, opts);
  addEventListener('pointerdown', (e) => {
    ensure();
    state.x = e.clientX;
    state.y = e.clientY;
    state.kind = e.pointerType === 'pen' ? 'pen' : 'mouse';
    ptr.classList.add('down');
    place();
    if (e.pointerType !== 'pen') ripple(e.clientX, e.clientY);
  }, opts);
  addEventListener('pointerup', () => ptr && ptr.classList.remove('down'), opts);
  addEventListener('pointercancel', () => ptr && ptr.classList.remove('down'), opts);

  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  // **bold** in caption bodies
  const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
  let keyTimer = 0;
  window.__demo = {
    /** Shows a caption ({ kicker, title, body, top }) or hides it (null). */
    caption(c) {
      ensure();
      if (!c) {
        cap.classList.remove('on');
        return;
      }
      const show = () => {
        cap.innerHTML = `${c.kicker ? `<div class="kicker">${esc(c.kicker)}</div>` : ''}<div class="title">${rich(c.title)}</div>${c.body ? `<div class="body">${rich(c.body)}</div>` : ''}`;
        cap.classList.toggle('top', !!c.top);
        cap.classList.toggle('left', c.pos === 'left');
        cap.classList.toggle('right', c.pos === 'right');
        cap.classList.add('on');
      };
      if (cap.classList.contains('on')) {
        cap.classList.remove('on');
        setTimeout(show, 260);
      } else show();
    },
    /** Shows keycaps (['⌘', 'Z']) for a moment. */
    keys(list, ms = 1400) {
      ensure();
      keys.innerHTML = list.map((k) => `<div class="key">${esc(k)}</div>`).join('');
      keys.classList.add('on');
      clearTimeout(keyTimer);
      keyTimer = setTimeout(() => keys.classList.remove('on'), ms);
    },
    /** Moves the indicator (input inside cross-origin frames does not reach this page). */
    at(x, y, kind) {
      ensure();
      state.x = x;
      state.y = y;
      if (kind) state.kind = kind;
      state.visible = true;
      place();
    },
    /** A ripple where a press happened inside a frame. */
    tap(x, y) {
      ripple(x, y);
    },
    pointer(visible) {
      ensure();
      state.visible = visible;
      place();
    },
    /** A section title over the app, faded out after `ms`. */
    section(c, ms = 1800) {
      ensure();
      const el = root.querySelector('.sec');
      if (!c) {
        el.classList.remove('on');
        return;
      }
      el.innerHTML = `${c.num ? `<div class="num">${esc(c.num)}</div>` : ''}<div class="h">${esc(c.title)}</div>${c.sub ? `<div class="sub">${rich(c.sub)}</div>` : ''}`;
      el.classList.add('on');
      if (ms) setTimeout(() => el.classList.remove('on'), ms);
    },
    phone(on) {
      ensure();
      root.querySelector('.layer').classList.toggle('phone', on);
    },
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
