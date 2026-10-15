// Optional HEIC decoding via libheif compiled to WebAssembly.
//
// Decoding is only needed for the target-derived scene statistics and c/d light
// maps. If libheif cannot be loaded the app still works: it falls back to the
// donor statistics and flat maps, which is the configuration that reproduces the
// Python reference byte for byte.

import { discoverHeic, extractItem } from "./heif.js";

const LIBHEIF_URL = "https://cdn.jsdelivr.net/npm/libheif-js@1.18.2/libheif/libheif.js";

let libheifPromise = null;

function injectScript() {
  return new Promise((resolve, reject) => {
    if (globalThis.libheif) return resolve();
    const s = document.createElement("script");
    s.src = LIBHEIF_URL;
    s.onload = () => (globalThis.libheif ? resolve()
      : reject(new Error("libheif loaded but did not register")));
    s.onerror = () => reject(new Error("could not load libheif"));
    document.head.appendChild(s);
  });
}

/**
 * Resolve to the libheif module itself.
 *
 * The bundle is UMD with no browser-global branch, so a plain <script> leaves
 * only its top-level `var libheif` on window — and that is a lazy FACTORY, not
 * the module. Calling it is what yields HeifDecoder; skipping the call is why
 * `libheif.HeifDecoder is not a constructor`.
 */
export async function loadLibheif() {
  if (libheifPromise) return libheifPromise;
  libheifPromise = (async () => {
    await injectScript();
    const raw = globalThis.libheif;
    const mod = typeof raw === "function" ? raw() : raw;
    // The wasm build resolves asynchronously; the asm.js build is ready at once.
    const resolved = mod && typeof mod.then === "function" ? await mod : mod;
    if (resolved && typeof resolved.ready?.then === "function") await resolved.ready;
    if (!resolved || typeof resolved.HeifDecoder !== "function")
      throw new Error("libheif loaded but exposes no HeifDecoder");
    return resolved;
  })().catch((e) => { libheifPromise = null; throw e; });
  return libheifPromise;
}

/** ffmpeg's transpose semantics, expressed as a canvas transform. */
function orientationTransform(ctx, w, h, angle, mirror) {
  // Undo the display rotation to recover the stored orientation, matching
  // raw_orientation_filters() in the Python implementation. irot turns counter-clockwise,
  // so 90 is undone clockwise (canvas +pi/2) and 270 counter-clockwise. v0.6.2: these two
  // were swapped up to v0.6.1.
  const swap = angle === 90 || angle === 270;
  const outW = swap ? h : w;
  const outH = swap ? w : h;
  ctx.translate(outW / 2, outH / 2);
  if (angle === 90) ctx.rotate(Math.PI / 2);
  else if (angle === 180) ctx.rotate(Math.PI);
  else if (angle === 270) ctx.rotate(-Math.PI / 2);
  if (mirror === 0) ctx.scale(-1, 1);
  else if (mirror === 1) ctx.scale(1, -1);
  ctx.translate(-w / 2, -h / 2);
  return [outW, outH];
}

let cache = new WeakMap();

const be = (v, n) => { const b = new Uint8Array(n); for (let i = n - 1; i >= 0; i--) { b[i] = v & 0xff; v = Math.floor(v / 256); } return b; };
const cat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const box = (type, ...parts) => { const body = cat(parts); return cat([be(8 + body.length, 4), ascii(type), body]); };
const full = (v, flags = 0) => cat([new Uint8Array([v]), be(flags, 3)]);

/**
 * The photo's embedded thumbnail as a one-item HEIC, or null without one.
 *
 * The statistics need a 256x192 sample and the light maps 32x32, so decoding the 12-24 MP
 * primary (seconds of single-threaded WebAssembly and two full-size canvases, beyond iOS
 * Safari's canvas limit at 24 MP) is wasted work. The thumbnail is the same picture at
 * ~416x312 in the same stored orientation: against full decodes of 24 photos, percentiles
 * moved by at most 0.03 and light maps by 0.004 on average. Its irot/imir are left out, so
 * libheif returns it in stored orientation directly.
 */
