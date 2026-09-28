/*
 * خلك طبيعي — promo compositor.
 *
 * A deterministic motion-graphics timeline: window.renderAt(t) poses every
 * element for time t (seconds). Scene timing is anchored to the narration
 * (../build/timings.json), so re-voicing the script re-times the film.
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
const END = TM.duration + 0.4;
const T_ACTION = B("action").start - 0.5;
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
    .replace(/(انكشف!|نجا!)/g, "<strong>$1</strong>")
    .replace(/([+]?\d+(?:–\d+)?)/g, '<span class="num">$1</span>');
}
const caps = TM.chunks.map((c, k) => {
  const e = el("div", "cap", capLayer, fmtCap(c.cap));
  const next = TM.chunks[k + 1];
  const a = c.start - 0.08;
  const b = Math.min(next ? next.start - 0.06 : END, c.end + 0.75);
  return { e, a, b };
});
function renderCaptions(t) {
  for (const c of caps) {
    const v = vis(t, c.a, c.b, 0.16, 0.12);
    const rise = (1 - P(t, c.a, 0.28, E.out)) * 22;
    c.e.style.opacity = v;
    c.e.style.visibility = v > 0.002 ? "visible" : "hidden";
    c.e.style.transform = `translateY(${rise}px) scale(${0.97 + 0.03 * P(t, c.a, 0.28)})`;
  }
}

// ---------------------------------------------------------------- scenes ---
const scenes = [];
function scene(id, from, to, build, opts = {}) {
  const root = el("div", "layer", scenesLayer);
  const s = { id, from, to, root, tint: opts.tint ?? (() => 0), fadeIn: opts.fadeIn ?? 0.3, fadeOut: opts.fadeOut ?? 0.3 };
  s.render = build(root, s);
  scenes.push(s);
  return s;
}
const ROW = ["ريم", "نورة", "سعود", "فهد", "خالد"]; // left → right on screen
const rowX = (i, gap = 200) => 540 + (i - 2) * gap;

/* 1 · HOOK ----------------------------------------------------------------- */
scene("hook", 0, B("title").start + 0.05, (root) => {
  const spot = at(el("div", "bg-glow", root), 540, 1020);
  spot.style.width = "1100px"; spot.style.height = "700px";
  spot.style.background = "radial-gradient(closest-side, rgb(167 139 250 / 0.35), transparent)";
  const cam = el("div", "layer", root);
  cam.style.transformOrigin = "540px 1060px";
  const chars = ROW.map((n, i) => makeChar(cam, n, rowX(i, 205), 1200, 1.12));
  const tRaise = CF("hook.0", 0.55);
  const tLate = C("hook.1").end + 0.05;
  cue(tRaise, "whoosh");
  cue(tRaise + 0.3, "question");
  cue(tLate, "hesitate");
  return (t) => {
    S(spot, { o: 0.4 + 0.6 * P(t, 0.1, 0.8), s: 1 });
    const zoom = P(t, C("hook.1").start - 0.2, 1.3, E.io);
    cam.style.transform = `scale(${1 + 0.75 * zoom})`;
    chars.forEach((c, i) => {
      const imp = c.name === "سعود";
      const blink = 1 - P(t, 0.15 + i * 0.07, 0.35, E.out);
      const up = P(t, tRaise + i * 0.025, 0.28, E.back);
      const idle = Math.sin(t * 2.2 + i) * 3;
      if (!imp) {
        c.pose({ y: idle, armR: mix(150, 12, up), blink, gx: Math.sin(t * 0.9 + i) * 0.3, o: mix(1, 0.3, zoom) });
      } else {
        const dart = t > tRaise ? Math.sin((t - tRaise) * 11) : 0;
        const late = P(t, tLate, 0.55, E.out);
        const wobble = late > 0 && late < 1 ? Math.sin(t * 40) * 6 * (1 - late) : 0;
        c.pose({ y: idle, armR: mix(150, 38, late) + wobble, blink, gx: dart * 0.95, gy: -0.2, q: P(t, tRaise + 0.3, 0.35), qr: Math.sin(t * 6) * 8 });
      }
    });
  };
}, { fadeIn: 0.01, fadeOut: 0.05 });

/* 2 · TITLE ---------------------------------------------------------------- */
scene("title", B("title").start, B("what").start + 0.2, (root) => {
  const mark = at(el("div", "abs", root, eyesMark(330)), 540, 560);
  const brand = at(el("div", "brand abs", root, "خلك طبيعي"), 540, 850);
  brand.style.fontSize = "172px";
  const sub = chip(root, '<span class="emo">🎉</span> لعبة جمعات', 540, 1040);
  const mini = ROW.map((n, i) => makeChar(root, n, rowX(i, 170), 1350, 0.72));
  const t0 = B("title").start;
  const tMask = CF("title.1", 0.62);
  cue(t0, "impact");
  cue(C("title.1").start, "pop");
  cue(tMask, "mask");
  return (t) => {
    const lt = t - t0;
    const m = P(lt, 0, 0.7, E.spring);
    S(mark, { s: 0.3 + 0.7 * m, o: P(lt, 0, 0.15), y: -40 * (1 - m) });
    poseMark(mark, { gx: Math.sin(lt * 2.4) * 0.9, blink: lt > 1.6 && lt < 1.8 ? Math.sin((lt - 1.6) / 0.2 * Math.PI) : 0 });
    const w = P(lt, 0.25, 0.6, E.io);
    brand.style.clipPath = `inset(0 0 0 ${100 - w * 100}%)`;
    S(brand, { s: 0.94 + 0.06 * w, o: w > 0 ? 1 : 0 });
    S(sub, { s: E.back(P(t, C("title.1").start, 0.4, E.lin)), o: P(t, C("title.1").start, 0.15) });
    mini.forEach((c, i) => {
      const inn = P(t, C("title.1").start + 0.1 + i * 0.06, 0.45, E.back);
      const imp = c.name === "سعود";
      const mk = imp ? P(t, tMask, 0.35, E.lin) : 0;
      const look = P(t, tMask + 0.15, 0.3);
      const dir = imp ? 0 : i < 2 ? 1 : -1;
      c.pose({ o: clamp(inn * 2), y: 60 * (1 - inn) + Math.sin(t * 2 + i) * 2, mask: mk, gx: dir * look, squint: imp ? 0.35 * mk : 0, glow: imp ? mk : 0, label: 0 });
    });
  };
});

