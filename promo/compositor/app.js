/*
 * خلك طبيعي — promo compositor.
 *
 * A deterministic motion-graphics timeline: window.renderAt(t) poses every
 * element for time t (seconds). Scene timing is anchored to the narration
 * (../build/timings.json), so re-voicing the script re-times the film.
 * This is the short cut (script/short.json), voiced by a human narrator.
 * Screens shown inside the phones/TV are genuine captures of the real game
 * (../assets/capture), recorded by promo/capture/capture.mjs.
 *
 * window.CUES lists sound-design hit points; the renderer exports them to
 * ../build/cues.json so the audio mix lands on the exact frames.
 */

// ---------------------------------------------------------------- math -----
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const E = {
  lin: (t) => t,
  out: (t) => 1 - (1 - t) ** 3,
  out5: (t) => 1 - (1 - t) ** 5,
  in: (t) => t ** 3,
  io: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  back: (t) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
  spring: (t) => (t >= 1 ? 1 : 1 - Math.exp(-6.5 * t) * Math.cos(11 * t)),
};
/** progress 0→1 of an animation starting at a lasting d */
const P = (t, a, d, e = E.out) => e(clamp((t - a) / d));
const mix = (a, b, p) => a + (b - a) * p;
/** 0→1→0 visibility window with fades */
const vis = (t, a, b, fi = 0.25, fo = 0.25) => Math.min(P(t, a, fi, E.lin), 1 - P(t, b - fo, fo, E.lin));
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ----------------------------------------------------------------- dom -----
const stage = document.getElementById("stage");
const pending = [];
function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  (parent ?? stage).appendChild(e);
  return e;
}
const svgNS = "http://www.w3.org/2000/svg";
function sv(tag, attrs, parent) {
  const e = document.createElementNS(svgNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  parent?.appendChild(e);
  return e;
}
/** Pose an element whose left/top is its anchor point. */
function S(e, o = {}) {
  const { x = 0, y = 0, s = 1, sx, sy, r = 0, ry = 0, rx = 0, o: op = 1, blur = 0, anchor = "c" } = o;
  const base = anchor === "b" ? "translate(-50%,-100%)" : anchor === "tl" ? "" : "translate(-50%,-50%)";
  const rot = ry || rx ? ` perspective(1800px) rotateX(${rx}deg) rotateY(${ry}deg)` : "";
  const sc = sx != null || sy != null ? `scale(${sx ?? s},${sy ?? s})` : `scale(${s})`;
  e.style.transform = `${base} translate(${x}px,${y}px)${rot} rotate(${r}deg) ${sc}`;
  e.style.opacity = op;
  e.style.visibility = op <= 0.002 ? "hidden" : "visible";
  e.style.filter = blur > 0.05 ? `blur(${blur}px)` : "";
}
function at(e, cx, cy) { e.style.left = `${cx}px`; e.style.top = `${cy}px`; return e; }

const cap = (n) => `../assets/capture/${encodeURIComponent(n)}.webp`;
function img(name, parent) {
  const i = new Image();
  i.src = cap(name);
  i.decoding = "sync";
  parent.appendChild(i);
  pending.push(i.decode().catch(() => console.warn("missing", name)));
  return i;
}

/** A stack of screenshots inside a clipped box; view({name: opacity}). */
function stack(parent, names, w, offX = 0, offY = 0) {
  const imgs = {};
  for (const n of names) {
    const i = img(n, parent);
    i.style.width = `${w}px`;
    i.style.left = `${offX}px`;
    i.style.top = `${offY}px`;
    i.style.opacity = 0;
    imgs[n] = i;
  }
  return {
    imgs,
    view(weights) { for (const n in imgs) imgs[n].style.opacity = weights[n] ?? 0; },
    /** schedule: [[time, name], ...] → crossfaded */
    seq(t, schedule, fade = 0.12) {
      const w = {};
      for (let k = 0; k < schedule.length; k += 1) {
        const [t0, n] = schedule[k];
        const t1 = schedule[k + 1]?.[0] ?? 1e9;
        const a = k === 0 ? 1 : P(t, t0, fade, E.lin);
        const b = t1 >= 1e9 ? 1 : 1 - P(t, t1, fade, E.lin);
        w[n] = Math.max(w[n] ?? 0, Math.min(a, b) * (t >= t0 - (k === 0 ? 1e9 : 0) ? 1 : 0));
      }
      this.view(w);
    },
  };
}

const PHONE_AR = 844 / 390;
function makePhone(parent, names, w, cx, cy) {
  const e = at(el("div", "phone", parent), cx, cy);
  const sw = w - 28;
  e.style.width = `${w}px`;
  e.style.height = `${sw * PHONE_AR + 28}px`;
  const screen = el("div", "screen", e);
  const st = stack(screen, names, sw);
  el("div", "island", e);
  const fx = el("div", "abs", screen);
  fx.style.inset = "0";
  el("div", "glare", e);
  return { e, st, sw, sh: sw * PHONE_AR, fx };
}
function makeTV(parent, names, w, cx, cy) {
  const e = at(el("div", "tv", parent), cx, cy);
  const sw = w - 20;
  e.style.width = `${w}px`;
  e.style.height = `${(sw * 9) / 16 + 20}px`;
  const screen = el("div", "screen", e);
  const st = stack(screen, names, sw);
  el("div", "glare", e);
  return { e, st };
}
/** Crop (sx,sy,sw,sh) of source images of width srcW, shown dw wide. */
function makeCrop(parent, names, srcW, [sx, sy, sw, sh], dw, cx, cy, radius = 36) {
  const e = at(el("div", "crop", parent), cx, cy);
  const k = dw / sw;
  e.style.width = `${dw}px`;
  e.style.height = `${sh * k}px`;
  e.style.borderRadius = `${radius}px`;
  const st = stack(e, names, srcW * k, -sx * k, -sy * k);
  return { e, st, k };
}

// ------------------------------------------------------------- characters --
const SEAT = {
  "فهد": "#7c3aed",
  "نورة": "#db2777",
  "سعود": "#0f9f8a",
  "ريم": "#d97706",
  "خالد": "#2563eb",
};
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const t = amt < 0 ? [5, 3, 11] : [255, 255, 255];
  const p = Math.abs(amt);
  r = Math.round(r + (t[0] - r) * p); g = Math.round(g + (t[1] - g) * p); b = Math.round(b + (t[2] - b) * p);
  return `rgb(${r},${g},${b})`;
}
let gradId = 0;
/**
 * A player drawn in the language of the game's own mark (ui/EyesMark.tsx):
 * a hooded figure peeking out of the dark, tinted with their seat colour.
 */
