export const PRESETS = {
  standard: { name: "Standard", tone: 0, color: 0, warmth: 0 },
  vibrant: { name: "Vibrant", tone: 10, color: 60, warmth: 0 },
  rich: { name: "Rich Contrast", tone: 55, color: 20, warmth: -5 },
  warm: { name: "Warm", tone: 10, color: 20, warmth: 50 },
  cool: { name: "Cool", tone: 0, color: 10, warmth: -50 },
  dramatic: { name: "Dramatic", tone: 80, color: -20, warmth: -10 },
  soft: { name: "Soft", tone: -45, color: -10, warmth: 10 },
};

export function gradePixels(data, { tone = 0, color = 0, warmth = 0 }) {
  const c = (tone / 100) * 0.6;
  const amt = color / 100;
  const wk = (warmth / 100) * 0.14;
  if (!c && !amt && !wk) return data;
  const inv = 1 / 255;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] * inv, g = data[i + 1] * inv, b = data[i + 2] * inv;

    if (wk) {
      const l0 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r *= 1 + wk; g *= 1 + wk * 0.15; b *= 1 - wk;
      const l1 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (l1 > 1e-4) { const k = l0 / l1; r *= k; g *= k; b *= k; }
    }

    if (c) {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const lc = l < 0 ? 0 : l > 1 ? 1 : l;
      const l2 = l + c * (lc * lc * (3 - 2 * lc) - l);
      if (l > 0.002) { let k = l2 / l; if (k > 4) k = 4; r *= k; g *= k; b *= k; }
      else { const d = l2 - l; r += d; g += d; b += d; }
    }

    if (amt) {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      let f;
      if (amt > 0) {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const s = mx > 1e-4 ? (mx - mn) / mx : 0;
        const skin = r > g && g > b && s > 0.15 && s < 0.65 ? 0.5 : 1;
        f = 1 + amt * 0.9 * (1 - s * 0.8) * skin;
      } else {
        f = 1 + amt * 0.9;
      }
      r = l + (r - l) * f; g = l + (g - l) * f; b = l + (b - l) * f;
    }

    data[i] = r < 0 ? 0 : r > 1 ? 255 : r * 255 + 0.5;
    data[i + 1] = g < 0 ? 0 : g > 1 ? 255 : g * 255 + 0.5;
    data[i + 2] = b < 0 ? 0 : b > 1 ? 255 : b * 255 + 0.5;
  }
  return data;
}

if (typeof document !== "undefined") initUi();