/* 3 · WHAT ----------------------------------------------------------------- */
scene("what", B("what").start, B("start").start + 0.2, (root) => {
  const tg = tag(root, "📱", "كيف تشتغل؟");
  const ph = makePhone(root, ["01_home"], 500, 540, 850);
  const c1 = chip(root, '<span class="emo">📱</span> جوال لكل لاعب', 300, 470);
  const c2 = chip(root, '<span class="emo">👥</span> <span class="num">3–10</span> لاعبين', 800, 830);
  const c3 = chip(root, '<span class="emo">⚡</span> بدون تحميل ولا تسجيل', 540, 1210, "green");
  const t0 = B("what").start;
  ["what.0", "what.1", "what.2"].forEach((id) => cue(C(id).start + 0.05, "pop"));
  cue(t0, "whoosh");
  return (t) => {
    const lt = t - t0;
    const e = P(lt, 0, 0.8, E.out5);
    S(tg, { o: P(lt, 0.1, 0.3), y: -20 * (1 - P(lt, 0.1, 0.4)) });
    ph.st.view({ "01_home": 1 });
    S(ph.e, { y: 420 * (1 - e) + Math.sin(lt * 1.3) * 6, ry: mix(-35, -9, e) + Math.sin(lt * 0.8) * 3, rx: 4, s: 0.96 });
    [[c1, "what.0", -4], [c2, "what.1", 3], [c3, "what.2", 0]].forEach(([c, id, r]) => {
      const p = P(t, C(id).start, 0.45, E.back);
      S(c, { s: p, o: clamp(p * 3), r, y: Math.sin(t * 1.6 + r) * 5 });
    });
  };
});

/* 4 · START ---------------------------------------------------------------- */
scene("start", B("start").start, B("secret").start + 0.2, (root) => {
  const tg = tag(root, "①", "ابدأ الغرفة");
  const A = makePhone(root, ["01_home", "03_owner_lobby_empty", "05_owner_lobby_full"], 470, 360, 820);
  const Bp = makePhone(root, ["04_join_code", "05_player_lobby"], 440, 760, 900);
  const tv = makeTV(root, ["tv_01_lobby_filling", "tv_02_lobby_full"], 1000, 540, 560);
  const tvChip = chip(root, '<span class="emo">📺</span> التلفزيون اختياري', 540, 930);
  const rip = el("div", "ripple", A.fx);
  const tip = el("div", "fingertip", A.fx);
  const ripB = el("div", "ripple", Bp.fx);
  const tipB = el("div", "fingertip", Bp.fx);
  const t0 = B("start").start;
  const tTapA = t0 + 0.35;
  const tB = C("start.1").start;
  const tTapB = tB + 0.75;
  const tTV = C("start.2").start;
  cue(tTapA, "tap"); cue(tB, "whoosh"); cue(tTapB, "tap"); cue(tTapB + 0.35, "join"); cue(tTV, "whoosh"); cue(tTV + 0.9, "join");
  return (t) => {
    const lt = t - t0;
    S(tg, { o: P(lt, 0.05, 0.3) });
    const eA = P(lt, 0, 0.6, E.out5);
    const down = P(t, tTV, 0.7, E.io);
    A.st.seq(t, [[0, "01_home"], [tTapA + 0.15, "03_owner_lobby_empty"], [tTapB + 0.35, "05_owner_lobby_full"]]);
    S(A.e, { x: -300 * (1 - eA) + mix(0, -40, down), y: Math.sin(lt * 1.2) * 5 + mix(0, 420, down), r: -4, ry: 10, s: mix(1, 0.6, down), o: mix(1, 0.4, down) });
    const tp = vis(t, tTapA - 0.35, tTapA + 0.3, 0.15, 0.2);
    S(tip, { o: tp, s: 1 - 0.15 * P(t, tTapA - 0.08, 0.1) });
    at(tip, A.sw * 0.5, A.sh * 0.555); at(rip, A.sw * 0.5, A.sh * 0.555);
    S(rip, { o: vis(t, tTapA, tTapA + 0.45, 0.02, 0.3), s: 0.3 + 1.2 * P(t, tTapA, 0.45) });
    const eB = P(t, tB, 0.6, E.out5);
    Bp.st.seq(t, [[0, "04_join_code"], [tTapB + 0.2, "05_player_lobby"]]);
    S(Bp.e, { x: 420 * (1 - eB) + mix(0, 40, down), y: Math.sin(lt * 1.1 + 1) * 5 + mix(0, 400, down), r: 4, ry: -12, s: mix(1, 0.6, down), o: Math.min(clamp(eB * 3), mix(1, 0.4, down)) });
    at(tipB, Bp.sw * 0.5, Bp.sh * 0.93); at(ripB, Bp.sw * 0.5, Bp.sh * 0.93);
    S(tipB, { o: vis(t, tTapB - 0.35, tTapB + 0.3, 0.15, 0.2) });
    S(ripB, { o: vis(t, tTapB, tTapB + 0.45, 0.02, 0.3), s: 0.3 + 1.2 * P(t, tTapB, 0.45) });
    const eT = P(t, tTV, 0.7, E.out5);
    tv.st.seq(t, [[0, "tv_01_lobby_filling"], [tTV + 0.9, "tv_02_lobby_full"]], 0.2);
    S(tv.e, { y: -260 * (1 - eT), o: clamp(eT * 2), rx: 8 * (1 - eT), s: 0.9 + 0.1 * eT });
    S(tvChip, { s: E.back(P(t, tTV + 0.5, 0.4, E.lin)), o: P(t, tTV + 0.5, 0.15) });
  };
});