export function thumbnailHeic(bytes) {
  const d = discoverHeic(bytes);
  if (d.thumbnail === null) return null;
  const props = (d.props.associations.get(d.thumbnail) || [])
    .map((a) => ({ a, p: d.props.properties[a.index - 1] }))
    .filter(({ p }) => p.type !== "irot" && p.type !== "imir");
  if (!props.some(({ p }) => p.type === "hvcC")) return null;
  const payload = extractItem(bytes, d.iloc, d.thumbnail);
  const ipco = box("ipco", ...props.map(({ p }) => bytes.subarray(p.box.off, p.box.off + p.box.size)));
  const ipma = box("ipma", full(0), be(1, 4), be(1, 2), new Uint8Array([props.length]),
    new Uint8Array(props.map(({ a }, i) => (a.essential ? 0x80 : 0) | (i + 1))));
  const infe = box("infe", full(2), be(1, 2), be(0, 2), ascii("hvc1"), new Uint8Array([0]));
  const parts = (offset) => [
    box("hdlr", full(0), be(0, 4), ascii("pict"), new Uint8Array(13)),
    box("pitm", full(0), be(1, 2)),
    box("iinf", full(0), be(1, 2), infe),
    box("iprp", ipco, ipma),
    box("iloc", full(1), new Uint8Array([0x44, 0x00]), be(1, 2), be(1, 2), be(0, 2), be(0, 2),
      be(1, 2), be(offset, 4), be(payload.length, 4)),
  ];
  const ftyp = box("ftyp", ascii("heic"), be(0, 4), ascii("mif1"), ascii("heic"));
  const metaLen = box("meta", full(0), ...parts(0)).length;
  const meta = box("meta", full(0), ...parts(ftyp.length + metaLen + 8));
  return cat([ftyp, meta, box("mdat", payload)]);
}

async function decodeFull(bytes) {
  if (cache.has(bytes)) return cache.get(bytes);
  const libheif = await loadLibheif();
  let source = null;
  try { source = thumbnailHeic(bytes); } catch { source = null; }
  const stored = source !== null;
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(source || bytes);
  if (!images || !images.length) throw new Error("libheif decoded no image");
  const image = images[0];
  const w = image.get_width(), h = image.get_height();
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = ctx.createImageData(w, h);
  await new Promise((res, rej) => {
    image.display(imageData, (out) => (out ? res(out) : rej(new Error("libheif display failed"))));
  });
  ctx.putImageData(imageData, 0, 0);
  // `stored`: already in the stored orientation (the thumbnail), so nothing to undo.
  const result = { canvas, w, h, stored };
  cache.set(bytes, result);
  return result;
}

/**
 * Decode and resample to width x height in the photo's stored orientation (undoing the
 * display rotation when the full primary had to be decoded). Returns packed RGB bytes.
 */
export async function decodeToRgb(bytes, { width, height, angle = 0, mirror = null }) {
  const { canvas: decoded, w, h, stored } = await decodeFull(bytes);
  let canvas = decoded;
  if (!stored && (angle || mirror !== null)) {
    canvas = document.createElement("canvas");
    const swap = angle === 90 || angle === 270;
    canvas.width = swap ? h : w;
    canvas.height = swap ? w : h;
    const rctx = canvas.getContext("2d", { willReadFrequently: true });
    rctx.save();
    orientationTransform(rctx, w, h, angle, mirror);
    rctx.drawImage(decoded, 0, 0);
    rctx.restore();
  }

  const small = document.createElement("canvas");
  small.width = width; small.height = height;
  const sctx = small.getContext("2d", { willReadFrequently: true });
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(canvas, 0, 0, width, height);
  const { data } = sctx.getImageData(0, 0, width, height);
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, p = 0; p < data.length; i += 3, p += 4) {
    rgb[i] = data[p]; rgb[i + 1] = data[p + 1]; rgb[i + 2] = data[p + 2];
  }
  return rgb;
}
