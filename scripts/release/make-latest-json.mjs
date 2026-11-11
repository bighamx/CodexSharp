#!/usr/bin/env node
// 生成 Codex # fork 的 latest.json（检查更新用的清单），并（可选）上传到对应 release。
//
// 为什么需要它：内置的「检查更新」读 <仓库>/releases/latest/download/latest.json，
// 这份清单决定版本号与安装包资产；上游仓库自带，本 fork 的 release 需要自己生成。
//
// 用法：
//   node scripts/release/make-latest-json.mjs <tag> [--upload]
// 例：
//   node scripts/release/make-latest-json.mjs v2.6.2-sharp.2 --upload
//
// 版本号取 tag 里的数字部分（v2.6.2-sharp.2 → 2.6.2），和应用版本一致；
// 资产只收录本平台安装包与 DMG，其它文件（LICENSE、latest.json 自己）不进列表。

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = process.env.CODEXSHARP_REPO || "bighamx/CodexSharp";
const tag = process.argv[2];
const upload = process.argv.includes("--upload");
if (!tag) {
  console.error("用法: node scripts/release/make-latest-json.mjs <tag> [--upload]");
  process.exit(1);
}

const view = JSON.parse(
  execFileSync(
    "gh",
    ["release", "view", tag, "--repo", repo, "--json", "tagName,url,body,assets,isDraft"],
    { encoding: "utf8" },
  ),
);
if (view.isDraft) {
  console.error(`${tag} 还是草稿，先发布再生成清单`);
  process.exit(1);
}

// 版本号：取 tag 开头的数字段（2.6.2-sharp.2 → 2.6.2）
const match = /^v?(\d+(?:\.\d+)*)/.exec(view.tagName);
if (!match) {
  console.error(`无法从 tag ${view.tagName} 解析版本号`);
  process.exit(1);
}
const version = match[1];

const keep = /(?:windows-x64-setup\.exe|macos-universal\.dmg)$/i;
const assets = view.assets
  .filter((asset) => keep.test(asset.name))
  .map((asset) => ({ name: asset.name, url: asset.url }));

if (!assets.length) {
  console.error(`${tag} 里没找到安装包资产，latest.json 不生成`);
  process.exit(1);
}

const payload = {
  version,
  url: view.url,
  body: view.body,
  assets,
};
const dir = mkdtempSync(join(tmpdir(), "codexsharp-latest-"));
const file = join(dir, "latest.json");
writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`已生成 ${file}（version=${version}，资产 ${assets.length} 个）`);
for (const asset of assets) console.log(`  - ${asset.name}`);

if (upload) {
  execFileSync(
    "gh",
    ["release", "upload", tag, file, "--repo", repo, "--clobber"],
    { stdio: "inherit" },
  );
  console.log(`已上传到 ${tag}`);
}
