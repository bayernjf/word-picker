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
const SUPABASE_SRC = path.join(ROOT, "node_modules", "@supabase", "supabase-js", "dist", "index.mjs");

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

  // Copy polyfill and create ESM wrapper for module imports
  setupPolyfillESM(distDir);

  // Copy supabase-js for auth
  setupSupabaseESM(distDir);

  // Rewrite bare module specifier to relative paths
  rewritePolyfillImports(distDir);

  // Merge manifests
  const baseManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.base.json"), "utf-8"));

  let browserManifest: any;
  if (target === "safari") {
    browserManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.safari.json"), "utf-8"));
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

function setupPolyfillESM(distDir: string): void {
  const polyfillDest = path.join(distDir, "browser-polyfill.js");
  if (!fs.existsSync(POLYFILL_SRC)) {
    console.error("[build-cross-browser] webextension-polyfill not found in node_modules");
    process.exit(1);
  }
  fs.copyFileSync(POLYFILL_SRC, polyfillDest);

  const wrapperDest = path.join(distDir, "browser-polyfill.mjs");
  const wrapperContent = `import './browser-polyfill.js';\nconst browser = globalThis.browser;\nexport default browser;\n`;
  fs.writeFileSync(wrapperDest, wrapperContent);
  console.log("[build-cross-browser] polyfill ESM wrapper created");
}

function setupSupabaseESM(distDir: string): void {
  const supabaseDest = path.join(distDir, "supabase-js.mjs");
  if (!fs.existsSync(SUPABASE_SRC)) {
    console.error("[build-cross-browser] @supabase/supabase-js not found in node_modules");
    process.exit(1);
  }
  fs.copyFileSync(SUPABASE_SRC, supabaseDest);
  console.log("[build-cross-browser] supabase-js copied");
}

function rewritePolyfillImports(distDir: string): void {
  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".js") && !entry.name.startsWith("browser-polyfill") && !entry.name.startsWith("supabase-js")) {
        const polyfillRelative = path.relative(dir, path.join(distDir, "browser-polyfill.mjs"));
        const polyfillImportPath = polyfillRelative.startsWith(".") ? polyfillRelative : `./${polyfillRelative}`;
        const supabaseRelative = path.relative(dir, path.join(distDir, "supabase-js.mjs"));
        const supabaseImportPath = supabaseRelative.startsWith(".") ? supabaseRelative : `./${supabaseRelative}`;
        let content = fs.readFileSync(fullPath, "utf-8");
        let changed = false;
        if (content.includes("webextension-polyfill")) {
          content = content.replace(/from ['"]webextension-polyfill['"]/g, `from '${polyfillImportPath}'`);
          changed = true;
        }
        if (content.includes("@supabase/supabase-js")) {
          content = content.replace(/from ['"]@supabase\/supabase-js['"]/g, `from '${supabaseImportPath}'`);
          changed = true;
        }
        if (changed) {
          fs.writeFileSync(fullPath, content);
        }
      }
    }
  }
  walk(distDir);
  console.log("[build-cross-browser] polyfill and supabase imports rewritten");
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
