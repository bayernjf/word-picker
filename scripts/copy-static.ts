/**
 * 复制静态资源到 dist/extension
 * 运行前需先执行：npx tsc -p tsconfig.extension.json
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist', 'extension');
const POLYFILL_SRC = path.join(ROOT, 'node_modules', 'webextension-polyfill', 'dist', 'browser-polyfill.min.js');

const STATIC_FILES = [
  'popup/popup.html',
  'popup/popup.css',
  'options/options.html',
  'offscreen/ocr.html',
];

const STATIC_DIRS = ['assets'];

export function copyStaticAssets(): void {
  fs.mkdirSync(DIST, { recursive: true });

  for (const file of STATIC_FILES) {
    const src = path.join(ROOT, file);
    const dest = path.join(DIST, file);
    if (!fs.existsSync(src)) {
      console.error(`[copy-static] Missing: ${file}`);
      process.exit(1);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`[copy-static] ${file}`);
  }

  for (const dir of STATIC_DIRS) {
    const src = path.join(ROOT, dir);
    const dest = path.join(DIST, dir);
    if (!fs.existsSync(src)) {
      console.error(`[copy-static] Missing: ${dir}/`);
      process.exit(1);
    }
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
    console.log(`[copy-static] ${dir}/`);
  }

  console.log('[copy-static] Done');
}

export function copyPolyfill(): void {
  const dest = path.join(DIST, 'content', 'browser-polyfill.js');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(POLYFILL_SRC, dest);
  console.log('[copy-static] browser-polyfill.js → content/');
}

export function copyTesseractAssets(): void {
  const tesseractDist = path.join(ROOT, 'node_modules', 'tesseract.js', 'dist');
  const dest = path.join(DIST, 'assets', 'tesseract');
  fs.mkdirSync(dest, { recursive: true });

  const files = ['tesseract.min.js', 'worker.min.js'];
  for (const file of files) {
    const src = path.join(tesseractDist, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(dest, file));
      console.log(`[copy-static] tesseract/${file}`);
    } else {
      console.warn(`[copy-static] Missing tesseract asset: ${file}`);
    }
  }
}

// 直接运行（非被导入时）
const isMainModule = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^\.[/\\]/, ''));
if (isMainModule) {
  copyStaticAssets();
  copyTesseractAssets();
}
