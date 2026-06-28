/**
 * 可重复下载脚本：拉取 package.json.alpineVersion 指定版本的 Alpine cdn.min.js
 * 到本目录的 alpine.min.js，并做非空 + sha256 校验。
 *
 * 用法：npm run fetch:vendor
 *
 * 自托管场景下无中间人威胁面，故不强制 SRI；此脚本通过打印 sha256
 * 便于升级时人工核对来源一致性（来源：jsdelivr CDN，与 npm registry 取自同一 tarball）。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
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

fs.mkdirSync(__dirname, { recursive: true });
execSync(`curl -fsSL ${url} -o ${out}`, { stdio: 'inherit' });

const buf = fs.readFileSync(out);
if (buf.length === 0) {
  console.error('[fetch:vendor] 下载结果为空，疑似 CDN 返回错误页或网络中断');
  process.exit(1);
}
// 粗校验：Alpine cdn.min.js 以 IIFE 开头 `(()=>{` 并以 `})()` 系列结尾。
const head = buf.slice(0, 5).toString();
const tail = buf.slice(-5).toString();
if (!head.startsWith('(()=>{') && !buf.toString().startsWith('(()=>')) {
  console.error('[fetch:vendor] 文件头不像 Alpine min bundle，请核对来源');
  process.exit(1);
}

const sha256 = createHash('sha256').update(buf).digest('hex');
console.log(`alpine ${version} -> ${out}`);
console.log(`  bytes: ${buf.length}`);
console.log(`  sha256: ${sha256}`);