function makeChar(parent, name, cx, baseY, scale = 1) {
  const color = SEAT[name];
  const root = at(el("div", "char", parent), cx, baseY);
  const s = sv("svg", { viewBox: "0 0 200 250" }, root);
  const id = `g${gradId += 1}`;
  const defs = sv("defs", {}, s);
  const rg = sv("radialGradient", { id: `${id}h`, cx: "50%", cy: "28%", r: "78%" }, defs);
  sv("stop", { offset: "0%", "stop-color": shade(color, 0.45) }, rg);
  sv("stop", { offset: "55%", "stop-color": color }, rg);
  sv("stop", { offset: "100%", "stop-color": shade(color, -0.72) }, rg);
  const rf = sv("radialGradient", { id: `${id}f`, cx: "50%", cy: "45%", r: "60%" }, defs);
  sv("stop", { offset: "0%", "stop-color": "#130a26" }, rf);
  sv("stop", { offset: "100%", "stop-color": "#05030b" }, rf);
  const mg = sv("linearGradient", { id: `${id}m`, x1: "0", y1: "0", x2: "1", y2: "1" }, defs);
  sv("stop", { offset: "0%", "stop-color": "#f5b8ff" }, mg);
  sv("stop", { offset: "100%", "stop-color": "#b026c9" }, mg);

  const g = sv("g", { transform: "translate(19,58) scale(1.35)" }, s);
  const armColor = shade(color, -0.25);
  const handColor = shade(color, 0.3);
  function arm(side) {
    const a = sv("g", {}, g);
    sv("line", { x1: 0, y1: 0, x2: 0, y2: -58, stroke: armColor, "stroke-width": 12, "stroke-linecap": "round" }, a);
    const hand = sv("g", { transform: "translate(0,-64)" }, a);
    const fingers = [];
    for (let k = 0; k < 5; k += 1) {
      const ang = -44 + k * 22;
      const f = sv("rect", { x: -3.4, y: -19, width: 6.8, height: 13, rx: 3.4, fill: handColor, transform: `rotate(${ang})` }, hand);
      fingers.push(f);
    }
    const thumb = sv("rect", { x: -3.4, y: -17, width: 6.8, height: 12, rx: 3.4, fill: handColor, transform: `rotate(${side > 0 ? -95 : 95})` }, hand);
    sv("circle", { cx: 0, cy: 0, r: 10, fill: handColor }, hand);
    const pointer = sv("rect", { x: -3.4, y: -24, width: 6.8, height: 18, rx: 3.4, fill: handColor }, hand);
    const sx = side > 0 ? 96 : 24;
    return { a, sx, fingers, thumb, pointer, side, hand };
  }
  const armL = arm(-1);
  const armR = arm(1);
  sv("path", { d: "M60 8c26 0 46 21 46 50v42c0 7-5 12-12 12H26c-7 0-12-5-12-12V58C14 29 34 8 60 8Z", fill: `url(#${id}h)` }, g);
  sv("ellipse", { cx: 60, cy: 66, rx: 36, ry: 32, fill: `url(#${id}f)` }, g);
  const mask = sv("g", { opacity: 0 }, g);
  sv("path", { d: "M3 8.5c0-1.1.9-2 2-2 2.3 0 4.4.8 7 .8s4.7-.8 7-.8c1.1 0 2 .9 2 2 0 5.3-3.2 9-6.2 9-1.7 0-2.1-1.8-2.8-1.8s-1.1 1.8-2.8 1.8C6.2 17.5 3 13.8 3 8.5Z", fill: `url(#${id}m)`, transform: "translate(11,19) scale(4.1)" }, mask);
  const eyes = sv("g", {}, g);
  sv("ellipse", { cx: 45, cy: 64, rx: 11, ry: 13, fill: "#f6f0ff" }, eyes);
  sv("ellipse", { cx: 75, cy: 64, rx: 11, ry: 13, fill: "#f6f0ff" }, eyes);
  const pupils = sv("g", {}, eyes);
  sv("circle", { cx: 45, cy: 66, r: 5.5, fill: "#1a0b33" }, pupils);
  sv("circle", { cx: 75, cy: 66, r: 5.5, fill: "#1a0b33" }, pupils);
  sv("circle", { cx: 43.4, cy: 64, r: 1.6, fill: "#fff" }, pupils);
  sv("circle", { cx: 73.4, cy: 64, r: 1.6, fill: "#fff" }, pupils);
  const lids = sv("g", {}, g); // eyelids for the sly squint
  const lidL = sv("rect", { x: 32, y: 49, width: 26, height: 0, fill: `url(#${id}f)` }, lids);
  const lidR = sv("rect", { x: 62, y: 49, width: 26, height: 0, fill: `url(#${id}f)` }, lids);

  const label = el("div", "name", root, name);
  const q = el("div", "qmark", root, "؟");
  const crown = el("div", "crown", root);
  crown.innerHTML = `<svg viewBox="0 0 24 24" width="110" height="110"><path d="M4 17.5 3 7.5l5 4 4-6 4 6 5-4-1 10H4Z" fill="#fbc75a" stroke="#fff3c4" stroke-width="0.6"/></svg>`;
  const pe = [el("div", "qmark", root, "👈"), el("div", "qmark", root, "👉")];
  pe.forEach((e) => { e.style.cssText += "font-size:70px;width:90px;margin-left:0;top:0;left:0;text-shadow:none;"; });
  const badge = el("div", "qmark", root, "");
  badge.style.cssText += "font-size:64px;color:#fff;width:96px;margin-left:-48px;height:96px;line-height:100px;border-radius:50%;background:rgb(124 58 237 / 0.9);box-shadow:0 0 40px rgb(139 92 246 / 0.9);text-shadow:none;top:-70px";
  const zz = el("div", "qmark", root, "💤");
  zz.style.fontSize = "64px";

  const state = {};
  function pose(o = {}) {
    const {
      x = 0, y = 0, s = 1, o: op = 1, r = 0,
      armL: al = -150, armR: ar = 150, fingersL = 5, fingersR = 5, pointR = false, pointL = false,
      gx = 0, gy = 0, blink = 0, squint = 0, mask: mk = 0, q: qq = 0, qr = 0, crown: cr = 0, zz: zzz = 0, hop = 0, glow = 0, label: lb = 1, badge: bd = 0, badgeText = "",
    } = o;
    S(root, { x, y: y - hop, s: s * scale, o: op, r, anchor: "b" });
    for (const [A, ang, n, pt] of [[armL, al, fingersL, pointL], [armR, ar, fingersR, pointR]]) {
      A.a.setAttribute("transform", `translate(${A.sx},70) rotate(${ang})`);
      A.fingers.forEach((f, k) => { f.style.display = !pt && k < n ? "" : "none"; });
      A.thumb.style.display = !pt && n >= 5 ? "" : "none";
      A.pointer.style.display = "none";
      A.hand.style.display = pt ? "none" : "";
      const rad = (ang * Math.PI) / 180;
      const hx = 19 + 1.35 * (A.sx + 64 * Math.sin(rad)), hy = 58 + 1.35 * (70 - 64 * Math.cos(rad));
      const e = pe[A.side > 0 ? 1 : 0];
      S(e, { anchor: "tl", x: hx - 45, y: hy - 45, o: pt ? 1 : 0, r: (A.side > 0 ? ang - 90 : ang + 90) * 0.6 });
    }
    pupils.setAttribute("transform", `translate(${gx * 4.5},${gy * 3.5})`);
    const b = Math.max(blink, 0);
    eyes.setAttribute("transform", `translate(0,${64 * b}) scale(1,${1 - b})`);
    lidL.setAttribute("height", 26 * squint);
    lidR.setAttribute("height", 26 * squint);
    mask.setAttribute("opacity", mk);
    mask.setAttribute("transform", `translate(60,64) scale(${0.6 + 0.4 * E.back(clamp(mk))}) translate(-60,-64)`);
    S(q, { anchor: "tl", s: E.back(clamp(qq)), o: clamp(qq * 3), r: qr, x: -40 });
    S(crown, { anchor: "tl", x: -55, y: mix(-90, -30, E.out(clamp(cr))), o: clamp(cr * 2), s: 1 });
    if (badge.textContent !== badgeText) badge.textContent = badgeText;
    S(badge, { anchor: "tl", x: 60, y: -20 * bd, s: E.back(clamp(bd)), o: clamp(bd * 3) });
    S(zz, { anchor: "tl", x: 10, y: -10 - 20 * zzz, o: zzz, s: 0.8 + 0.2 * zzz });
    label.style.opacity = lb;
    root.style.filter = glow > 0 ? `drop-shadow(0 0 ${30 * glow}px ${glow > 0 ? "rgb(217 70 239 / 0.9)" : "transparent"})` : "";
  }
  pose();
  return { root, pose, name, cx, baseY };
}

