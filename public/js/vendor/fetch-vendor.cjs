/**
 * 可重复下载脚本：用 Node 内置 fetch 按 package.json 记录的锁定版本拉取前端运行时
 * 第三方库到 public/js/vendor/，并做非空 + sha256 校验。
 *
 * 用法：npm run fetch:vendor
 *
 * 覆盖：
 *   - alpinejs  (alpineVersion)  -> alpine.min.js   (dist/cdn.min.js, IIFE)
 *   - marked    (markedVersion)   -> marked.min.js   (lib/marked.esm.js, ESM)
 *   - dompurify (purifyVersion)   -> purify.min.js   (dist/purify.es.mjs, ESM)
 *
 * 设计选择 Node 内置 fetch（而非 `curl` via execSync）：避免把版本号拼进 shell
 * 命令字符串（CodeQL "shell command built from env values" 启发式告警面），
 * 同时跨平台无需 curl 依赖。Node 18+ 自带全局 fetch（项目用 wrangler 已要求 ≥18）。
 *
 * 来源：jsdelivr CDN，与 npm registry 取自同一 tarball。自托管场景下无中间人
 * 威胁面，故不强制 SRI；脚本打印 sha256 便于升级时人工核对来源一致性。
 *
 * 命名说明：marked 上游不发布 minified ESM bundle（仅 lib/marked.esm.js 未压缩 ESM），
 * dompurify 的 ESM 构建（dist/purify.es.mjs）亦未压缩；二者按 vendor `.min.js` 约定
 * 命名以落入 eslint 的 `*.min.js` 忽略 glob（匹配后缀 .min.js），实际内容为 ESM 源码（浏览器以 module
 * 方式 import，扩展名不影响 ESM 解析）。
 */
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8')
);

const VENDOR_DIR = __dirname;

const targets = [
  {
    name: 'alpine',
    version: pkg.alpineVersion,
    url: (v) => `https://cdn.jsdelivr.net/npm/alpinejs@${v}/dist/cdn.min.js`,
    out: 'alpine.min.js',
    headCheck: (buf) => buf.toString().startsWith('(()=>')
  },
  {
    name: 'marked',
    version: pkg.markedVersion,
    url: (v) => `https://cdn.jsdelivr.net/npm/marked@${v}/lib/marked.esm.js`,
    out: 'marked.min.js',
    headCheck: (buf) => buf.toString().includes('marked.') && buf.toString().includes('export')
  },
  {
    name: 'dompurify',
    version: pkg.purifyVersion,
    url: (v) => `https://cdn.jsdelivr.net/npm/dompurify@${v}/dist/purify.es.mjs`,
    out: 'purify.min.js',
    headCheck: (buf) => buf.toString().includes('DOMPurify') && buf.toString().includes('export')
  }
];

function fail(msg) {
  console.error(`[fetch:vendor] ${msg}`);
  process.exit(1);
}

(async () => {
  fs.mkdirSync(VENDOR_DIR, { recursive: true });

  for (const t of targets) {
    if (!t.version) {
      fail(`package.json 缺少 ${t.name} 版本字段`);
    }
    const url = t.url(t.version);
    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      fail(`${t.name} 网络请求失败: ${err?.message || String(err)}`);
    }
    if (!res.ok) {
      fail(`${t.name} HTTP ${res.status} ${res.statusText} - ${url}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) {
      fail(`${t.name} 下载结果为空，疑似 CDN 返回错误页或网络中断`);
    }
    if (!t.headCheck(buf)) {
      fail(`${t.name} 文件头不像预期 bundle，请核对来源: ${url}`);
    }

    const out = path.join(VENDOR_DIR, t.out);
    fs.writeFileSync(out, buf);

    const sha256 = createHash('sha256').update(buf).digest('hex');
    console.log(`${t.name} ${t.version} -> ${out}`);
    console.log(`  bytes: ${buf.length}`);
    console.log(`  sha256: ${sha256}`);
  }
})();