/* 5 · SECRET --------------------------------------------------------------- */
scene("secret", B("secret").start, B("ready").start + 0.2, (root) => {
  const tg = tag(root, "②", "السر بجوالك");
  const N = makePhone(root, ["c1_1_curtain", "c1_2_prompt_normal_نورة"], 480, 540, 860);
  const Sx = makePhone(root, ["c1_2_prompt_IMPOSTOR_سعود"], 480, 540, 860);
  Sx.e.classList.add("impostor");
  const nChip = chip(root, `<span class="avatar" style="position:static;width:48px;height:48px;font-size:24px;background:${SEAT["نورة"]}">ن</span> نورة`, 300, 262);
  const sChip = chip(root, `<span class="avatar" style="position:static;width:48px;height:48px;font-size:24px;background:${SEAT["سعود"]}">س</span> سعود 🎭`, 780, 262, "magenta");
  const q = at(el("div", "bigword", root, "؟"), 540, 0);
  q.style.color = "#ec84fb"; q.style.fontSize = "300px"; q.style.top = "760px";
  const rip = el("div", "ripple", N.fx);
  const tip = el("div", "fingertip", N.fx);
  const t0 = B("secret").start;
  const tTap = CF("secret.0", 0.62);
  const tImp = C("secret.1").start - 0.12;
  const tQ = CF("secret.2", 0.45);
  cue(t0, "whoosh"); cue(tTap, "tap"); cue(tTap + 0.1, "flip"); cue(tImp, "impostor"); cue(tQ, "question");
  return (t, s) => {
    const lt = t - t0;
    S(tg, { o: P(lt, 0.05, 0.3) });
    const eN = P(lt, 0, 0.6, E.out5);
    const flip = P(t, tTap + 0.08, 0.5, E.io);
    const face = flip < 0.5 ? "c1_1_curtain" : "c1_2_prompt_normal_نورة";
    N.st.view({ [face]: 1 });
    const side = P(t, tImp, 0.55, E.out5);
    const focus = P(t, tQ - 0.4, 0.6, E.io);
    S(N.e, {
      x: mix(0, -250, side) - 40 * focus, y: 260 * (1 - eN) + Math.sin(lt * 1.2) * 5 + mix(0, 40, side),
      ry: (flip < 0.5 ? flip * 180 : (flip - 1) * 180) + mix(0, 14, side), s: mix(1, 0.8, side) * mix(1, 0.94, focus), o: mix(1, 0.62, focus),
    });
    at(tip, N.sw * 0.5, N.sh * 0.935); at(rip, N.sw * 0.5, N.sh * 0.935);
    S(tip, { o: vis(t, tTap - 0.35, tTap + 0.25, 0.15, 0.15) });
    S(rip, { o: vis(t, tTap, tTap + 0.45, 0.02, 0.3), s: 0.3 + 1.2 * P(t, tTap, 0.45) });
    Sx.st.view({ c1_2_prompt_IMPOSTOR_سعود: 1 });
    S(Sx.e, { x: mix(600, 250, side) - 60 * focus, y: 40 + Math.sin(lt * 1.3 + 2) * 5 - 20 * focus, ry: mix(-30, -14, side) + 10 * focus, s: 0.8 * mix(1, 1.12, focus), o: clamp(side * 2) });
    S(nChip, { x: mix(240, 0, side), o: clamp(eN * 2) * mix(1, 0.7, focus), s: 1 });
    S(sChip, { s: E.back(P(t, tImp + 0.25, 0.4, E.lin)), o: P(t, tImp + 0.25, 0.1) });
    S(q, { s: E.back(P(t, tQ, 0.45, E.lin)) * (1 + Math.sin(t * 5) * 0.03), o: P(t, tQ, 0.15) * 0.95, x: 250 - 60 * focus, y: -20, r: Math.sin(t * 3) * 6 });
  };
}, { tint: (t) => P(t, C("secret.1").start - 0.12, 0.4, E.lin) });

/* 6 · READY + COUNTDOWN -------------------------------------------------------- */
scene("ready", B("ready").start, T_ACTION + 0.08, (root) => {
  const tg = tag(root, "③", "جاهزين؟");
  const N = makePhone(root, ["c1_2_prompt_normal_نورة", "c1_3_ready_waiting"], 480, 540, 860);
  const rip = el("div", "ripple", N.fx);
  const tip = el("div", "fingertip", N.fx);
  const dial = makeCrop(root, ["tv_c1_3_count_3", "tv_c1_3_count_2", "tv_c1_3_count_1"], 1920, [470, 110, 980, 700], 1040, 540, 780, 0);
  dial.e.style.maskImage = "radial-gradient(closest-side, #000 70%, transparent 100%)";
  dial.e.style.webkitMaskImage = dial.e.style.maskImage;
  const t0 = B("ready").start;
  const tTap = CF("ready.0", 0.3);
  const tC = [T_ACTION - 3, T_ACTION - 2, T_ACTION - 1];
  cue(tTap, "tap"); cue(tTap + 0.15, "ready");
  tC.forEach((tc, k) => cue(tc, "tick", { step: 3 - k }));
  return (t) => {
    const lt = t - t0;
    S(tg, { o: P(lt, 0.05, 0.3) * (1 - P(t, tC[0] - 0.3, 0.3)) });
    N.st.seq(t, [[0, "c1_2_prompt_normal_نورة"], [tTap + 0.15, "c1_3_ready_waiting"]]);
    const away = P(t, tC[0] - 0.45, 0.45, E.in);
    S(N.e, { y: Math.sin(lt * 1.2) * 5 + 300 * away, s: 1 - 0.2 * away, o: 1 - away, ry: -6 });
    at(tip, N.sw * 0.5, N.sh * 0.935); at(rip, N.sw * 0.5, N.sh * 0.935);
    S(tip, { o: vis(t, tTap - 0.35, tTap + 0.25, 0.15, 0.15) });
    S(rip, { o: vis(t, tTap, tTap + 0.45, 0.02, 0.3), s: 0.3 + 1.2 * P(t, tTap, 0.45) });
    const k = t < tC[1] ? 0 : t < tC[2] ? 1 : 2;
    dial.st.view({ [["tv_c1_3_count_3", "tv_c1_3_count_2", "tv_c1_3_count_1"][k]]: 1 });
    const pulse = 1 + 0.07 * (1 - P(t, tC[k], 0.35, E.out));
    S(dial.e, { o: P(t, tC[0] - 0.25, 0.25), s: pulse * (1 + 0.05 * P(t, tC[0], 3, E.lin)) });
  };
});