function makeAvatar(parent, name, size, cx, cy) {
  const a = at(el("div", "avatar", parent, name[0]), cx, cy);
  a.style.width = a.style.height = `${size}px`;
  a.style.fontSize = `${size * 0.46}px`;
  a.style.background = SEAT[name];
  return a;
}

function eyesMark(size) {
  return `<svg viewBox="0 0 120 120" width="${size}" height="${size}">
  <defs>
    <radialGradient id="em-hood${size}" cx="50%" cy="30%" r="75%"><stop offset="0%" stop-color="#9b6bff"/><stop offset="55%" stop-color="#5b21b6"/><stop offset="100%" stop-color="#1e0b44"/></radialGradient>
    <radialGradient id="em-face${size}" cx="50%" cy="45%" r="60%"><stop offset="0%" stop-color="#130a26"/><stop offset="100%" stop-color="#05030b"/></radialGradient>
  </defs>
  <path d="M60 8c26 0 46 21 46 50v42c0 7-5 12-12 12H26c-7 0-12-5-12-12V58C14 29 34 8 60 8Z" fill="url(#em-hood${size})"/>
  <ellipse cx="60" cy="66" rx="36" ry="32" fill="url(#em-face${size})"/>
  <g class="em-eyes"><ellipse cx="45" cy="64" rx="11" ry="13" fill="#f6f0ff"/><ellipse cx="75" cy="64" rx="11" ry="13" fill="#f6f0ff"/>
  <g class="em-pupils"><circle cx="41" cy="66" r="5.5" fill="#1a0b33"/><circle cx="71" cy="66" r="5.5" fill="#1a0b33"/><circle cx="39.4" cy="64" r="1.6" fill="#fff"/><circle cx="69.4" cy="64" r="1.6" fill="#fff"/></g></g>
</svg>`;
}
function poseMark(root, { gx = 0, gy = 0, blink = 0 }) {
  root.querySelector(".em-pupils").setAttribute("transform", `translate(${4 + gx * 5},${gy * 3})`);
  root.querySelector(".em-eyes").setAttribute("transform", `translate(0,${64 * blink}) scale(1,${1 - blink})`);
}

function chip(parent, html, cx, cy, cls = "") {
  return at(el("div", `chip ${cls}`, parent, html), cx, cy);
}
function tag(parent, step, text) {
  return el("div", "tag", parent, `<b>${step}</b>${text}`);
}

// ------------------------------------------------------------ timeline -----
const TM = await fetch("../build/timings.json").then((r) => r.json());
const B = (id) => TM.beats.find((b) => b.id === id);
const C = (id) => TM.chunks.find((c) => c.id === id);
/** time at fraction f through a chunk's speech */
const CF = (id, f) => { const c = C(id); return c.start + (c.end - c.start) * f; };
const END = TM.duration + 0.1;
const CUES = [];
const cue = (t, type, extra = {}) => CUES.push({ t: +t.toFixed(3), type, ...extra });

// ---------------------------------------------------------- background -----
const bg = el("div", "layer");
const glows = [
  { e: el("div", "bg-glow", bg), w: 1300, h: 1100, c: "rgb(124 58 237 / 0.34)", x: 540, y: 520 },
  { e: el("div", "bg-glow", bg), w: 900, h: 900, c: "rgb(217 70 239 / 0.16)", x: 860, y: 1420 },
  { e: el("div", "bg-glow", bg), w: 1000, h: 800, c: "rgb(76 29 149 / 0.30)", x: 160, y: 1300 },
];
for (const g of glows) {
  g.e.style.width = `${g.w}px`; g.e.style.height = `${g.h}px`;
  g.e.style.background = `radial-gradient(closest-side, ${g.c}, transparent)`;
  at(g.e, g.x, g.y);
}
const tintLayer = el("div", "layer");
tintLayer.style.background = "radial-gradient(70% 50% at 50% 45%, rgb(217 70 239 / 0.28), transparent 70%)";

const scenesLayer = el("div", "layer");
const flash = el("div", "layer flash");
const vignette = el("div", "layer vignette");
const grainCanvas = el("canvas", "layer grain");
grainCanvas.width = 540; grainCanvas.height = 960;
grainCanvas.style.width = "1080px"; grainCanvas.style.height = "1920px";
const gctx = grainCanvas.getContext("2d");
const grainTiles = [];
{
  const R = rng(7);
  for (let k = 0; k < 8; k += 1) {
    const d = gctx.createImageData(540, 960);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = 128 + (R() - 0.5) * 200;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
      d.data[i + 3] = 255;
    }
    grainTiles.push(d);
  }
}
const capLayer = el("div", "cap-wrap");

// -------------------------------------------------------------- captions ---
function fmtCap(s) {
  return s
    .replace(/(خلك طبيعي)/g, "<strong>$1</strong>")
    .replace(/(المتخفية|المتخفي|متخفّي)/g, "<em>$1</em>")
    .replace(/(انكشف!|نجا!|انمسك!|ارفع يدك!)/g, "<strong>$1</strong>")
    .replace(/([+]?\d+(?:–\d+)?)/g, '<span class="num">$1</span>');
}
if (TM.wordless) document.body.classList.add("wordless");
const caps = TM.chunks.filter((c) => c.cap).map((c) => {
  const k = TM.chunks.indexOf(c);
  const e = el("div", "cap", capLayer, fmtCap(c.cap));
  const next = TM.chunks[k + 1];
  // clean hand-over: the previous card is gone before the next fades in
  const a = c.start - 0.02;
  const b = Math.min(next ? next.start - 0.07 : END, c.end + 0.45);
  return { e, a, b };
});
function renderCaptions(t) {
  for (const c of caps) {
    const v = vis(t, c.a, c.b, 0.12, 0.06);
    const rise = (1 - P(t, c.a, 0.28, E.out)) * 22;
    c.e.style.opacity = v;
    c.e.style.visibility = v > 0.002 ? "visible" : "hidden";
    c.e.style.transform = `translateY(${rise}px) scale(${0.97 + 0.03 * P(t, c.a, 0.28)})`;
  }
}