function initUi() {
  const css = document.createElement("style");
  css.textContent = `
    #bake .note { color: var(--muted); font-size: .78rem; line-height: 1.75; margin-bottom: 12px; }
    #bake .pick { width: 100%; padding: 13px; border: 1.5px dashed #93a8b0; border-radius: 14px; background: #f8fbfa; color: var(--blue); font-weight: 800; }
    #bake .stage { display: none; margin-top: 14px; } #bake .stage.show { display: block; }
    #bake canvas { width: 100%; height: auto; border-radius: 14px; background: #e6edf0; display: block; touch-action: none; }
    #bake .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
    #bake .chip { border: 1px solid var(--line); background: #fff; color: var(--ink); border-radius: 999px; padding: 7px 12px; font-size: .78rem; font-weight: 800; }
    #bake .chip.on { background: var(--blue); border-color: var(--blue); color: #fff; }
    #bake .row { display: grid; grid-template-columns: 64px 1fr 40px; gap: 10px; align-items: center; margin: 9px 0; font-size: .8rem; }
    #bake .row input[type=range] { width: 100%; direction: ltr; accent-color: var(--blue); }
    #bake .row output { text-align: end; color: var(--muted); font-variant-numeric: tabular-nums; direction: ltr; }
    #bake .btns { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 12px; }
    #bake .btns button, #bake .btns a { flex: 1 1 120px; text-align: center; text-decoration: none; padding: 11px 12px; border-radius: 11px; font-size: .82rem; font-weight: 800; border: 1px solid var(--blue); }
    #bake .save { background: var(--blue); color: #fff; } #bake .cmp { background: transparent; color: var(--blue); }
    #bake .msg { margin-top: 10px; font-size: .8rem; color: var(--muted); } #bake .msg.err { color: var(--bad); }
  `;
  document.head.appendChild(css);

  const sec = document.createElement("section");
  sec.className = "panel";
  sec.id = "bake";
  sec.innerHTML = `
    <div class="panel-title"><h2>أي صورة (JPEG / PNG / HEIC)</h2><span class="badge">تطبيق مباشر</span></div>
    <p class="note">لوحة Photographic Styles داخل Photos تحتاج HEIC أصلي. هنا يُطبَّق الأسلوب مباشرة على البكسلات ويُحفظ JPEG عادي. هذا تقريب للمظهر وليس معالج أبل نفسه.</p>
    <button class="pick" type="button">اختر صورة</button>
    <input id="bakeFile" type="file" accept="image/*" hidden>
    <div class="stage">
      <canvas></canvas>
      <div class="chips"></div>
      <label class="row"><span>Tone</span><input type="range" min="-100" max="100" value="0" data-k="tone"><output>0</output></label>
      <label class="row"><span>Color</span><input type="range" min="-100" max="100" value="0" data-k="color"><output>0</output></label>
      <label class="row"><span>Warmth</span><input type="range" min="-100" max="100" value="0" data-k="warmth"><output>0</output></label>
      <div class="btns"><button class="cmp" type="button">اضغط مطوّلًا: الأصل</button><button class="save" type="button">حفظ JPEG</button><a class="dl" download style="display:none">تنزيل</a></div>
    </div>
    <div class="msg"></div>`;
  const footer = document.querySelector("footer");
  footer.parentNode.insertBefore(sec, footer);

  const $ = (s) => sec.querySelector(s);
  const file = $("#bakeFile"), stage = $(".stage"), canvas = $("canvas"), msg = $(".msg");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const sliders = [...sec.querySelectorAll("input[type=range]")];
  const params = { tone: 0, color: 0, warmth: 0 };
  let bitmap = null, name = "image", preview = null, raf = 0, showOriginal = false, url = null;

  const say = (t, err) => { msg.textContent = t; msg.className = "msg" + (err ? " err" : ""); };

  const chips = $(".chips");
  for (const [key, p] of Object.entries(PRESETS)) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.textContent = p.name; b.dataset.key = key;
    b.onclick = () => { setParams(p); };
    chips.appendChild(b);
  }

  function setParams(p) {
    for (const s of sliders) { s.value = p[s.dataset.k]; params[s.dataset.k] = +s.value; s.nextElementSibling.textContent = s.value; }
    mark(); schedule();
  }
  function mark() {
    for (const b of chips.children) {
      const p = PRESETS[b.dataset.key];
      b.classList.toggle("on", p.tone === params.tone && p.color === params.color && p.warmth === params.warmth);
    }
  }
  for (const s of sliders) s.addEventListener("input", () => {
    params[s.dataset.k] = +s.value; s.nextElementSibling.textContent = s.value; mark(); schedule();
  });

  function draw() {
    raf = 0;
    if (!preview) return;
    const img = new ImageData(new Uint8ClampedArray(preview.data), preview.width, preview.height);
    if (!showOriginal) gradePixels(img.data, params);
    ctx.putImageData(img, 0, 0);
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(draw); }

  const cmp = $(".cmp");
  const hold = (v) => () => { showOriginal = v; schedule(); };
  cmp.addEventListener("pointerdown", hold(true));
  for (const e of ["pointerup", "pointerleave", "pointercancel"]) cmp.addEventListener(e, hold(false));

  async function decode(f) {
    try { return await createImageBitmap(f, { imageOrientation: "from-image" }); }
    catch (e) {
      const u = URL.createObjectURL(f);
      try {
        const img = new Image(); img.src = u; await img.decode(); return img;
      } finally { URL.revokeObjectURL(u); }
    }
  }
  const dims = (src) => [src.naturalWidth || src.width, src.naturalHeight || src.height];

  $(".pick").onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files[0];
    if (!f) return;
    say("يقرأ الصورة…");
    try {
      bitmap = await decode(f);
    } catch (e) { say("هذه الصيغة غير مدعومة من المتصفح.", true); return; }
    name = f.name.replace(/\.[^.]+$/, "");
    const [w, h] = dims(bitmap);
    const k = Math.min(1, 1100 / Math.max(w, h));
    canvas.width = Math.max(1, Math.round(w * k)); canvas.height = Math.max(1, Math.round(h * k));
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    preview = ctx.getImageData(0, 0, canvas.width, canvas.height);
    stage.classList.add("show");
    setParams(PRESETS.vibrant);
    say(`${w} × ${h}`);
  };

  $(".save").onclick = async () => {
    if (!bitmap) return;
    say("يعالج الدقة الكاملة…");
    await new Promise((r) => setTimeout(r, 30));
    try {
      let [w, h] = dims(bitmap);
      const k = Math.min(1, Math.sqrt(16e6 / (w * h)));
      w = Math.round(w * k); h = Math.round(h * k);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const x = c.getContext("2d", { willReadFrequently: true });
      x.drawImage(bitmap, 0, 0, w, h);
      const img = x.getImageData(0, 0, w, h);
      gradePixels(img.data, params);
      x.putImageData(img, 0, 0);
      const blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/jpeg", 0.95));
      const out = `${name}_Styled.jpg`;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (window.webkit?.messageHandlers?.saveHeic) {
        let s = "";
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        window.webkit.messageHandlers.saveHeic.postMessage({ name: out, base64: btoa(s) });
        say("اختر Save Image من قائمة المشاركة.");
      } else {
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(blob);
        const a = $(".dl"); a.href = url; a.download = out; a.style.display = "block"; a.click();
        say("تم إنشاء الملف.");
      }
    } catch (e) { console.error(e); say("تعذر حفظ الصورة.", true); }
  };
}
