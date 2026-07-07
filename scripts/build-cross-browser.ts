/**
 * 跨浏览器构建脚本
 *
 * 将 manifest.base.json 与 manifest.{target}.json 合并，
 * 处理 Safari 专用适配，输出到 dist/{target}/。
 *
 * Chrome 构建产物同时适用于 Edge（Chromium 内核完全兼容）。
 *
 * 用法：node dist/scripts/build-cross-browser.js [chrome|safari|all]
 */

import fs from "node:fs";
import path from "node:path";
import { copyStaticAssets, copyPolyfill } from "./copy-static.js";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "dist", "extension");
const POLYFILL_SRC = path.join(ROOT, "node_modules", "webextension-polyfill", "dist", "browser-polyfill.js");

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function buildForBrowser(target: "chrome" | "safari"): void {
  const distDir = path.join(ROOT, "dist", target);
  console.log(`\n[build-cross-browser] Building for ${target}...`);

  // Clean output directory
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  // Copy compiled JS and static assets from dist/extension to dist/{target}
  copyDirContents(SRC, distDir);

  // Merge manifests
  const baseManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.base.json"), "utf-8"));

  let browserManifest: any;
  if (target === "safari") {
    browserManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.safari.json"), "utf-8"));
    // Copy polyfill for Safari background page
    if (fs.existsSync(POLYFILL_SRC)) {
      fs.copyFileSync(POLYFILL_SRC, path.join(distDir, "browser-polyfill.js"));
    }
    // Copy Safari background script (TS compiled to JS)
    const safariBgSrc = path.join(SRC, "service", "safari-background.js");
    if (fs.existsSync(safariBgSrc)) {
      fs.copyFileSync(safariBgSrc, path.join(distDir, "service", "safari-background.js"));
    }
  } else {
    // Chrome and Edge use the same manifest overrides
    browserManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.chrome.json"), "utf-8"));
  }

  const merged = deepMerge(baseManifest, browserManifest);
  fs.writeFileSync(path.join(distDir, "manifest.json"), JSON.stringify(merged, null, 2));

  console.log(`[build-cross-browser] ${target} built → dist/${target}/`);
}

function copyDirContents(src: string, dest: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirContents(srcPath, destPath);
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function main(): void {
  // Ensure dist/extension exists (TS compiled)
  if (!fs.existsSync(SRC)) {
    console.error("[build-cross-browser] dist/extension not found. Run build:ts first.");
    process.exit(1);
  }

  // Copy static assets to dist/extension first (popup.html, options.html, etc.)
  copyStaticAssets();

  // Copy browser polyfill for content scripts
  copyPolyfill();

  const target = process.argv[2] || "all";

  if (target === "all") {
    buildForBrowser("chrome");
    buildForBrowser("safari");
  } else if (target === "chrome" || target === "safari") {
    buildForBrowser(target);
  } else {
    console.error(`[build-cross-browser] Unknown target: ${target}`);
    console.error("Usage: node build-cross-browser.js [chrome|safari|all]");
    console.error("Note: Chrome build works for Edge too — they share the same Chromium engine.");
    process.exit(1);
  }

  console.log("\n[build-cross-browser] Done");
}

main();