// ---------------------------------------------------------------- scenes ---
// Short cut: one scene per narration beat (script/short.json s1…s12). Every
// time below is derived from the narrator's real phrase timings.
const scenes = [];
function scene(id, from, to, build, opts = {}) {
  const root = el("div", "layer", scenesLayer);
  const s = { id, from, to, root, tint: opts.tint ?? (() => 0), fadeIn: opts.fadeIn ?? 0.18, fadeOut: opts.fadeOut ?? 0.2 };
  s.render = build(root, s);
  scenes.push(s);
  return s;
}
const ROW = ["ريم", "نورة", "سعود", "فهد", "خالد"]; // left → right on screen
const rowX = (i, gap = 200) => 540 + (i - 2) * gap;
const nxt = (id) => B(id).start + 0.12; // small overlap into the next beat
const BASE = 1200;                       // character baseline, clear of captions

/* s1 · HOOK — everyone raises a hand, one of them has no idea why ---------- */
scene("hook", 0, nxt("s2"), (root) => {
  const spot = at(el("div", "bg-glow", root), 540, 1000);
  spot.style.width = "1150px"; spot.style.height = "760px";
  spot.style.background = "radial-gradient(closest-side, rgb(167 139 250 / 0.35), transparent)";
  const cam = el("div", "layer", root);
  cam.style.transformOrigin = "540px 1030px";
  const chars = ROW.map((n, i) => makeChar(cam, n, rowX(i, 205), BASE - 20, 1.15));
  const tRaise = CF("s1.0", 0.5);
  const tZoom = C("s1.1").start - 0.1;
  const tLate = CF("s1.1", 0.85);
  cue(tRaise, "whoosh");
  cue(tRaise + 0.35, "question");
  return (t) => {
    const zoom = P(t, tZoom, 0.9, E.io);
    cam.style.transform = `scale(${1 + 0.6 * zoom})`;
    chars.forEach((c, i) => {
      const imp = c.name === "سعود";
      const blink = 1 - P(t, 0.02 + i * 0.04, 0.25, E.out);
      const up = P(t, tRaise + i * 0.02, 0.25, E.back);
      const idle = Math.sin(t * 2.4 + i) * 3;
      if (!imp) {
        c.pose({ y: idle, armR: mix(150, 12, up), blink, gx: mix(0, i < 2 ? 0.7 : -0.7, P(t, tZoom, 0.5)), o: mix(1, 0.35, zoom) });
      } else {
        const dart = t > tRaise ? Math.sin((t - tRaise) * 11) : 0;
        const late = P(t, tLate, 0.5, E.out);
        const wobble = late > 0 && late < 1 ? Math.sin(t * 40) * 6 * (1 - late) : 0;
        c.pose({ y: idle, armR: mix(150, 40, late) + wobble, blink, gx: dart * 0.95, gy: -0.2, q: P(t, tRaise + 0.35, 0.3), qr: Math.sin(t * 6) * 8 });
      }
    });
  };
}, { fadeIn: 0.01 });

/* s2 · TITLE — quick brand hit, then the mask lands on one player ---------- */
scene("title", B("s2").start, nxt("s3"), (root) => {
  const mark = at(el("div", "abs", root, eyesMark(250)), 540, 450);
  const brand = at(el("div", "brand abs", root, "خلك طبيعي"), 540, 700);
  brand.style.fontSize = "160px";
  const sub = chip(root, '<span class="emo">🎉</span> لعبة جماعية', 540, 880);
  const mini = ROW.map((n, i) => makeChar(root, n, rowX(i, 175), BASE, 0.78));
  const t0 = B("s2").start;
  const tSub = C("s2.1").start;
  const tMask = CF("s2.2", 0.45);
  cue(t0, "impact");
  cue(tMask, "mask");
  return (t) => {
    const lt = t - t0;
    const m = P(lt, 0, 0.45, E.spring);
    S(mark, { s: 0.35 + 0.65 * m, o: P(lt, 0, 0.1), y: -30 * (1 - m) });
    poseMark(mark, { gx: Math.sin(lt * 2.6) * 0.9 });
    const w = P(lt, 0.12, 0.38, E.io);
    brand.style.clipPath = `inset(0 0 0 ${100 - w * 100}%)`;
    S(brand, { s: 0.94 + 0.06 * w, o: w > 0 ? 1 : 0 });
    S(sub, { s: E.back(P(t, tSub, 0.35, E.lin)), o: P(t, tSub, 0.1) });
    mini.forEach((c, i) => {
      const inn = P(t, tSub + 0.05 + i * 0.05, 0.4, E.back);
      const imp = c.name === "سعود";
      const mk = imp ? P(t, tMask, 0.3, E.lin) : 0;
      const look = P(t, tMask + 0.12, 0.25);
      const dir = imp ? 0 : i < 2 ? 1 : -1;
      c.pose({ o: clamp(inn * 2), y: 50 * (1 - inn) + Math.sin(t * 2 + i) * 2, mask: mk, gx: dir * look, squint: imp ? 0.35 * mk : 0, glow: imp ? mk : 0, label: 0 });
    });
  };
}, { tint: (t) => P(t, CF("s2.2", 0.45), 0.3, E.lin) * 0.5 });

/* s3 · JOIN — phones + TV in one quick shot --------------------------------- */
scene("join", B("s3").start, nxt("s4"), (root) => {
  const tv = makeTV(root, ["tv_01_lobby_filling", "tv_02_lobby_full"], 960, 540, 470);
  const A = makePhone(root, ["03_owner_lobby_empty", "05_owner_lobby_full"], 330, 330, 1000);
  const Bp = makePhone(root, ["04_join_code", "05_player_lobby"], 330, 750, 1010);
  const free = chip(root, '<span class="emo">⚡</span> بدون تحميل ولا تسجيل', 540, 790, "green");
  const t0 = B("s3").start;
  const tJoin = t0 + 0.6;
  const tFree = C("s3.1").start;
  cue(tJoin, "join"); cue(tJoin + 0.25, "join");
  return (t) => {
    const lt = t - t0;
    const eT = P(lt, 0, 0.4, E.out5);
    tv.st.seq(t, [[0, "tv_01_lobby_filling"], [tJoin + 0.25, "tv_02_lobby_full"]], 0.15);
    S(tv.e, { y: -200 * (1 - eT), o: clamp(eT * 2), s: 0.94 + 0.06 * eT });
    const eA = P(lt, 0.08, 0.45, E.out5), eB = P(lt, 0.18, 0.45, E.out5);
    A.st.seq(t, [[0, "03_owner_lobby_empty"], [tJoin, "05_owner_lobby_full"]], 0.12);
    Bp.st.seq(t, [[0, "04_join_code"], [tJoin, "05_player_lobby"]], 0.12);
    S(A.e, { y: 500 * (1 - eA) + Math.sin(lt * 1.4) * 4, r: -5, ry: 8, o: clamp(eA * 2) });
    S(Bp.e, { y: 500 * (1 - eB) + Math.sin(lt * 1.3 + 1) * 4, r: 5, ry: -8, o: clamp(eB * 2) });
    S(free, { s: E.back(P(t, tFree, 0.35, E.lin)), o: P(t, tFree, 0.1) });
  };
});

