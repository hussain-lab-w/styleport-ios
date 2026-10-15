import { loadProfile } from "./src/zip.js";
import { patch, profileFor } from "./src/port.js";
import { discoverHeic, dimensionsForItem } from "./src/heif.js";
import { addTexture, hasTexture } from "./src/texture.js";
import { decodeToRgb, loadLibheif } from "./src/decode.js";
import { EMBEDDED_INDEX, EMBEDDED_PROFILES } from "./src/profiles-embedded.js";

const $ = (id) => document.getElementById(id);
const picker = $("picker");
const fileInput = $("file");
const filePanel = $("filePanel");
const fileName = $("fileName");
const fileSize = $("fileSize");
const fileDimensions = $("fileDimensions");
const fileState = $("fileState");
const processButton = $("process");
const textureToggle = $("texture");
const qualityToggle = $("quality");
const status = $("status");
const statusText = $("statusText");
const results = $("results");
const resultText = $("resultText");
const download = $("download");
const share = $("share");

let selected = null;
let selectedBytes = null;
let selectedInfo = null;
let outputUrl = null;
let profileIndex = null;
const profileCache = new Map();

const bytesFromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const bytesToBase64 = (bytes) => {
  let result = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) result += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(result);
};
let decoderAvailable = null;

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
};

const sniff = (bytes) => {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length > 7 && bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  if (bytes.length > 11 && String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === "ftyp") {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    return /^(hei|mif|msf|avi)/.test(brand) ? "heic" : "iso";
  }
  return "unknown";
};

function setStatus(message, type = "busy") {
  status.className = `status show ${type}`;
  statusText.textContent = message;
  status.querySelector(".progress").style.display = type === "busy" ? "block" : "none";
}

function clearOutputUrl() {
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = null;
  download.removeAttribute("href");
}

function reset() {
  selected = null;
  selectedBytes = null;
  selectedInfo = null;
  fileInput.value = "";
  filePanel.classList.remove("show");
  results.classList.remove("show");
  status.className = "status";
  fileName.textContent = "";
  fileSize.textContent = "—";
  fileDimensions.textContent = "—";
  fileState.textContent = "—";
  processButton.disabled = true;
  processButton.textContent = "اختَر صورة للبدء";
  clearOutputUrl();
  picker.focus({ preventScroll: true });
}

async function getProfile(name) {
  if (!profileCache.has(name)) {
    const embedded = EMBEDDED_PROFILES[name];
    if (embedded) profileCache.set(name, await loadProfile(bytesFromBase64(embedded)));
    else {
      const response = await fetch(`profiles/${profileIndex[name].file}`);
      if (!response.ok) throw new Error("تعذر تحميل ملف المعالجة");
      profileCache.set(name, await loadProfile(new Uint8Array(await response.arrayBuffer())));
    }
  }
  return profileCache.get(name);
}

async function ensureDecoder(bytes) {
  if (decoderAvailable !== null) return decoderAvailable;
  try {
    await loadLibheif();
    await decodeToRgb(bytes, { width: 8, height: 8 });
    decoderAvailable = true;
  } catch (error) {
    console.warn("تحليل الألوان غير متاح، سيتم استخدام الإعداد الافتراضي", error);
    decoderAvailable = false;
  }
  return decoderAvailable;
}

function showSelected(file, bytes, d) {
  selected = file;
  selectedBytes = bytes;
  selectedInfo = d;
  filePanel.classList.add("show");
  fileName.textContent = file.name;
  fileSize.textContent = formatBytes(file.size);
  const [width, height] = dimensionsForItem(d.props, d.primary);
  fileDimensions.textContent = width && height ? `${width} × ${height}` : "غير متاح";
  fileState.textContent = d.stylesItem !== null ? "يحتوي Styles" : "جاهز للإضافة";
  processButton.disabled = false;
  processButton.textContent = "إضافة Photographic Styles";
  results.classList.remove("show");
  clearOutputUrl();
}

async function inspectFile(file) {
  reset();
  setStatus("يفحص الملف ويقرأ بنيته…");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniff(bytes);
  if (kind !== "heic") {
    filePanel.classList.add("show");
    fileName.textContent = file.name;
    fileSize.textContent = formatBytes(file.size);
    fileState.textContent = kind === "jpeg" ? "JPEG — ليس HEIC" : "نوع غير مدعوم";
    setStatus(kind === "jpeg" ? "هذا JPEG غالبًا حوّلته iOS أثناء الاختيار. استخدم Browse من Files واختر HEIC الأصلي." : "اختر ملف HEIC/HEIF أصليًا من Files.", "error");
    return;
  }
  try {
    const d = discoverHeic(bytes);
    showSelected(file, bytes, d);
    status.className = "status";
  } catch (error) {
    console.error("تعذر فحص HEIC", error);
    filePanel.classList.add("show");
    fileName.textContent = file.name;
    fileSize.textContent = formatBytes(file.size);
    fileState.textContent = "غير مدعوم";
    setStatus("هذا HEIC لا يحتوي البنية المطلوبة أو تم حفظه عبر تطبيق آخر. جرّب الملف الأصلي من Files.", "error");
  }
}