/* 7 · ACTION -------------------------------------------------------------------- */
scene("action", T_ACTION, B("reveal").start + 0.2, (root) => {
  const burst = makeCrop(root, ["tv_c1_4_action"], 1920, [300, 60, 1320, 900], 1240, 540, 700, 0);
  burst.e.style.maskImage = "radial-gradient(closest-side, #000 60%, transparent 100%)";
  burst.e.style.webkitMaskImage = burst.e.style.maskImage;
  const hold = makeCrop(root, ["tv_c1_5_hold"], 1920, [560, 180, 800, 520], 700, 540, 470, 40);
  const chars = ROW.map((n, i) => makeChar(root, n, rowX(i, 205), 1240, 1.12));
  cue(T_ACTION, "action");
  const tRaise = T_ACTION + 0.55;
  const tDecide = CF("action.1", 0.3);
  const tHold = C("action.1").start;
  const tSmug = CF("action.1", 0.78);
  cue(tRaise, "whoosh");
  cue(tHold, "hold");
  return (t) => {
    const lt = t - T_ACTION;
    const b = vis(t, T_ACTION - 0.02, tHold + 0.25, 0.04, 0.3);
    const up = P(lt, 0.55, 0.7, E.io);
    S(burst.e, { o: b, y: -330 * up, s: (1.12 - 0.12 * P(lt, 0, 0.5, E.out) + (lt < 0.25 ? Math.sin(lt * 90) * 0.012 : 0)) * mix(1, 0.62, up) });
    burst.st.view({ tv_c1_4_action: 1 });
    hold.st.view({ tv_c1_5_hold: 1 });
    S(hold.e, { o: P(t, tHold, 0.3), y: -30 * (1 - P(t, tHold, 0.5)), s: 1 });
    chars.forEach((c, i) => {
      const imp = c.name === "سعود";
      const inn = P(t, T_ACTION + 0.45, 0.35, E.out);
      const up = imp ? P(t, tDecide, 0.4, E.back) : P(t, tRaise + i * 0.02, 0.22, E.back);
      const neighbour = i < 2 ? 1 : i > 2 ? -1 : 0;
      const lookEach = P(t, tHold, 0.4) * Math.sin(t * 1.7 + i * 1.3);
      const dart = imp && t > tRaise && t < tDecide + 0.3 ? Math.sin((t - tRaise) * 12) : 0;
      c.pose({
        o: inn, y: 40 * (1 - inn) + Math.sin(t * 2 + i) * 2,
        armR: mix(150, imp ? 22 : 10 + (i % 2) * 8, up),
        gx: imp ? (t < tDecide + 0.3 ? dart : lookEach * 0.8) : neighbour * 0.5 + lookEach * 0.6,
        squint: imp ? 0.45 * P(t, tSmug, 0.3) : 0,
        q: imp ? vis(t, tRaise + 0.1, tDecide + 0.2, 0.2, 0.2) : 0, qr: Math.sin(t * 7) * 8,
      });
    });
  };
}, { fadeIn: 0.02 });

/* 8 · REVEAL ------------------------------------------------------------------------ */
scene("reveal", B("reveal").start, B("vote").start + 0.2, (root) => {
  const tg = tag(root, "④", "المطلوب ينكشف");
  const rev = makeCrop(root, ["tv_c1_6_reveal"], 1920, [330, 250, 1260, 560], 1020, 540, 640, 40);
  const disc = makeCrop(root, ["tv_c1_7_discussion"], 1920, [300, 120, 1320, 470], 1000, 540, 520, 40);
  const shine = el("div", "abs", rev.e);
  shine.style.cssText += "left:0;top:0;width:100%;height:100%;background:linear-gradient(100deg,transparent 30%,rgb(255 255 255 / 0.22) 50%,transparent 70%)";
  const chars = ROW.map((n, i) => makeChar(root, n, rowX(i), 1320, 0.95));
  const t0 = B("reveal").start;
  const tDisc = C("reveal.1").start;
  cue(t0 + 0.05, "reveal");
  cue(C("reveal.2").start, "suspense");
  return (t) => {
    const lt = t - t0;
    S(tg, { o: P(lt, 0.05, 0.3) });
    rev.st.view({ tv_c1_6_reveal: 1 });
    disc.st.view({ tv_c1_7_discussion: 1 });
    const d = P(t, tDisc, 0.6, E.io);
    S(rev.e, { o: P(lt, 0, 0.3) * (1 - d), s: (0.9 + 0.1 * P(lt, 0, 0.6, E.back)) * mix(1, 0.85, d), y: -100 * d });
    shine.style.transform = `translateX(${mix(-120, 120, P(lt, 0.2, 0.9, E.io))}%)`;
    S(disc.e, { o: d, s: mix(1.1, 1, d) });
    const lower = P(t, t0 + 0.9, 0.5, E.io);
    chars.forEach((c, i) => {
      const imp = c.name === "سعود";
      const sus = P(t, C("reveal.2").start, 0.4);
      const gaze = imp ? Math.sin(t * 3) * 0.6 : i < 2 ? 1 : -1;
      c.pose({
        o: P(lt, 0.1, 0.4), armR: mix(imp ? 22 : 12, 150, lower), y: Math.sin(t * 2 + i) * 2,
        gx: mix(Math.sin(t + i) * 0.3, gaze, sus), squint: imp ? 0 : 0.35 * sus,
        q: imp ? 0 : P(t, C("reveal.2").start + 0.1 + i * 0.07, 0.3) * 0.9, qr: Math.sin(t * 5 + i) * 10,
      });
    });
  };
});