/* s4 · SECRET — same curtain for everyone; the impostor's opens on a mask ---- */
scene("secret", B("s4").start, nxt("s5"), (root) => {
  const N = makePhone(root, ["c1_2_prompt_normal_نورة"], 430, 300, 800);
  const X = makePhone(root, ["c1_1_curtain", "c1_2_prompt_IMPOSTOR_سعود"], 430, 780, 800);
  const nChip = chip(root, `<span class="avatar" style="position:static;width:46px;height:46px;font-size:23px;background:${SEAT["نورة"]}">ن</span> نورة`, 300, 290);
  const sChip = chip(root, `<span class="avatar" style="position:static;width:46px;height:46px;font-size:23px;background:${SEAT["سعود"]}">س</span> سعود`, 780, 290);
  const t0 = B("s4").start;
  const tImp = C("s4.1").start - 0.08;
  cue(tImp, "flip"); cue(tImp + 0.2, "impostor");
  return (t) => {
    const lt = t - t0;
    const eN = P(lt, 0, 0.45, E.out5), eX = P(lt, 0.1, 0.45, E.out5);
    N.st.view({ c1_2_prompt_normal_نورة: 1 });
    const flip = P(t, tImp, 0.4, E.io);
    X.st.view({ [flip < 0.5 ? "c1_1_curtain" : "c1_2_prompt_IMPOSTOR_سعود"]: 1 });
    const imp = P(t, tImp + 0.2, 0.4, E.out);
    X.e.classList.toggle("impostor", flip >= 0.5);
    S(N.e, { x: -400 * (1 - eN), r: -3, ry: 10, o: mix(1, 0.55, imp), s: mix(1, 0.94, imp) });
    S(X.e, { x: 400 * (1 - eX), r: 3, ry: -10 + (flip < 0.5 ? flip * 180 : (flip - 1) * 180), s: mix(1, 1.07, imp), o: clamp(eX * 2) });
    S(nChip, { o: clamp(eN * 2) * mix(1, 0.6, imp) });
    S(sChip, { o: clamp(eX * 2) });
    sChip.classList.toggle("magenta", flip >= 0.5);
    sChip.innerHTML = sChip.innerHTML.replace(" 🎭", "") + (flip >= 0.5 ? " 🎭" : "");
  };
}, { tint: (t) => P(t, C("s4.1").start + 0.1, 0.35, E.lin) * 0.8 });

/* s5 · COUNTDOWN — the game's own dial, one number per spoken count --------- */
const T_ACTION = C("s5.3").start - 0.04;
scene("count", B("s5").start - 0.05, T_ACTION + 0.06, (root) => {
  const names = ["tv_c1_3_count_3", "tv_c1_3_count_2", "tv_c1_3_count_1"];
  const dial = makeCrop(root, names, 1920, [470, 110, 980, 700], 1040, 540, 760, 0);
  dial.e.style.maskImage = "radial-gradient(closest-side, #000 70%, transparent 100%)";
  dial.e.style.webkitMaskImage = dial.e.style.maskImage;
  const tC = ["s5.0", "s5.1", "s5.2"].map((id) => C(id).start - 0.03);
  tC.forEach((tc, k) => cue(tc, "tick", { step: 3 - k }));
  return (t) => {
    const k = t < tC[1] ? 0 : t < tC[2] ? 1 : 2;
    dial.st.view({ [names[k]]: 1 });
    const pulse = 1 + 0.08 * (1 - P(t, tC[k], 0.3, E.out));
    S(dial.e, { o: P(t, tC[0] - 0.1, 0.12), s: pulse * (1 + 0.06 * P(t, tC[0], T_ACTION - tC[0], E.lin)) });
  };
}, { fadeIn: 0.05, fadeOut: 0.04 });

/* s5.3 + s6 · ACTION — «ارفع يدك!» then the impostor copies the room ---------- */
scene("action", T_ACTION, nxt("s7"), (root) => {
  const burst = makeCrop(root, ["tv_c1_4_action"], 1920, [300, 60, 1320, 900], 1240, 540, 640, 0);
  burst.e.style.maskImage = "radial-gradient(closest-side, #000 60%, transparent 100%)";
  burst.e.style.webkitMaskImage = burst.e.style.maskImage;
  const hold = makeCrop(root, ["tv_c1_5_hold"], 1920, [560, 180, 800, 520], 640, 540, 430, 40);
  const chars = ROW.map((n, i) => makeChar(root, n, rowX(i, 205), BASE, 1.12));
  const tRaise = T_ACTION + 0.12;
  const tCopy = CF("s6.0", 0.6);
  const tHold = C("s6.1").start - 0.1;
  const tSmug = CF("s6.1", 0.7);
  cue(T_ACTION, "action");
  cue(tHold, "hold");
  return (t) => {
    const lt = t - T_ACTION;
    const up = P(lt, 0.45, 0.6, E.io);
    S(burst.e, { o: vis(t, T_ACTION - 0.02, tHold + 0.2, 0.03, 0.25), y: -300 * up, s: (1.12 - 0.12 * P(lt, 0, 0.4, E.out) + (lt < 0.2 ? Math.sin(lt * 90) * 0.012 : 0)) * mix(1, 0.62, up) });
    burst.st.view({ tv_c1_4_action: 1 });
    hold.st.view({ tv_c1_5_hold: 1 });
    S(hold.e, { o: P(t, tHold, 0.25), y: -20 * (1 - P(t, tHold, 0.4)) });
    chars.forEach((c, i) => {
      const imp = c.name === "سعود";
      const inn = P(t, T_ACTION + 0.05, 0.25, E.out);
      const upA = imp ? P(t, tCopy, 0.35, E.back) : P(t, tRaise + i * 0.015, 0.2, E.back);
      const look = P(t, tHold, 0.35);
      const dart = imp && t < tCopy + 0.25 ? Math.sin((t - tRaise) * 12) : 0;
      const atHim = i < 2 ? 1 : i > 2 ? -1 : 0;
      c.pose({
        o: inn, y: 40 * (1 - inn) + Math.sin(t * 2 + i) * 2,
        armR: mix(150, imp ? 22 : 10 + (i % 2) * 8, upA),
        gx: imp ? (t < tCopy + 0.25 ? dart : mix(0, Math.sin(t * 2) * 0.7, look)) : atHim * 0.8 * look + Math.sin(t + i) * 0.2,
        squint: imp ? 0.45 * P(t, tSmug, 0.25) : 0.25 * look,
        q: imp ? vis(t, tRaise + 0.1, tCopy + 0.15, 0.15, 0.15) : 0, qr: Math.sin(t * 7) * 8,
      });
    });
  };
}, { fadeIn: 0.02 });

/* s7 · REVEAL — the prompt goes public, suspicion spreads -------------------- */
scene("reveal", B("s7").start, nxt("s8"), (root) => {
  const rev = makeCrop(root, ["tv_c1_6_reveal"], 1920, [330, 250, 1260, 560], 980, 540, 520, 40);
  const shine = el("div", "abs", rev.e);
  shine.style.cssText += "left:0;top:0;width:100%;height:100%;background:linear-gradient(100deg,transparent 30%,rgb(255 255 255 / 0.22) 50%,transparent 70%)";
  const chars = ROW.map((n, i) => makeChar(root, n, rowX(i, 205), BASE, 1.05));
  const t0 = B("s7").start;
  const tSus = C("s7.1").start;
  cue(t0 + 0.02, "reveal");
  return (t) => {
    const lt = t - t0;
    rev.st.view({ tv_c1_6_reveal: 1 });
    S(rev.e, { o: P(lt, 0, 0.2), s: 0.92 + 0.08 * P(lt, 0, 0.45, E.back) });
    shine.style.transform = `translateX(${mix(-120, 120, P(lt, 0.1, 0.8, E.io))}%)`;
    const lower = P(t, t0 + 0.5, 0.4, E.io);
    const sus = P(t, tSus, 0.35);
    chars.forEach((c, i) => {
      const imp = c.name === "سعود";
      const gaze = imp ? Math.sin(t * 3.5) * 0.7 : [1, 1, 0, -1, -1][i] * (i % 2 ? 1 : -1);
      c.pose({
        armR: mix(imp ? 22 : 12, 150, lower), y: Math.sin(t * 2 + i) * 2,
        gx: mix(Math.sin(t + i) * 0.3, gaze, sus), squint: imp ? 0 : 0.4 * sus,
        q: imp ? 0 : P(t, tSus + 0.08 + i * 0.06, 0.25) * 0.9, qr: Math.sin(t * 5 + i) * 10,
      });
    });
  };
});

