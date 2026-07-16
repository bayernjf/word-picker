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

function loadEnvFile(filename: string): void {
  const envPath = path.join(ROOT, filename);
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// Load .env files (priority: .env.local > .env)
loadEnvFile(".env");
loadEnvFile(".env.local");

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      result[key] = deepMerge((result[key] as Record<string, unknown>) || {}, source[key] as Record<string, unknown>);
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

  // Rewrite bare module specifier 'webextension-polyfill' to relative paths
  rewritePolyfillImports(distDir);

  // Merge manifests
  const baseManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.base.json"), "utf-8"));

  let browserManifest: Record<string, unknown>;
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

  // Inject version from RELEASE_VERSION env (set by CI)
  // Chrome/Safari manifest requires version like x.y.z or x.y.z.w (no 'v' prefix, no +metadata)
  let releaseVersion = process.env.RELEASE_VERSION?.trim().replace(/^v/, "");
  if (releaseVersion) {
    // Strip semver build metadata (e.g. 0.0.0-dev+abc1234 -> 0.0.0.0)
    releaseVersion = releaseVersion.replace(/\+.*$/, "");
    // Convert pre-release tags (e.g. 0.0.0-dev) to 4-part dotted version
    releaseVersion = releaseVersion.replace(/-.*$/, "");
    if (/^\d+\.\d+\.\d+(\.\d+)?$/.test(releaseVersion)) {
      (merged as Record<string, unknown>).version = releaseVersion;
      console.log(`[build-cross-browser] Injected release version: ${releaseVersion}`);
    } else {
      console.warn(`[build-cross-browser] Invalid RELEASE_VERSION "${releaseVersion}", keeping manifest default`);
    }
  }

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

function rewritePolyfillImports(distDir: string): void {
  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".js") && !entry.name.startsWith("browser-polyfill")) {
        const relative = path.relative(dir, path.join(distDir, "browser-polyfill.mjs"));
        const importPath = relative.startsWith(".") ? relative : `./${relative}`;
        let content = fs.readFileSync(fullPath, "utf-8");
        if (content.includes("webextension-polyfill")) {
          content = content.replace(/from ['"]webextension-polyfill['"]/g, `from '${importPath}'`);
          fs.writeFileSync(fullPath, content);
        }
      }
    }
  }
  walk(distDir);
  console.log("[build-cross-browser] polyfill imports rewritten");
}

const BINARY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".woff", ".woff2", ".ttf", ".ico"]);
const HTML_APP_URL_LOCAL = "http://localhost:3000/app";

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
      const ext = path.extname(entry.name).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) {
        const content = fs.readFileSync(srcPath);
        fs.writeFileSync(destPath, content);
      } else {
        let content = fs.readFileSync(srcPath, "utf-8");
        content = replaceEnvVars(content, ext === ".html");
        fs.writeFileSync(destPath, content);
      }
    }
  }
}

function replaceEnvVars(content: string, isHtml: boolean = false): string {
  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? '';
  const syncBaseUrl = process.env.SYNC_BASE_URL ?? '';
  const wordBaseAppUrl = process.env.WORD_BASE_APP_URL ?? '';
  const localSyncBase = "http://localhost:3001";
  const localAppUrl = "http://localhost:3000/app";

  // Replace readEnv/readBuildEnv calls in supabase.ts
  content = content.replace(/read(Build)?Env\(['"]SUPABASE_URL['"]\)/g, JSON.stringify(supabaseUrl));
  content = content.replace(/read(Build)?Env\(['"]SUPABASE_ANON_KEY['"]\)/g, JSON.stringify(supabaseAnonKey));
  // Replace constants.ts literal defaults with env values (only when env is provided)
  if (syncBaseUrl) {
    content = content.replace(
      new RegExp(`export const DEFAULT_SYNC_BASE_URL = ${JSON.stringify(localSyncBase)}`),
      `export const DEFAULT_SYNC_BASE_URL = ${JSON.stringify(syncBaseUrl)}`
    );
  }
  if (wordBaseAppUrl) {
    content = content.replace(
      new RegExp(`export const WORD_BASE_APP_URL = ${JSON.stringify(localAppUrl)}`),
      `export const WORD_BASE_APP_URL = ${JSON.stringify(wordBaseAppUrl)}`
    );
  }
  // Legacy process.env references
  content = content.replace(/process\.env\.SUPABASE_URL/g, JSON.stringify(supabaseUrl));
  content = content.replace(/process\.env\.SUPABASE_ANON_KEY/g, JSON.stringify(supabaseAnonKey));
  // Replace hardcoded WordBase app URLs in HTML files only
  if (isHtml && wordBaseAppUrl) {
    content = content.replace(new RegExp(HTML_APP_URL_LOCAL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), wordBaseAppUrl);
  }
  return content;
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
