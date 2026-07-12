import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const sourcePath = path.join(repoRoot, 'src', 'ulist-import.js');
const vndbSourcePath = path.join(repoRoot, 'src', 'vndb.js');

// 加载真实 ulist-import.js，仅 stub 其 repository 依赖；vndb 复用真实（mapUListItemToEntry）
async function loadModule({ repoImpl = {}, createClientImpl } = {}) {
  const sourceCode = await fs.readFile(sourcePath, 'utf8');
  const vndbSourceCode = await fs.readFile(vndbSourcePath, 'utf8');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vn-shelf-ulist-import-test-'));
  const testId = `ulist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  globalThis.__ulistImportTestRegistry = globalThis.__ulistImportTestRegistry || new Map();
  globalThis.__ulistImportTestRegistry.set(testId, { repoImpl, createClientImpl });

  const repoStub = `
const state = globalThis.__ulistImportTestRegistry.get('${testId}');
const impl = state.repoImpl || {};
function pick(name, fallback) {
  return (...args) => (impl[name] || fallback)(...args);
}
export const getIndexStatus = pick('getIndexStatus', async () => ({ status: 'idle', type: 'index', startedAt: null }));
export const saveIndexStatus = pick('saveIndexStatus', async () => {});
export const saveVNEntry = pick('saveVNEntry', async () => {});
export const listIndexableVNIds = pick('listIndexableVNIds', async () => []);
export async function getSettings() { return { vndbApiToken: 'tk' }; }
`;

  // vndb stub：复用真实 mapUListItemToEntry，但 createVNDBClient 走注入
  const vndbStub = `
${vndbSourceCode.replace(/import \{ getSettings \} from '\.\/repository\.js';/, '')}
`.replace(
    /export async function createVNDBClient\(env\) \{[\s\S]*?\n\}/,
    `export async function createVNDBClient() {
  const state = globalThis.__ulistImportTestRegistry.get('${testId}');
  return state.createClientImpl();
}`
  );

  const repoStubPath = path.join(tempDir, 'repository.stub.mjs');
  const vndbStubPath = path.join(tempDir, 'vndb.stub.mjs');
  const modulePath = path.join(tempDir, 'ulist-import.mjs');

  const patched = sourceCode
    .replace(/from '\.\/repository\.js';/, "from './repository.stub.mjs';")
    .replace(/from '\.\/vndb\.js';/, "from './vndb.stub.mjs';");

  await fs.writeFile(repoStubPath, repoStub, 'utf8');
  await fs.writeFile(vndbStubPath, vndbStub, 'utf8');
  await fs.writeFile(modulePath, patched, 'utf8');

  const mod = await import(`${pathToFileURL(modulePath).href}?t=${testId}`);
  return {
    mod,
    async cleanup() {
      globalThis.__ulistImportTestRegistry.delete(testId);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

function makeClient(pages, { authInfo = { id: 'u1', username: 'me', permissions: ['listread'] } } = {}) {
  let call = 0;
  return {
    async getAuthInfo() {
      if (authInfo instanceof Error) throw authInfo;
      return authInfo;
    },
    async fetchUList() {
      const page = pages[call] || { results: [], more: false };
      call += 1;
      return page;
    }
  };
}

function ulistItem(id, labelIds = [2], extra = {}) {
  return {
    id,
    vote: null,
    started: null,
    finished: null,
    labels: labelIds.map(lid => ({ id: lid, label: `l${lid}` })),
    vn: { title: id },
    ...extra
  };
}

test('startUListImport：分页拉取 + 跳过已存在 + skipped 计数', async () => {
  const saved = [];
  const savedStatuses = [];
  const { mod, cleanup } = await loadModule({
    repoImpl: {
      getIndexStatus: async () => ({ status: 'idle', type: 'index', startedAt: '2026-01-01T00:00:00Z' }),
      saveIndexStatus: async (_e, s) => { savedStatuses.push(JSON.parse(JSON.stringify(s))); },
      saveVNEntry: async (_e, entry) => { saved.push(entry.id); },
      listIndexableVNIds: async () => ['v1'] // v1 已存在
    },
    createClientImpl: () => makeClient([
      { results: [ulistItem('v1'), ulistItem('v2'), ulistItem('v3', [5])], more: true },
      { results: [ulistItem('v4', [1])], more: false }
    ])
  });

  try {
    const result = await mod.startUListImport({}, null);
    assert.equal(result.ok, true);
    assert.match(result.taskId, /^ulist_\d+$/);

    // v1 已存在跳过，v3 纯 wishlist 跳过 → imported v2, v4
    assert.deepEqual(saved.sort(), ['v2', 'v4']);

    const terminal = savedStatuses[savedStatuses.length - 1];
    assert.equal(terminal.status, 'completed');
    assert.equal(terminal.type, 'ulist_import');
    assert.equal(terminal.total, 4);
    assert.equal(terminal.skipped, 2); // v1 已存在 + v3 wishlist
    assert.equal(terminal.processed, 4);
    assert.deepEqual(terminal.failed, []);
  } finally {
    await cleanup();
  }
});

test('startUListImport：鉴权失败返回信封错误（无 code）', async () => {
  const { mod, cleanup } = await loadModule({
    repoImpl: {
      getIndexStatus: async () => ({ status: 'idle', type: 'index' })
    },
    createClientImpl: () => makeClient([], {
      authInfo: new Error('VNDB API Token 缺少 listread 权限，无法读取用户列表')
    })
  });

  try {
    const result = await mod.startUListImport({}, null);
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.match(result.message, /listread/);
  } finally {
    await cleanup();
  }
});

test('startUListImport：已有活跃任务时拒绝', async () => {
  const { mod, cleanup } = await loadModule({
    repoImpl: {
      getIndexStatus: async () => ({ status: 'running', type: 'ulist_import' })
    },
    createClientImpl: () => makeClient([])
  });

  try {
    const result = await mod.startUListImport({}, null);
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
  } finally {
    await cleanup();
  }
});

test('startUListImport：写库失败计入 failed，终态 partial', async () => {
  const savedStatuses = [];
  const { mod, cleanup } = await loadModule({
    repoImpl: {
      getIndexStatus: async () => ({ status: 'idle', type: 'index', startedAt: '2026-01-01T00:00:00Z' }),
      saveIndexStatus: async (_e, s) => { savedStatuses.push(JSON.parse(JSON.stringify(s))); },
      saveVNEntry: async (_e, entry) => {
        if (entry.id === 'v2') throw new Error('db fail');
      },
      listIndexableVNIds: async () => []
    },
    createClientImpl: () => makeClient([
      { results: [ulistItem('v1'), ulistItem('v2')], more: false }
    ])
  });

  try {
    await mod.startUListImport({}, null);
    const terminal = savedStatuses[savedStatuses.length - 1];
    assert.equal(terminal.status, 'partial');
    assert.deepEqual(terminal.failed, ['v2']);
  } finally {
    await cleanup();
  }
});
