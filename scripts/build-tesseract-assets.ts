import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist", "extension");
const TESS_DEST = path.join(DIST, "assets", "tesseract");
const TESSDATA_DEST = path.join(TESS_DEST, "tessdata");

const OCR_LANGS = ["eng", "fra", "spa", "deu", "jpn", "kor"];
const TESSDATA_CDN = "https://tessdata.projectnaptha.com/4.0.0";

const CORE_VARIANTS = [
  "tesseract-core-lstm.wasm",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm",
  "tesseract-core-simd-lstm.wasm.js",
];

function copyFileSafe(src: string, dest: string): boolean {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!fs.existsSync(src)) {
    console.warn(`[tesseract-assets] Missing source: ${src}`);
    return false;
  }
  fs.copyFileSync(src, dest);
  console.log(`[tesseract-assets] copied ${path.basename(src)}`);
  return true;
}

async function downloadFile(url: string, dest: string): Promise<void> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`[tesseract-assets] downloaded ${path.basename(dest)} (${buf.length} bytes)`);
}

export async function buildTesseractAssets(): Promise<void> {
  fs.mkdirSync(TESSDATA_DEST, { recursive: true });

  const tesseractDist = path.join(ROOT, "node_modules", "tesseract.js", "dist");
  for (const f of ["tesseract.min.js", "worker.min.js"]) {
    copyFileSafe(path.join(tesseractDist, f), path.join(TESS_DEST, f));
  }

  const coreDir = path.join(ROOT, "node_modules", "tesseract.js-core");
  for (const v of CORE_VARIANTS) {
    copyFileSafe(path.join(coreDir, v), path.join(TESS_DEST, v));
  }

  for (const lang of OCR_LANGS) {
    const url = `${TESSDATA_CDN}/${lang}.traineddata.gz`;
    const dest = path.join(TESSDATA_DEST, `${lang}.traineddata.gz`);
    if (fs.existsSync(dest) && isGzip(dest)) {
      console.log(`[tesseract-assets] ${lang}.traineddata.gz already present and valid, skip`);
      continue;
    }
    if (fs.existsSync(dest)) {
      console.warn(`[tesseract-assets] ${lang}.traineddata.gz present but corrupted, re-downloading`);
      fs.rmSync(dest, { force: true });
    }
    try {
      await downloadFile(url, dest);
      if (!isGzip(dest)) {
        fs.rmSync(dest, { force: true });
        throw new Error("downloaded file is not a valid gzip (CDN may have returned an error page)");
      }
    } catch (e) {
      console.warn(`[tesseract-assets] Failed to download ${lang}: ${(e as Error).message}`);
    }
  }

  console.log("[tesseract-assets] Done");
}

function isGzip(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(2);
    fs.readSync(fd, buf, 0, 2, 0);
    fs.closeSync(fd);
    return buf[0] === 0x1f && buf[1] === 0x8b;
  } catch {
    return false;
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^\.[/\\]/, ""));
if (isMain) {
  buildTesseractAssets().catch((e) => {
    console.error("[tesseract-assets] build failed:", e);
    process.exit(1);
  });
}
