/**
 * 打包脚本：生成可上传各浏览器商店的 zip
 *
 * 运行前需先执行 build-cross-browser。
 * 用法：node dist/scripts/pack.js [chrome|safari|all]
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DIST_DIR = path.join(ROOT, "dist");

function packTarget(target: string): void {
  const targetDir = path.join(DIST_DIR, target);
  const manifestPath = path.join(targetDir, "manifest.json");
  const zipPath = path.join(DIST_DIR, `wordpicker-${target}.zip`);

  if (!fs.existsSync(manifestPath)) {
    console.error(`[pack] dist/${target}/manifest.json not found. Run build-cross-browser first.`);
    process.exit(1);
  }

  const entries = fs.readdirSync(targetDir).filter((name) => name !== ".DS_Store");

  if (fs.existsSync(zipPath)) {
    fs.rmSync(zipPath);
  }

  execFileSync(
    "zip",
    ["-r", "-X", zipPath, ...entries, "--exclude", "*.DS_Store", "--exclude", "__MACOSX/*", "--exclude", "*.map"],
    { cwd: targetDir, stdio: "inherit" }
  );

  const bytes = fs.statSync(zipPath).size;
  console.log(`\n[pack] ${target} → ${zipPath} (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
}

function main(): void {
  const target = process.argv[2] || "all";

  if (target === "all") {
    for (const t of ["chrome", "safari"]) {
      if (fs.existsSync(path.join(DIST_DIR, t, "manifest.json"))) {
        packTarget(t);
      } else {
        console.log(`[pack] Skipping ${t}: dist/${t}/manifest.json not found`);
      }
    }
  } else if (["chrome", "safari"].includes(target)) {
    packTarget(target);
  } else {
    console.error(`[pack] Unknown target: ${target}`);
    console.error("Usage: node pack.js [chrome|safari|all]");
    process.exit(1);
  }

  console.log("\n[pack] Done");
}

main();