/* 9 · VOTE ---------------------------------------------------------------------------- */
scene("vote", B("vote").start, B("caught").start + 0.2, (root) => {
  const tg = tag(root, "⑤", "التصويت");
  const V = makePhone(root, ["c1_9_vote_picked", "c1_9b_voted_waiting"], 480, 540, 870);
  const lock = chip(root, '<span class="emo">🔒</span> كل واحد يصوّت بالسر', 540, 268);
  const meter = makeCrop(root, ["tv_c1_8_voting_0", "tv_c1_8_voting_1", "tv_c1_8_voting_2", "tv_c1_8_voting_3", "tv_c1_8_voting_4"], 1920, [560, 170, 800, 660], 760, 540, 720, 40);
  const res = makeCrop(root, ["tv_c1_9_result"], 1920, [560, 240, 800, 600], 800, 540, 720, 40);
  const next = makePhone(root, ["c2_2_prompt_normal_نورة"], 470, 540, 880);
  const same = chip(root, '<span class="emo">🎭</span> نفس المتخفي · مطلوب جديد', 540, 262, "magenta");
  const rip = el("div", "ripple", V.fx);
  const tip = el("div", "fingertip", V.fx);
  const t0 = B("vote").start;
  const tTap1 = CF("vote.0", 0.55);
  const tTap2 = CF("vote.0", 0.85);
  const tMeter = C("vote.1").start - 0.1;
  const tRes = CF("vote.1", 0.62);
  const tNext = C("vote.2").start - 0.05;
  cue(tTap1, "tap"); cue(tTap2, "tap"); cue(tTap2 + 0.1, "vote");
  [0, 1, 2, 3].forEach((k) => cue(tMeter + 0.12 + k * 0.2, "vote", { n: k + 2 }));
  cue(tRes, "escaped"); cue(tNext, "whoosh");
  return (t) => {
    const lt = t - t0;
    S(tg, { o: P(lt, 0.05, 0.3) });
    V.st.seq(t, [[0, "c1_9_vote_picked"], [tTap2 + 0.15, "c1_9b_voted_waiting"]]);
    const out1 = P(t, tMeter - 0.2, 0.4, E.in);
    S(V.e, { y: 280 * (1 - P(lt, 0, 0.6, E.out5)) + Math.sin(lt * 1.2) * 5 + 200 * out1, ry: 8, s: 1 - 0.15 * out1, o: 1 - out1 });
    S(lock, { s: E.back(P(t, t0 + 0.3, 0.4, E.lin)), o: P(t, t0 + 0.3, 0.1) * (1 - out1) });
    const pos1 = [0.31, 0.37], pos2 = [0.62, 0.905];
    const pos = t < tTap1 + 0.2 ? pos1 : pos2;
    at(tip, V.sw * pos[0], V.sh * pos[1]);
    const tapT = t < tTap1 + 0.2 ? tTap1 : tTap2;
    S(tip, { o: vis(t, tTap1 - 0.3, tTap2 + 0.25, 0.15, 0.15) });
    at(rip, V.sw * pos[0], V.sh * pos[1]);
    S(rip, { o: vis(t, tapT, tapT + 0.4, 0.02, 0.3), s: 0.3 + 1.1 * P(t, tapT, 0.4) });
    const mk = Math.min(4, Math.max(0, Math.floor((t - tMeter - 0.12) / 0.2) + 1));
    meter.st.view({ [`tv_c1_8_voting_${mk}`]: 1 });
    S(meter.e, { o: vis(t, tMeter, tRes + 0.1, 0.2, 0.15), s: 0.95 + 0.05 * P(t, tMeter, 0.4) });
    res.st.view({ tv_c1_9_result: 1 });
    S(res.e, { o: vis(t, tRes, tNext + 0.2, 0.12, 0.3), s: 1.08 - 0.08 * P(t, tRes, 0.5, E.out) });
    next.st.view({ c2_2_prompt_normal_نورة: 1 });
    const eN = P(t, tNext, 0.6, E.out5);
    S(next.e, { y: 380 * (1 - eN) + Math.sin(t * 1.2) * 5, o: clamp(eN * 2), ry: -8 });
    S(same, { s: E.back(P(t, tNext + 0.35, 0.4, E.lin)), o: P(t, tNext + 0.35, 0.1) });
  };
}, { tint: (t) => vis(t, CF("vote.1", 0.62), C("vote.2").start + 0.4, 0.2, 0.4) * 0.8 });

/* 10 · CAUGHT --------------------------------------------------------------------------- */
scene("caught", B("caught").start, B("modes").start + 0.2, (root) => {
  const tg = tag(root, "⑥", "الأغلبية تمسكه");
  const ring = [["فهد", -2.05], ["نورة", -1.0], ["ريم", 1.0], ["خالد", 2.05]];
  const cx = 540, cy = 760, R = 360;
  const center = makeAvatar(root, "سعود", 190, cx, cy);
  const around = ring.map(([n, a]) => ({ n, a, e: makeAvatar(root, n, 130, cx + Math.sin(a) * R, cy - Math.cos(a) * R * 0.95) }));
  const votes = [["نورة", "سعود"], ["فهد", "سعود"], ["ريم", "سعود"], ["خالد", "فهد"]];
  const lines = votes.map(() => el("div", "arrow-line", root));
  const count = at(el("div", "bigword", root, ""), 0, 0);
  count.style.fontSize = "130px"; count.style.top = "420px"; count.style.left = "0";
  const maj = chip(root, '<span class="num">3</span> من <span class="num">5</span> · أغلبية ✓', 540, 1230, "green");
  const res = makeCrop(root, ["c2_10_result_normal_نورة"], 1170, [60, 190, 1050, 1000], 860, 540, 760, 48);
  res.e.style.boxShadow = "0 0 0 3px rgb(236 132 251 / 0.6), 0 0 140px -20px rgb(217 70 239 / 0.9)";
  const parts = [];
  const R2 = rng(42);
  for (let k = 0; k < 70; k += 1) {
    const p = at(el("div", "particle", root), 540, 760);
    const c = ["#c4b5fd", "#ec84fb", "#ffffff", "#8b5cf6", "#fbc75a"][k % 5];
    p.style.background = c;
    p.style.width = `${8 + R2() * 14}px`; p.style.height = `${6 + R2() * 10}px`;
    parts.push({ p, a: R2() * Math.PI * 2, v: 500 + R2() * 900, spin: (R2() - 0.5) * 1400, g: 900 + R2() * 500 });
  }
  const t0 = B("caught").start;
  const tV = [0.25, 0.55, 0.85, 1.1].map((f) => t0 + f * (C("caught.0").end - t0) * 0.9);
  const tSlam = C("caught.1").start - 0.05;
  tV.forEach((tv, k) => cue(tv, "vote", { n: k + 1 }));
  cue(tV[2] + 0.2, "majority");
  cue(tSlam, "caught");
  return (t) => {
    const lt = t - t0;
    S(tg, { o: P(lt, 0.05, 0.3) });
    const gone = P(t, tSlam - 0.1, 0.25, E.in);
    const inn = P(lt, 0, 0.5, E.back);
    S(center, { s: inn * (1 + 0.08 * P(t, tV[2], 0.3) * (1 - P(t, tV[2] + 0.3, 0.3))), o: clamp(inn * 2) * (1 - gone) });
    around.forEach(({ e }, k) => S(e, { s: P(lt, 0.1 + k * 0.05, 0.4, E.back), o: (1 - gone) }));
    votes.forEach(([from, to], k) => {
      const A = around.find((x) => x.n === from);
      const toP = to === "سعود" ? { x: cx, y: cy } : { x: cx + Math.sin(around.find((x) => x.n === to).a) * R, y: cy - Math.cos(around.find((x) => x.n === to).a) * R * 0.95 };
      const fx = cx + Math.sin(A.a) * R, fy = cy - Math.cos(A.a) * R * 0.95;
      const dx = toP.x - fx, dy = toP.y - fy, len = Math.hypot(dx, dy) - (to === "سعود" ? 110 : 80) - 70;
      const p = P(t, tV[k], 0.3, E.out);
      const l = lines[k];
      const ang = Math.atan2(dy, dx);
      l.style.left = `${fx + Math.cos(ang) * 70}px`; l.style.top = `${fy + Math.sin(ang) * 70}px`;
      l.style.width = `${Math.max(0, len)}px`;
      l.style.transform = `rotate(${ang}rad) scaleX(${p})`;
      l.style.opacity = (to === "سعود" ? 1 : 0.35) * (1 - gone) * (p > 0 ? 1 : 0);
    });
    const n = t < tV[0] ? 0 : t < tV[1] ? 1 : t < tV[2] ? 2 : 3;
    count.innerHTML = n ? `<span class="num">${n}</span>` : "";
    S(count, { o: (n ? 1 : 0) * (1 - gone), s: 1 + 0.15 * (1 - P(t, tV[Math.max(0, n - 1)], 0.25)), anchor: "tl" });
    count.style.color = n === 3 ? "#6ee7a8" : "#fff";
    S(maj, { s: E.back(P(t, tV[2] + 0.2, 0.4, E.lin)), o: P(t, tV[2] + 0.2, 0.1) * (1 - gone) });
    res.st.view({ c2_10_result_normal_نورة: 1 });
    const sl = P(t, tSlam, 0.35, E.out5);
    const shake = t > tSlam && t < tSlam + 0.4 ? Math.sin((t - tSlam) * 80) * 16 * (1 - (t - tSlam) / 0.4) : 0;
    S(res.e, { o: clamp(sl * 3), s: mix(1.6, 1, sl), x: shake, y: shake * 0.5 });
    parts.forEach((q) => {
      const dt = t - tSlam;
      if (dt < 0 || dt > 2.2) { q.p.style.opacity = 0; return; }
      const x = Math.cos(q.a) * q.v * dt;
      const y = Math.sin(q.a) * q.v * dt * 0.8 + 0.5 * q.g * dt * dt;
      S(q.p, { x, y, r: q.spin * dt, o: 1 - clamp((dt - 1.2) / 1) });
    });
  };
}, { tint: (t) => vis(t, C("caught.1").start - 0.05, B("modes").start, 0.1, 0.4) });