async function processSelected() {
  if (!selected || !selectedBytes || !selectedInfo || !profileIndex) return;
  processButton.disabled = true;
  setStatus("يجهّز نسخة جديدة دون تعديل الأصل…");
  try {
    let data;
    let details;
    let suffix;
    if (selectedInfo.stylesItem !== null) {
      if (hasTexture(selectedInfo.infos) && textureToggle.checked) {
        throw new Error("هذه الصورة تحتوي مسبقًا على إضافات iOS 27.");
      }
      if (textureToggle.checked) {
        setStatus("يضيف Texture وFilm وGrain إلى الصورة…");
        ({ data } = addTexture(selectedBytes));
        details = "تم إبقاء Photographic Styles الأصلي وإضافة Texture وFilm وGrain.";
        suffix = "_TextureGrain.HEIC";
      } else {
        data = selectedBytes;
        details = "الصورة تحتوي Photographic Styles أصلًا؛ تم إنشاء نسخة دون إضافات iOS 27.";
        suffix = "_PhotographicStyle.HEIC";
      }
    } else {
      if (selectedInfo.thumbnail === null) {
        throw new Error("لا توجد صورة مصغرة مضمنة، والمتصفح لا يستطيع إنشاءها لهذا الملف.");
      }
      const profile = await getProfile(profileFor(profileIndex, selectedInfo));
      const canDecode = qualityToggle.checked ? await ensureDecoder(selectedBytes) : false;
      setStatus(canDecode ? "يطابق بيانات الأسلوب مع ألوان الصورة…" : "يبني بيانات Photographic Styles…");
      const opts = { texture: textureToggle.checked };
      if (canDecode) {
        opts.decode = decodeToRgb;
        opts.sceneStats = "target";
        opts.lightMaps = "target";
      } else {
        opts.sceneStats = "donor";
      }
      const result = await patch(selectedBytes, profile, opts);
      data = result.data;
      const parts = [result.report.decoded ? "مطابقة ألوان أدق" : "إعداد ألوان افتراضي"];
      if (result.report.texture !== "off") parts.push("Texture وFilm وGrain");
      details = `تمت الإضافة: ${parts.join(" · ")}.`;
      suffix = "_PhotographicStyle.HEIC";
    }

    const outputName = selected.name.replace(/\.(heic|heif)$/i, "") + suffix;
    const outputFile = new File([data], outputName, { type: "image/heic" });
    const blob = new Blob([data], { type: "image/heic" });
    outputUrl = URL.createObjectURL(blob);
    download.href = outputUrl;
    download.download = outputName;
    resultText.textContent = details;
    results.classList.add("show");
    if (window.webkit?.messageHandlers?.saveHeic || (navigator.canShare && navigator.canShare({ files: [outputFile] }))) {
      share.style.display = "block";
      share.onclick = async () => {
        try {
          if (window.webkit?.messageHandlers?.saveHeic) {
            window.webkit.messageHandlers.saveHeic.postMessage({ name: outputName, base64: bytesToBase64(data) });
          } else {
            await navigator.share({ files: [outputFile], title: outputName });
          }
        } catch (error) { if (error.name !== "AbortError") setStatus("لم يفتح نظام المشاركة. استخدم زر تنزيل الملف.", "error"); }
      };
    } else {
      share.style.display = "none";
    }
    fileState.textContent = "تم إنشاء نسخة";
    setStatus("اكتملت المعالجة. الأصل محفوظ كما هو والنتيجة نسخة منفصلة.", "ok");
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    console.error("تعذر إنشاء النسخة", error);
    setStatus(error.message.includes("إضافات") ? error.message : "تعذر معالجة هذا الملف. جرّب HEIC الأصلي من Files أو أوقف مطابقة الألوان.", "error");
  } finally {
    processButton.disabled = false;
  }
}

function chooseFiles(files) {
  const file = [...files][0];
  if (file) inspectFile(file).catch((error) => {
    console.error(error);
    setStatus("حدث خطأ أثناء قراءة الملف.", "error");
  });
}

picker.addEventListener("click", () => fileInput.click());
picker.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener("change", () => chooseFiles(fileInput.files));
picker.addEventListener("dragover", (event) => { event.preventDefault(); picker.classList.add("over"); });
picker.addEventListener("dragleave", () => picker.classList.remove("over"));
picker.addEventListener("drop", (event) => { event.preventDefault(); picker.classList.remove("over"); chooseFiles(event.dataTransfer.files); });
processButton.addEventListener("click", processSelected);
$("resetTop").addEventListener("click", reset);

(async () => {
  try {
    profileIndex = EMBEDDED_INDEX;
  } catch (error) {
    console.error("تعذر تحميل ملفات المعالجة", error);
    processButton.disabled = true;
    setStatus("تعذر تحميل مكونات المعالجة. أعد تحميل الصفحة.", "error");
  }
})();

if (location.protocol === "file:") {
  qualityToggle.checked = false;
  qualityToggle.disabled = true;
  qualityToggle.parentElement.querySelector("small").textContent = "غير متاح في النسخة الأوفلاين؛ المعالجة الأساسية تعمل محليًا.";
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