/* s8 · VOTE → CAUGHT ----------------------------------------------------------- */
scene("vote", B("s8").start, nxt("s9"), (root) => {
  const V = makePhone(root, ["c1_9_vote_picked", "c1_9b_voted_waiting"], 430, 540, 790);
  const lock = chip(root, '<span class="emo">🔒</span> تصويت سري', 540, 290);
  const rip = el("div", "ripple", V.fx);
  const tip = el("div", "fingertip", V.fx);
  const ring = [["فهد", -2.05], ["نورة", -1.0], ["ريم", 1.0], ["خالد", 2.05]];
  const cx = 540, cy = 760, R = 340;
  const center = makeAvatar(root, "سعود", 180, cx, cy);
  const around = ring.map(([n, a]) => ({ n, a, e: makeAvatar(root, n, 120, cx + Math.sin(a) * R, cy - Math.cos(a) * R * 0.95) }));
  const votes = [["نورة", "سعود"], ["فهد", "سعود"], ["ريم", "سعود"], ["خالد", "فهد"]];
  const lines = votes.map(() => el("div", "arrow-line", root));
  const count = at(el("div", "bigword", root, ""), 0, 0);
  count.style.fontSize = "120px"; count.style.top = "420px"; count.style.left = "0";
  const res = makeCrop(root, ["c2_10_result_normal_نورة"], 1170, [60, 190, 1050, 1000], 840, 540, 760, 48);
  res.e.style.boxShadow = "0 0 0 3px rgb(236 132 251 / 0.6), 0 0 140px -20px rgb(217 70 239 / 0.9)";
  const parts = [];
  const R2 = rng(42);
  for (let k = 0; k < 60; k += 1) {
    const p = at(el("div", "particle", root), 540, 760);
    p.style.background = ["#c4b5fd", "#ec84fb", "#ffffff", "#8b5cf6", "#fbc75a"][k % 5];
    p.style.width = `${8 + R2() * 14}px`; p.style.height = `${6 + R2() * 10}px`;
    parts.push({ p, a: R2() * Math.PI * 2, v: 500 + R2() * 900, spin: (R2() - 0.5) * 1400, g: 900 + R2() * 500 });
  }
  const t0 = B("s8").start;
  const tTap1 = CF("s8.0", 0.35), tTap2 = CF("s8.0", 0.72);
  const tRing = C("s8.1").start - 0.1;
  const dRing = Math.max(0.5, C("s8.2").start - tRing - 0.15);
  const tV = [0.15, 0.35, 0.55, 0.72].map((f) => tRing + f * dRing);
  const tSlam = C("s8.2").start - 0.03;
  cue(tTap1, "tap"); cue(tTap2, "tap"); cue(tTap2 + 0.08, "vote");
  tV.forEach((tv, k) => cue(tv, "vote", { n: k + 1 }));
  cue(tSlam, "caught");
  return (t) => {
    const lt = t - t0;
    V.st.seq(t, [[0, "c1_9_vote_picked"], [tTap2 + 0.12, "c1_9b_voted_waiting"]]);
    const out1 = P(t, tRing - 0.15, 0.25, E.in);
    S(V.e, { y: 300 * (1 - P(lt, 0, 0.4, E.out5)) + 160 * out1, ry: 6, s: 1 - 0.12 * out1, o: 1 - out1 });
    S(lock, { s: E.back(P(t, t0 + 0.15, 0.35, E.lin)), o: P(t, t0 + 0.15, 0.1) * (1 - out1) });
    const pos = t < tTap1 + 0.2 ? [0.31, 0.37] : [0.62, 0.905];
    const tapT = t < tTap1 + 0.2 ? tTap1 : tTap2;
    at(tip, V.sw * pos[0], V.sh * pos[1]); at(rip, V.sw * pos[0], V.sh * pos[1]);
    S(tip, { o: vis(t, tTap1 - 0.25, tTap2 + 0.2, 0.12, 0.12) });
    S(rip, { o: vis(t, tapT, tapT + 0.35, 0.02, 0.25), s: 0.3 + 1.1 * P(t, tapT, 0.35) });
    const gone = P(t, tSlam - 0.08, 0.18, E.in);
    const ringIn = P(t, tRing, 0.3, E.back);
    S(center, { s: ringIn * (1 + 0.08 * P(t, tV[2], 0.2) * (1 - P(t, tV[2] + 0.2, 0.2))), o: clamp(ringIn * 2) * (1 - gone) });
    around.forEach(({ e }, k) => S(e, { s: P(t, tRing + k * 0.04, 0.3, E.back), o: (1 - gone) * (t >= tRing ? 1 : 0) }));
    votes.forEach(([from, to], k) => {
      const A = around.find((x) => x.n === from);
      const T = to === "سعود" ? null : around.find((x) => x.n === to);
      const toP = T ? { x: cx + Math.sin(T.a) * R, y: cy - Math.cos(T.a) * R * 0.95 } : { x: cx, y: cy };
      const fx = cx + Math.sin(A.a) * R, fy = cy - Math.cos(A.a) * R * 0.95;
      const dx = toP.x - fx, dy = toP.y - fy, len = Math.hypot(dx, dy) - (T ? 70 : 100) - 60;
      const p = P(t, tV[k], 0.22, E.out);
      const l = lines[k], ang = Math.atan2(dy, dx);
      l.style.left = `${fx + Math.cos(ang) * 60}px`; l.style.top = `${fy + Math.sin(ang) * 60}px`;
      l.style.width = `${Math.max(0, len)}px`;
      l.style.transform = `rotate(${ang}rad) scaleX(${p})`;
      l.style.opacity = (T ? 0.35 : 1) * (1 - gone) * (p > 0 ? 1 : 0);
    });
    const n = t < tV[0] ? 0 : t < tV[1] ? 1 : t < tV[2] ? 2 : 3;
    count.innerHTML = n ? `<span class="num">${n}</span> <span style="font-size:0.4em">من</span> <span class="num">5</span>` : "";
    S(count, { o: (n ? 1 : 0) * (1 - gone), s: 1 + 0.12 * (1 - P(t, tV[Math.max(0, n - 1)], 0.2)), anchor: "tl" });
    count.style.color = n === 3 ? "#6ee7a8" : "#fff";
    res.st.view({ c2_10_result_normal_نورة: 1 });
    const sl = P(t, tSlam, 0.3, E.out5);
    const shake = t > tSlam && t < tSlam + 0.35 ? Math.sin((t - tSlam) * 80) * 14 * (1 - (t - tSlam) / 0.35) : 0;
    S(res.e, { o: clamp(sl * 3), s: mix(1.5, 1, sl), x: shake, y: shake * 0.5 });
    parts.forEach((q) => {
      const dt = t - tSlam;
      if (dt < 0 || dt > 2) { q.p.style.opacity = 0; return; }
      S(q.p, { x: Math.cos(q.a) * q.v * dt, y: Math.sin(q.a) * q.v * dt * 0.8 + 0.5 * q.g * dt * dt, r: q.spin * dt, o: 1 - clamp((dt - 1.1) / 0.9) });
    });
  };
}, { tint: (t) => vis(t, C("s8.2").start - 0.03, B("s9").start + 0.1, 0.08, 0.3) });