/* 11 · MODES ------------------------------------------------------------------------------- */
scene("modes", B("modes").start, B("points").start + 0.2, (root) => {
  const tg = tag(root, "⑦", "ثلاث حركات");
  const modes = [
    ["🙋", "ارفع يدك", "إذا المطلوب ينطبق عليك، ارفع يدك."],
    ["👉", "أشر على شخص", "اختر الشخص اللي تشوف إن المطلوب ينطبق عليه."],
    ["🔢", "ارفع أصابعك", "جاوب من 0 إلى 5 بأصابعك."],
  ];
  const cards = modes.map(([i, l, d], k) => at(el("div", "mode-card", root, `<span class="ico">${i}</span><div><div class="lbl">${l}</div><div class="sub">${d}</div></div>`), 90, 500 + k * 185));
  cards.forEach((c) => { c.style.left = "90px"; });
  const prompts = [
    "ارفع يدك إذا تحب الكزبرة.",
    "أشر على اللي ممكن ينام بنص الفيلم.",
    "من آخر 5 أيام، كم يوم شربت قهوة؟",
  ].map((p, k) => {
    const c = at(el("div", "prompt-card", root, `<div class="k">${modes[k][0]} ${modes[k][1]} · من بنك اللعبة</div><div class="p">${p}</div>`), 80, 360);
    return c;
  });
  const chars = ROW.map((n, i) => makeChar(root, n, rowX(i), 1330, 1.0));
  const t0 = B("modes").start;
  const tm = ["modes.1", "modes.2", "modes.3"].map((id) => C(id).start - 0.1);
  cue(t0 + 0.1, "pop"); cue(t0 + 0.3, "pop"); cue(t0 + 0.5, "pop");
  tm.forEach((x) => cue(x, "swish"));
  
  const hands = { "ريم": 1, "نورة": 0, "سعود": 1, "فهد": 1, "خالد": 0 };
  const fingers = { "ريم": 5, "نورة": 3, "سعود": 0, "فهد": 4, "خالد": 2 };
  const target = "خالد";
  return (t) => {
    const lt = t - t0;
    S(tg, { o: P(lt, 0.05, 0.3) });
    const k = t < tm[0] ? -1 : t < tm[1] ? 0 : t < tm[2] ? 1 : 2;
    cards.forEach((c, j) => {
      const inn = P(t, t0 + 0.1 + j * 0.2, 0.45, E.back);
      const out = P(t, tm[0] - 0.15, 0.35, E.in);
      S(c, { anchor: "tl", x: 0, y: 40 * (1 - inn) - 60 * out, o: clamp(inn * 2) * (1 - out), s: 1 });
    });
    prompts.forEach((c, j) => {
      const a = tm[j], b = tm[j + 1] ?? B("points").start + 0.2;
      const v = vis(t, a, b, 0.3, 0.25);
      S(c, { anchor: "tl", o: v, x: 70 * (1 - P(t, a, 0.4)) - 70 * P(t, b - 0.25, 0.25), s: 1 });
    });
    chars.forEach((c, i) => {
      const n = c.name;
      const act = k < 0 ? 0 : P(t, tm[k] + 0.45 + i * 0.03, 0.3, E.back);
      const inn = P(t, tm[0], 0.4);
      const base = { o: inn, y: 30 * (1 - inn) + Math.sin(t * 2 + i) * 2, gx: Math.sin(t * 0.8 + i) * 0.3 };
      if (k === 0) c.pose({ ...base, armR: mix(150, hands[n] ? 12 : 150, act) });
      else if (k === 1) {
        const ti = ROW.indexOf(target);
        const who = n === target ? ROW.indexOf("نورة") : ti;
        const dir = Math.sign(who - i) || 1;
        const ang = dir * mix(150, 62, act);
        const pose = dir > 0 ? { armR: ang, pointR: true } : { armL: ang, pointL: true };
        c.pose({ ...base, ...pose, gx: dir, zz: n === target ? P(t, tm[1] + 0.8, 0.4) : 0, squint: n === target ? 0.55 : 0 });
      } else if (k === 2) c.pose({ ...base, armR: mix(150, 14, act), fingersR: fingers[n], badge: P(t, tm[2] + 0.9 + i * 0.08, 0.35, E.lin), badgeText: String(fingers[n]) });
      else c.pose(base);
    });
  };
});

