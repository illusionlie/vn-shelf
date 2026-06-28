/**
 * 可重复下载脚本：用 Node 内置 fetch 拉取 package.json.alpineVersion 指定版本
 * 的 Alpine cdn.min.js 到本目录 alpine.min.js，并做非空 + sha256 校验。
 *
 * 用法：npm run fetch:vendor
 *
 * 设计选择 Node 内置 fetch（而非 `curl` via execSync）：避免把版本号拼进 shell
 * 命令字符串（CodeQL "shell command built from env values" 启发式告警面），
 * 同时跨平台无需 curl 依赖。Node 18+ 自带全局 fetch（项目用 wrangler 已要求 ≥18）。
 *
 * 来源：jsdelivr CDN，与 npm registry 取自同一 tarball。自托管场景下无中间人
 * 威胁面，故不强制 SRI；脚本打印 sha256 便于升级时人工核对来源一致性。
 */
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8')
);
const version = pkg.alpineVersion;
if (!version) {
  console.error('[fetch:vendor] package.json 缺少 alpineVersion 字段');
  process.exit(1);
}

const url = `https://cdn.jsdelivr.net/npm/alpinejs@${version}/dist/cdn.min.js`;
const out = path.join(__dirname, 'alpine.min.js');

(async () => {
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    console.error('[fetch:vendor] 网络请求失败:', err?.message || String(err));
    process.exit(1);
  }

  if (!res.ok) {
    console.error(`[fetch:vendor] HTTP ${res.status} ${res.statusText} - ${url}`);
    process.exit(1);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) {
    console.error('[fetch:vendor] 下载结果为空，疑似 CDN 返回错误页或网络中断');
    process.exit(1);
  }

  // 粗校验：Alpine cdn.min.js 以 IIFE 开头 `(()=>{` 并以 `})()` 系列结尾。
  const head = buf.slice(0, 5).toString();
  if (!head.startsWith('(()=>{') && !buf.toString().startsWith('(()=>')) {
    console.error('[fetch:vendor] 文件头不像 Alpine min bundle，请核对来源');
    process.exit(1);
  }

  fs.mkdirSync(__dirname, { recursive: true });
  fs.writeFileSync(out, buf);

  const sha256 = createHash('sha256').update(buf).digest('hex');
  console.log(`alpine ${version} -> ${out}`);
  console.log(`  bytes: ${buf.length}`);
  console.log(`  sha256: ${sha256}`);
})();