/* s9 · MODES — three moves, one per phrase --------------------------------- */
scene("modes", B("s9").start, nxt("s10"), (root) => {
  const modes = [["🙋", "ارفع يدك", "ارفع يدك إذا تحب الكزبرة."], ["👉", "أشر على شخص", "أشر على اللي ممكن ينام بنص الفيلم."], ["🔢", "ارفع أصابعك", "من آخر 5 أيام، كم يوم شربت قهوة؟"]];
  const labels = modes.map(([i, l, p]) => {
    const e = at(el("div", "headline", root, `<div style="font-size:92px;line-height:1.1">${i} ${l}</div><div style="font-size:38px;font-weight:700;color:#ddd3ff;margin-top:14px">«${p}»</div>`), 0, 0);
    e.style.left = "0"; e.style.top = "360px";
    return e;
  });
  const all = modes.map(([i, l], k) => chip(root, `<span class="emo">${i}</span> ${l}`, 540, 380 + k * 118));
  const chars = ROW.map((n, i) => makeChar(root, n, rowX(i, 205), BASE, 1.1));
  const tm = ["s9.0", "s9.1", "s9.2"].map((id) => C(id).start - 0.06);
  const tAll = C("s9.3").start - 0.05;
  tm.forEach((x) => cue(x, "swish"));
  const hands = { "ريم": 1, "نورة": 0, "سعود": 1, "فهد": 1, "خالد": 0 };
  const fingers = { "ريم": 5, "نورة": 3, "سعود": 0, "فهد": 4, "خالد": 2 };
  return (t) => {
    const k = t < tm[1] ? 0 : t < tm[2] ? 1 : 2;
    labels.forEach((e, j) => {
      const v = vis(t, tm[j], j < 2 ? tm[j + 1] + 0.05 : tAll + 0.05, 0.12, 0.12);
      S(e, { anchor: "tl", o: v, y: 30 * (1 - P(t, tm[j], 0.25)), s: 1 });
    });
    all.forEach((c, j) => S(c, { s: E.back(P(t, tAll + j * 0.08, 0.3, E.lin)), o: P(t, tAll + j * 0.08, 0.08) }));
    chars.forEach((c, i) => {
      const n = c.name;
      const act = P(t, tm[k] + 0.12 + i * 0.02, 0.22, E.back);
      const base = { o: P(t, tm[0], 0.2), y: Math.sin(t * 2 + i) * 2, gx: Math.sin(t * 0.8 + i) * 0.3 };
      if (k === 0) c.pose({ ...base, armR: mix(150, hands[n] ? 12 : 150, act) });
      else if (k === 1) {
        const ti = ROW.indexOf("خالد");
        const who = n === "خالد" ? ROW.indexOf("نورة") : ti;
        const dir = Math.sign(who - i) || 1;
        const ang = dir * mix(150, 62, act);
        const pose = dir > 0 ? { armR: ang, pointR: true } : { armL: ang, pointL: true };
        c.pose({ ...base, ...pose, gx: dir, zz: n === "خالد" ? P(t, tm[1] + 0.4, 0.3) : 0, squint: n === "خالد" ? 0.55 : 0 });
      } else c.pose({ ...base, armR: mix(150, 14, act), fingersR: fingers[n], badge: P(t, tm[2] + 0.35 + i * 0.05, 0.25, E.lin), badgeText: String(fingers[n]) });
    });
  };
});

/* s10 · POINTS — real score callouts from the match ------------------------- */
scene("points", B("s10").start, nxt("s11"), (root) => {
  const boxes = ["+1", "+2", "+3"].map((s, k) => {
    const b = at(el("div", "points-big", root, s), 0, 0);
    b.style.left = `${180 + k * 360 - 120}px`; b.style.top = "330px";
    return b;
  });
  const lbls = ["صح مرة", "مرتين ورا بعض", "3 مرات ورا بعض"].map((s, k) => {
    const d = at(el("div", "headline", root, s), 0, 0);
    d.style.width = "340px"; d.style.left = `${10 + k * 360}px`; d.style.top = "590px"; d.style.fontSize = "36px"; d.style.color = "#bdb2d9";
    return d;
  });
  const CALLOUT = [40, 1280, 1090, 320]; // «+N كسبت نقاط في هالدور» card on the 1170×2532 phone capture
  const good = makeCrop(root, ["c2_10_result_normal_نورة"], 1170, CALLOUT, 900, 540, 900, 36);
  good.e.style.boxShadow = "0 0 0 4px #6ee7a8, 0 0 90px -10px rgb(110 231 168 / 0.8)";
  const bad = makeCrop(root, ["c2_10_result_IMPOSTOR_سعود"], 1170, CALLOUT, 900, 540, 900, 36);
  bad.e.style.boxShadow = "0 0 0 4px #ec84fb, 0 0 110px -10px rgb(217 70 239 / 0.9)";
  const saud = makeChar(root, "سعود", 540, BASE + 10, 1.0);
  const t0 = B("s10").start;
  const tB = [CF("s10.0", 0.55), CF("s10.0", 0.72), CF("s10.0", 0.88)];
  const tI = C("s10.1").start - 0.05;
  const tWin = C("s10.2").start;
  tB.forEach((x, k) => cue(x, "point", { n: k + 1 }));
  cue(tWin + 0.05, "point", { n: 1 }); cue(tI + 0.1, "sly");
  return (t) => {
    const lt = t - t0;
    const out = P(t, tI - 0.1, 0.25, E.in);
    boxes.forEach((b, k) => {
      const ghost = P(lt, k * 0.06, 0.25) * (1 - out);
      const lit = P(t, tB[k], 0.1, E.lin);
      S(b, { anchor: "tl", s: 0.85 + 0.15 * P(t, tB[k], 0.35, E.back) + 0.12 * Math.sin(Math.PI * clamp((t - tB[k]) / 0.3)), o: ghost * (0.22 + 0.78 * lit), y: -60 * out });
      b.style.filter = lit < 1 ? `grayscale(${1 - lit})` : "";
      S(lbls[k], { anchor: "tl", o: ghost * (0.35 + 0.65 * lit), y: -60 * out });
    });
    good.st.view({ c2_10_result_normal_نورة: 1 });
    S(good.e, { o: P(lt, 0.15, 0.25) * (1 - out), y: 40 * (1 - P(lt, 0.15, 0.35)) + 80 * out, s: 1 });
    bad.st.view({ c2_10_result_IMPOSTOR_سعود: 1 });
    const eI = P(t, tWin, 0.35, E.back);
    S(bad.e, { o: clamp(eI * 2), s: 0.9 + 0.1 * eI, y: -380 });
    const inS = P(t, tI, 0.35, E.back);
    saud.pose({ o: clamp(inS * 2), y: 60 * (1 - inS) + Math.sin(t * 2.2) * 3, mask: P(t, tI + 0.1, 0.3, E.lin), squint: 0.5 * P(t, tWin, 0.25), glow: 0.8 * inS, armR: mix(150, 20, P(t, tWin, 0.3, E.back)), gx: -0.6 });
  };
}, { tint: (t) => P(t, C("s10.1").start, 0.3, E.lin) * 0.7 });