/* 12 · POINTS ------------------------------------------------------------------------------ */
scene("points", B("points").start, B("win").start + 0.2, (root) => {
  const tg = tag(root, "⑧", "النقاط");
  const N = makePhone(root, ["c2_10_result_normal_نورة"], 480, 540, 870);
  const hlN = el("div", "abs", N.fx);
  hlN.style.cssText += `left:${N.sw * 0.04}px;top:${N.sh * 0.508}px;width:${N.sw * 0.92}px;height:${N.sh * 0.12}px;border-radius:26px;border:5px solid #6ee7a8;box-shadow:0 0 50px #6ee7a8, inset 0 0 30px rgb(110 231 168 / 0.4)`;
  const boxes = ["+1", "+2", "+3"].map((s, k) => {
    const b = at(el("div", "points-big", root, s), 0, 0);
    b.style.left = `${180 + k * 360 - 120}px`; b.style.top = "560px";
    return b;
  });
  const lbls = ["صح مرة", "مرتين ورا بعض", "3 مرات ورا بعض"].map((s, k) => {
    const d = at(el("div", "headline", root, s), 0, 850);
    d.style.width = "340px"; d.style.left = `${10 + k * 360}px`; d.style.fontSize = "36px"; d.style.color = "#bdb2d9";
    return d;
  });
  const I = makePhone(root, ["c2_10_result_IMPOSTOR_سعود"], 480, 540, 870);
  const hlI = el("div", "abs", I.fx);
  hlI.style.cssText += `left:${I.sw * 0.04}px;top:${I.sh * 0.508}px;width:${I.sw * 0.92}px;height:${I.sh * 0.12}px;border-radius:26px;border:5px solid #ec84fb;box-shadow:0 0 50px #ec84fb, inset 0 0 30px rgb(236 132 251 / 0.4)`;
  I.e.classList.add("impostor");
  const iChip = chip(root, '<span class="emo">🎭</span> المتخفي: <span class="num">+1</span> عن كل تحدّي ينجو فيه', 540, 262, "magenta");
  const nChip = chip(root, '<span class="emo">✅</span> نورة صوّتت صح مرتين ورا بعض', 540, 262, "green");
  const t0 = B("points").start;
  const tB = [CF("points.1", 0.46), CF("points.1", 0.66), CF("points.1", 0.86)];
  const tI = C("points.2").start - 0.1;
  cue(t0 + 0.05, "whoosh");
  tB.forEach((x, k) => cue(x, "point", { n: k + 1 }));
  cue(tI, "whoosh"); cue(tI + 0.5, "point", { n: 1 });
  return (t) => {
    const lt = t - t0;
    S(tg, { o: P(lt, 0.05, 0.3) });
    N.st.view({ c2_10_result_normal_نورة: 1 });
    const inn = P(lt, 0, 0.6, E.out5);
    const zoom = P(lt, 0.5, 1.4, E.io);
    const out = P(t, C("points.1").start - 0.3, 0.35, E.in);
    N.e.style.transformOrigin = "50% 57%";
    S(N.e, { y: 300 * (1 - inn) + 200 * out, s: mix(1, 1.1, zoom) * (1 - 0.3 * out), o: 1 - out, ry: mix(-10, 0, zoom) });
    const pulseN = P(lt, 0.8, 0.4);
    hlN.style.opacity = pulseN * (0.75 + 0.25 * Math.sin(t * 6));
    S(nChip, { s: E.back(P(t, t0 + 0.9, 0.4, E.lin)), o: P(t, t0 + 0.9, 0.1) * (1 - out) });
    boxes.forEach((b, k) => {
      const p = P(t, tB[k], 0.4, E.back);
      const ghost = vis(t, C("points.1").start - 0.1 + k * 0.08, tI + 0.15, 0.3, 0.3);
      const lit = P(t, tB[k], 0.12, E.lin);
      S(b, { anchor: "tl", s: 0.85 + 0.15 * p + 0.12 * Math.sin(Math.PI * clamp((t - tB[k]) / 0.35)), o: ghost * (0.22 + 0.78 * lit), y: -10 * Math.sin(t * 3 + k) });
      b.style.filter = lit < 1 ? `grayscale(${1 - lit})` : "";
      S(lbls[k], { anchor: "tl", o: ghost * (0.35 + 0.65 * lit) });
    });
    I.st.view({ c2_10_result_IMPOSTOR_سعود: 1 });
    const eI = P(t, tI, 0.6, E.out5);
    const zI = P(t, tI + 0.4, 1.2, E.io);
    I.e.style.transformOrigin = "50% 57%";
    S(I.e, { y: 380 * (1 - eI), o: clamp(eI * 2), s: mix(1, 1.1, zI), ry: mix(12, 0, zI) });
    hlI.style.opacity = P(t, tI + 0.6, 0.4) * (0.75 + 0.25 * Math.sin(t * 6));
    S(iChip, { s: E.back(P(t, tI + 0.6, 0.4, E.lin)), o: P(t, tI + 0.6, 0.1) });
  };
}, { tint: (t) => P(t, C("points.2").start - 0.1, 0.5, E.lin) * 0.7 });

