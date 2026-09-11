// DSH-Store 上架契约自检（只读，不安装、不执行插件代码）。
// 逐项对应 Issue #734 的整改要求：
//   1. manifest 声明可解析的 dsh.bundle.patch，且 Patch 文件在 files 白名单内
//   2. dsh.compatibility.dshReleases 逐版本取值合法（compatible/incompatible/unknown）
//   3. 声明 Node 兼容范围（engines.node）；无生命周期脚本
//   4. Bundle Patch 只新增唯一自有 entry id，且 name 与本包一致；无第三方自指 @deepseek-ai/*
// 用法：node scripts/contract-check.mjs
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fail = [];
const pass = [];
const check = (ok, label, detail) => (ok ? pass : fail).push(detail ? `${label} — ${detail}` : label);

const pkgPath = resolve(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const dsh = pkg.dsh ?? {};

// —— 1. bundle.patch ——
const patchRel = dsh.bundle?.patch;
check(typeof patchRel === "string" && patchRel.length > 0, "dsh.bundle.patch 已声明", JSON.stringify(patchRel));
const patchPath = typeof patchRel === "string" ? resolve(root, patchRel) : null;
check(patchPath !== null && existsSync(patchPath), "Patch 文件存在于包内", patchRel);
const files = Array.isArray(pkg.files) ? pkg.files : [];
const patchShipped = patchPath !== null && files.some((f) => resolve(root, f) === patchPath);
check(patchShipped, "Patch 文件在 files 白名单内", files.join(", "));

// —— 2. 兼容声明 ——
const rel = dsh.compatibility?.dshReleases;
check(rel !== undefined && typeof rel === "object" && !Array.isArray(rel), "dsh.compatibility.dshReleases 已声明");
const ALLOWED = new Set(["compatible", "incompatible", "unknown"]);
const badValues = rel && typeof rel === "object" ? Object.entries(rel).filter(([, v]) => !ALLOWED.has(v)) : [];
check(badValues.length === 0, "dshReleases 取值均为 compatible/incompatible/unknown", JSON.stringify(badValues));
const LATEST_THREE = ["0.1.5-alpha.2", "0.1.5-rc.1", "0.1.5-rc.2"];
const covered = LATEST_THREE.filter((v) => rel && Object.hasOwn(rel, v));
check(covered.length === LATEST_THREE.length, "最新三个官方版本均已逐项列出", covered.join(", "));
const compatibleLatest = LATEST_THREE.filter((v) => rel?.[v] === "compatible");
if (compatibleLatest.length === 0) {
  console.warn(`[warn] 最新三个官方版本没有任何 compatible：Catalog 会判 DSH_LATEST_THREE_COMPATIBILITY_HOLD（不会上架）`);
}

// —— 3. Node 范围 / 生命周期脚本 ——
check(typeof pkg.engines?.node === "string" && pkg.engines.node.length > 0, "engines.node 已声明", pkg.engines?.node);
const LIFECYCLE = ["preinstall", "install", "postinstall", "prepare", "prepublish", "prepublishOnly", "prepack", "postpack"];
const scripts = Object.keys(pkg.scripts ?? {});
const declaredLifecycle = scripts.filter((s) => LIFECYCLE.includes(s));
check(declaredLifecycle.length === 0, "无生命周期脚本", declaredLifecycle.join(", "));

// —— 4. Bundle Patch 结构 ——
// 极简 YAML 子集解析：仅支持本仓使用的 `- insert:` + `- id: / name:` 结构。
function parsePatch(text) {
  const inserts = [];
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trimEnd();
    if (line.trim() === "") continue;
    let m;
    if ((m = /^-\s*insert:\s*$/.exec(line))) {
      current = [];
      inserts.push(current);
      continue;
    }
    if (current && (m = /^\s*-\s*id:\s*(.+?)\s*$/.exec(line))) {
      current.push({ id: m[1].replace(/^['"]|['"]$/g, "") });
      continue;
    }
    if (current && current.length > 0 && (m = /^\s*name:\s*(.+?)\s*$/.exec(line))) {
      current[current.length - 1].name = m[1].replace(/^['"]|['"]$/g, "");
    }
  }
  return inserts;
}

let inserts = [];
if (patchPath && existsSync(patchPath)) {
  inserts = parsePatch(readFileSync(patchPath, "utf8"));
}
const rows = inserts.flat();
check(rows.length === 1, "Bundle Patch 恰好插入 1 个条目", `实际 ${rows.length}`);
const ids = rows.map((r) => r.id);
check(new Set(ids).size === ids.length, "entry id 唯一", ids.join(", "));
const OWN_ID = /^[a-z0-9][a-z0-9-]*$/;
check(ids.every((id) => typeof id === "string" && OWN_ID.test(id)), "entry id 为插件自有形式（小写、无 scope）", ids.join(", "));
check(rows.every((r) => r.name === pkg.name), "Patch 内 name 等于 package.json.name", `${rows.map((r) => r.name).join(", ")} vs ${pkg.name}`);

// —— 5. 客户端自注册 id ——
const clientPath = resolve(root, "lib", "client.js");
const clientSrc = readFileSync(clientPath, "utf8");
const clientId = /__ModuleLoader__\.load\(\s*\{[\s\S]*?\bid:\s*"([^"]+)"/.exec(clientSrc)?.[1];
check(clientId === pkg.name, "__ModuleLoader__.load id 等于包名", `${clientId} vs ${pkg.name}`);

// —— 6. 自指 @deepseek-ai/* 残留 ——
const selfScope = new RegExp(`@deepseek-ai/${pkg.name.replace(/^@[^/]+\//, "")}\\b`, "g");
const offenders = [];
for (const file of ["lib/client.js", "lib/index.js", "README.md", "cordis.patch.yml", "package.json"]) {
  const text = readFileSync(resolve(root, file), "utf8");
  const hits = text.match(selfScope);
  if (hits) offenders.push(`${file} × ${hits.length}`);
}
check(offenders.length === 0, "无自指 @deepseek-ai/* 残留", offenders.join("; "));

// —— 7. 入口语法（宿主半是 ESM，客户端半是浏览器 IIFE 脚本） ——
// 说明：这里不用 child_process 跑 `node --check`（受限沙箱下管道 stdio 不可用），
// 宿主半的 ESM 语法由 `npm test` 前的 `node --check lib/index.js` 负责，本脚本只做脚本侧解析。
try {
  new Function(readFileSync(clientPath, "utf8"));
  pass.push("lib/client.js 语法可解析（脚本）");
} catch (error) {
  fail.push(`lib/client.js 语法错误 — ${error.message}`);
}
const hostSrc = readFileSync(resolve(root, "lib/index.js"), "utf8");
check(/export\s*\{[^}]*\bapply\b/.test(hostSrc), "lib/index.js 导出 apply（ESM 入口形状正确）");

console.log("== dsh-cost 上架契约自检 ==");
for (const line of pass) console.log(`PASS  ${line}`);
for (const line of fail) console.log(`FAIL  ${line}`);
console.log(`-- ${pass.length} passed, ${fail.length} failed`);
if (fail.length > 0) process.exit(1);
console.log(`PASS: 契约自检全部通过（${pass.length} 项）`);