/* s11 · WINNER — final standings + Noura's crown ----------------------------- */
scene("winner", B("s11").start, nxt("s12"), (root) => {
  const G = makePhone(root, ["99_gameover_فهد"], 430, 330, 780);
  const noura = makeChar(root, "نورة", 790, BASE - 10, 1.35);
  const t0 = B("s11").start;
  const tCrown = CF("s11.1", 0.72);
  cue(tCrown, "crown");
  return (t) => {
    const lt = t - t0;
    G.st.view({ "99_gameover_فهد": 1 });
    const inn = P(lt, 0, 0.4, E.out5);
    G.e.style.transformOrigin = "50% 22%";
    S(G.e, { y: 320 * (1 - inn), r: -4, ry: 10, s: mix(1, 1.12, P(lt, 0.3, 1.4, E.io)) });
    const nIn = P(lt, 0.15, 0.4, E.back);
    noura.pose({ o: clamp(nIn * 2), y: 60 * (1 - nIn) + Math.sin(t * 2.2) * 3, squint: 0.45 * P(t, tCrown, 0.3), gx: -0.5, crown: P(t, tCrown, 0.45, E.back), armR: mix(150, 25, P(t, tCrown, 0.3, E.back)), armL: mix(-150, -25, P(t, tCrown + 0.05, 0.3, E.back)) });
  };
});

/* s12 · CTA — «الحين السؤال… تقدر تخدعهم؟ خلك طبيعي!» ------------------------------ */
scene("cta", B("s12").start, END + 1, (root) => {
  const cam = el("div", "layer", root);
  cam.style.transformOrigin = "540px 1050px";
  const chars = ROW.map((n, i) => makeChar(cam, n, rowX(i, 205), BASE - 20, 1.12));
  const mark = at(el("div", "abs", root, eyesMark(280)), 540, 520);
  const brand = at(el("div", "brand abs", root, "خلك طبيعي"), 540, 800);
  brand.style.fontSize = "172px";
  const info = at(el("div", "headline", root, '<span class="num">3–10</span> لاعبين · من الجوال · بدون تحميل'), 0, 0);
  info.style.left = "0"; info.style.top = "975px"; info.style.fontSize = "40px"; info.style.color = "#ddd3ff"; info.style.fontWeight = "800";
  const t0 = B("s12").start;
  const tStare = C("s12.1").start - 0.05;
  const tLogo = C("s12.2").start - 0.05;
  cue(tStare, "stare"); cue(tLogo, "logo");
  return (t) => {
    const stare = P(t, tStare, 0.3, E.out);
    const out = P(t, tLogo - 0.05, 0.2, E.in);
    cam.style.transform = `scale(${1 + 0.18 * stare})`;
    chars.forEach((c, i) => {
      const inn = P(t, t0 + i * 0.04, 0.35, E.back);
      c.pose({ o: clamp(inn * 2) * (1 - out), y: 60 * (1 - inn) + Math.sin(t * 2.5 + i) * 3 + 120 * out, gx: mix(Math.sin(t * 1.6 + i) * 0.8, 0, stare), gy: mix(0, 0.35, stare), blink: t > tStare + 0.35 && t < tStare + 0.5 ? 1 : 0 });
    });
    const m = P(t, tLogo, 0.5, E.spring);
    S(mark, { s: 0.3 + 0.7 * m, o: P(t, tLogo, 0.1), y: -30 * (1 - m) });
    const bl = t - (tLogo + 1.0);
    poseMark(mark, { gx: Math.sin((t - tLogo) * 2) * 0.8, blink: bl > 0 && bl < 0.2 ? Math.sin((bl / 0.2) * Math.PI) : 0 });
    const w = P(t, tLogo + 0.08, 0.4, E.io);
    brand.style.clipPath = `inset(0 0 0 ${100 - w * 100}%)`;
    S(brand, { s: 0.94 + 0.06 * w, o: w > 0 ? 1 : 0 });
    S(info, { anchor: "tl", o: P(t, tLogo + 0.5, 0.3), y: 16 * (1 - P(t, tLogo + 0.5, 0.4)) });
  };
}, { fadeOut: 0.01 });

// ------------------------------------------------------------------ render ---
function renderAt(t) {
  // background drift
  glows.forEach((g, k) => S(g.e, { x: Math.sin(t * 0.21 + k * 2) * 90, y: Math.cos(t * 0.17 + k) * 70, s: 1 + Math.sin(t * 0.3 + k) * 0.06 }));
  let tint = 0;
  let fl = 0;
  for (const s of scenes) {
    const on = t >= s.from - 0.001 && t < s.to;
    if (!on) { s.root.style.display = "none"; continue; }
    s.root.style.display = "";
    const fi = P(t, s.from, s.fadeIn, E.lin);
    const fo = 1 - P(t, s.to - s.fadeOut, s.fadeOut, E.lin);
    const out = P(t, s.to - s.fadeOut, s.fadeOut, E.in);
    s.root.style.opacity = Math.min(fi, fo);
    s.root.style.transform = `scale(${1 + 0.05 * out})`;
    s.root.style.filter = out > 0.02 ? `blur(${out * 8}px)` : "";
    s.render(t, s);
    tint = Math.max(tint, s.tint(t) * Math.min(fi, fo));
  }
  tintLayer.style.opacity = tint;
  // white flashes on the big hits
  for (const c of CUES) {
    if (["impact", "action", "caught", "logo"].includes(c.type)) fl = Math.max(fl, 0.28 * (1 - P(t, c.t, 0.22, E.out)) * (t >= c.t ? 1 : 0));
  }
  flash.style.opacity = fl;
  // opening fade from black + final fade
  stage.style.filter = "";
  const fadeIn = P(t, 0, 0.1, E.lin);
  vignette.style.background = `radial-gradient(120% 80% at 50% 45%, transparent 55%, rgb(0 0 0 / 0.72) 100%), rgb(0 0 0 / ${1 - fadeIn})`;
  const frame = Math.round(t * 30);
  gctx.putImageData(grainTiles[(frame >> 1) % grainTiles.length], 0, 0);
  renderCaptions(t);
}

CUES.sort((a, b) => a.t - b.t);
window.CUES = CUES;
window.DURATION = END;
window.renderAt = renderAt;
await document.fonts.ready;
await Promise.all(pending);
renderAt(0);
window.READY = true;

const qs = new URLSearchParams(location.search);
if (qs.has("t")) renderAt(parseFloat(qs.get("t")));
if (qs.has("play")) {
  const audio = new Audio("../build/mix.wav");
  const start = performance.now();
  audio.play().catch(() => {});
  const loop = () => { renderAt((performance.now() - start) / 1000); requestAnimationFrame(loop); };
  loop();
}