/* 13 · WIN --------------------------------------------------------------------------------- */
scene("win", B("win").start, B("cta").start + 0.25, (root) => {
  const tg = tag(root, "⑨", "مين يفوز؟");
  const G = makePhone(root, ["99_gameover_فهد"], 520, 540, 800);
  const noura = makeChar(root, "نورة", 760, 1300, 1.45);
  const caughtCard = makeCrop(root, ["c2_10_result_normal_نورة"], 1170, [60, 190, 1050, 1000], 440, 300, 640, 32);
  const escCard = makeCrop(root, ["c3_10_result_normal_فهد"], 1170, [60, 190, 1050, 1060], 520, 330, 700, 36);
  escCard.e.style.boxShadow = "0 0 0 3px rgb(236 132 251 / 0.6), 0 0 120px -20px rgb(217 70 239 / 0.9)";
  const ok = chip(root, '<span class="emo">✅</span> مسكت سعود', 300, 1020, "green");
  const t0 = B("win").start;
  const tFlash = C("win.1").start - 0.05;
  const tImp = C("win.2").start;
  const tSmug = CF("win.2", 0.75);
  cue(t0 + 0.05, "whoosh"); cue(t0 + 0.5, "crown");
  cue(tFlash, "swish"); cue(tImp + 0.15, "mask"); cue(tSmug, "sly"); cue(CF("win.2", 0.8), "crown");
  return (t) => {
    const lt = t - t0;
    S(tg, { o: P(lt, 0.05, 0.3) });
    G.st.view({ "99_gameover_فهد": 1 });
    const out = P(t, tFlash - 0.2, 0.4, E.in);
    const inn = P(lt, 0, 0.6, E.out5);
    G.e.style.transformOrigin = "50% 22%";
    S(G.e, { y: 320 * (1 - inn) - 60 * out, s: mix(1, 1.25, P(lt, 0.4, 1.6, E.io)) * (1 - 0.4 * out), o: 1 - out });
    caughtCard.st.view({ c2_10_result_normal_نورة: 1 });
    S(caughtCard.e, { o: vis(t, tFlash, tImp + 0.15, 0.2, 0.25), r: -4, s: 0.9 + 0.1 * P(t, tFlash, 0.4, E.back) });
    S(ok, { o: vis(t, tFlash + 0.3, tImp + 0.15, 0.15, 0.25), s: E.back(P(t, tFlash + 0.3, 0.4, E.lin)), r: -3 });
    escCard.st.view({ c3_10_result_normal_فهد: 1 });
    S(escCard.e, { o: P(t, tImp + 0.4, 0.3), r: -3, s: 0.9 + 0.1 * P(t, tImp + 0.4, 0.4, E.back), y: 20 * Math.sin(t * 1.5) });
    const nIn = P(t, tFlash, 0.5, E.back);
    const mk = P(t, tImp + 0.15, 0.35, E.lin);
    noura.pose({
      o: clamp(nIn * 2), y: 60 * (1 - nIn) + Math.sin(t * 2.2) * 3, mask: mk, squint: 0.5 * P(t, tSmug, 0.3),
      gx: t > tSmug ? -0.8 : Math.sin(t * 1.5) * 0.4, glow: mk * 0.8, crown: P(t, CF("win.2", 0.8), 0.5, E.back), armR: mix(150, 30, P(t, CF("win.2", 0.8), 0.35, E.back)),
    });
  };
}, { tint: (t) => P(t, C("win.2").start, 0.5, E.lin) * 0.8 });

/* 14 · CTA --------------------------------------------------------------------------------- */
scene("cta", B("cta").start, END + 1, (root) => {
  const chars = ROW.map((n, i) => makeChar(root, n, rowX(i, 190), 1060, 0.95));
  const chips = [
    ['<span class="emo">👥</span> <span class="num">3–10</span> لاعبين', 300, 1150],
    ['<span class="emo">📱</span> جوال لكل لاعب', 780, 1150],
    ['<span class="emo">⚡</span> بدون تحميل ولا تسجيل', 540, 1265],
  ].map(([h, x, y]) => chip(root, h, x, y));
  const mark = at(el("div", "abs", root, eyesMark(300)), 540, 560);
  const brand = at(el("div", "brand abs", root, "خلك طبيعي"), 540, 860);
  brand.style.fontSize = "172px";
  const tagline = at(el("div", "headline", root, "واحد منكم متخفي… اكتشفوه!"), 0, 1030);
  tagline.style.fontSize = "52px"; tagline.style.color = "#ddd3ff"; tagline.style.left = "0"; tagline.style.transform = "none";
  const t0 = B("cta").start;
  const tLogo = C("cta.1").start - 0.2;
  cue(t0 + 0.05, "party"); cue(tLogo + 0.1, "logo");
  return (t) => {
    const lt = t - t0;
    const out = P(t, tLogo - 0.15, 0.4, E.in);
    chars.forEach((c, i) => {
      const inn = P(lt, i * 0.07, 0.5, E.back);
      const hop = Math.max(0, Math.sin((t - t0) * 7 + i * 1.1)) * 26 * (1 - out);
      c.pose({ o: clamp(inn * 2) * (1 - out), y: 80 * (1 - inn) + 200 * out, hop, armR: 20 + Math.sin(t * 7 + i) * 18, armL: -20 - Math.sin(t * 7 + i + 1) * 18, gx: Math.sin(t * 1.3 + i) * 0.6 });
    });
    chips.forEach((c, k) => S(c, { s: E.back(P(lt, 0.4 + k * 0.15, 0.4, E.lin)), o: P(lt, 0.4 + k * 0.15, 0.1) * (1 - out), y: 60 * out }));
    const m = P(t, tLogo, 0.7, E.spring);
    S(mark, { s: 0.3 + 0.7 * m, o: P(t, tLogo, 0.15), y: -40 * (1 - m) });
    const bl = t - (tLogo + 1.5);
    poseMark(mark, { gx: Math.sin((t - tLogo) * 2) * 0.8, blink: bl > 0 && bl < 0.22 ? Math.sin((bl / 0.22) * Math.PI) : 0 });
    const w = P(t, tLogo + 0.2, 0.6, E.io);
    brand.style.clipPath = `inset(0 0 0 ${100 - w * 100}%)`;
    S(brand, { s: 0.94 + 0.06 * w, o: w > 0 ? 1 : 0 });
    S(tagline, { anchor: "tl", o: P(t, tLogo + 0.8, 0.4), y: 20 * (1 - P(t, tLogo + 0.8, 0.5)) });
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
    if (["impact", "action", "caught", "logo"].includes(c.type)) fl = Math.max(fl, 0.5 * (1 - P(t, c.t, 0.35, E.out)) * (t >= c.t ? 1 : 0));
  }
  flash.style.opacity = fl;
  // opening fade from black + final fade
  stage.style.filter = "";
  const fadeIn = P(t, 0, 0.5, E.lin);
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
