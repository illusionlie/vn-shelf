import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const sourcePath = path.join(repoRoot, 'src', 'router.js');
const utilsSourcePath = path.join(repoRoot, 'src', 'utils.js');

/**
 * B6c（A3）信封统一：6 个原偏离端点的成功信封形态测试。
 *
 * 目标契约（design.md）：{ success:true, message?, data, ...extras }
 * - extras 仅列表端点：GET /api/vn 顶层 total；GET /api/tier 顶层 total + updatedAt。
 * - GET /api/export 的 data 层必须保持导出文件格式
 *   { version, exportedAt, entries, tierList, appearance }（前端解包后落盘，历史备份兼容）。
 *
 * 注意：utils 不打桩——直接复制真实 src/utils.js 进临时模块目录，
 * 确保断言命中真实 successResponse/errorResponse 实现（避免桩与实现漂移导致假绿）。
 */

function createEntry(id) {
  return {
    id,
    createdAt: '2026-01-01T00:00:00.000Z',
    tierId: null,
    tierSort: null,
    title: `VN ${id}`,
    rating: 80,
    personalRating: 9,
    vndb: {
      title: `VN ${id}`,
      rating: 80,
      tags: ['Drama']
    },
    user: {
      personalRating: 9,
      playTimeHours: 10,
      playTimePartMinutes: 30
    }
  };
}

function createSharedState() {
  return {
    authenticated: true,
    vnList: {
      items: [createEntry('v17'), createEntry('v19')]
    },
    stats: {
      total: 2,
      totalPlayTimeMinutes: 630,
      avgRating: 8,
      avgPersonalRating: 9,
      statusCounts: { playing: 1, finished: 1, stalled: 0, dropped: 0, wishlist: 0, none: 0 },
      ratingHistograms: {
        vndb: [0, 0, 0, 0, 0, 0, 0, 2, 0, 0],
        personal: [0, 0, 0, 0, 0, 0, 0, 0, 2, 0]
      },
      ratingDiff: { avg: 1, count: 2, overrated: [], underrated: [] },
      timeline: {
        months: [{ month: '2026-01', finished: 1, playTimeMinutes: 630 }],
        datedFinished: 1,
        avgSpanDays: 3,
        spanCount: 1
      },
      topDevelopers: [{ name: 'Key', count: 2, avgPersonalRating: 9 }],
      topTags: { vndb: [{ name: 'Drama', count: 2 }], user: [] }
    },
    entries: {
      v17: createEntry('v17')
    },
    tierList: {
      tiers: [
        { id: 'tier_a', name: 'A', color: '#ff0000', order: 0 }
      ],
      updatedAt: '2026-01-02T00:00:00.000Z'
    },
    exportPayload: {
      version: '1.0',
      exportedAt: '2026-01-03T00:00:00.000Z',
      entries: [createEntry('v17')],
      tierList: {
        tiers: [
          { id: 'tier_a', name: 'A', color: '#ff0000', order: 0 }
        ],
        updatedAt: '2026-01-02T00:00:00.000Z'
      },
      appearance: {
        backgroundUrl: '',
        backgroundOverlay: 0.5,
        backgroundBlur: 4
      }
    },
    indexStatus: {
      status: 'running',
      taskId: 'idx_envelope_1',
      total: 5,
      processed: 2,
      failed: [],
      startedAt: '2026-01-04T00:00:00.000Z',
      completedAt: null,
      error: null,
      lastReconciledAt: null
    }
  };
}

async function loadRouterModule({ authenticated = true } = {}) {
  const sourceCode = await fs.readFile(sourcePath, 'utf8');
  const utilsSourceCode = await fs.readFile(utilsSourcePath, 'utf8');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vn-shelf-router-envelope-test-'));
  const routerPath = path.join(tempDir, 'router.module.mjs');
  const authStubPath = path.join(tempDir, 'auth.stub.mjs');
  const repositoryStubPath = path.join(tempDir, 'repository.stub.mjs');
  const indexTaskStubPath = path.join(tempDir, 'index-task.stub.mjs');
  const utilsRealPath = path.join(tempDir, 'utils.real.mjs');
  const vndbStubPath = path.join(tempDir, 'vndb.stub.mjs');
  const testId = `${Date.now()}_${Math.random()}`;

  globalThis.__routerEnvelopeTestRegistry = globalThis.__routerEnvelopeTestRegistry || new Map();
  const state = createSharedState();
  state.authenticated = authenticated;
  globalThis.__routerEnvelopeTestRegistry.set(testId, state);

  const authStubCode = `
const state = globalThis.__routerEnvelopeTestRegistry?.get('${testId}');
const clone = value => JSON.parse(JSON.stringify(value));

export async function authMiddleware() {
  // 与真实契约一致：认证成功时附带已加载的 settings
  if (state.authenticated) {
    return { authenticated: true, settings: clone({ vndbApiToken: '', adminPasswordHash: 'hash', jwtSecret: 'secret' }) };
  }
  return { authenticated: false, error: 'No token' };
}

export async function createJWT() { return 'stub.jwt.token'; }
export function setAuthCookie() {}
export function clearAuthCookie() {}
export async function verifyAdminPassword() { return true; }
export async function setAdminPassword() {}
export async function isInitialized() { return true; }
`;

  const repositoryStubCode = `
const state = globalThis.__routerEnvelopeTestRegistry?.get('${testId}');
const clone = value => JSON.parse(JSON.stringify(value));

// router.js 顶层 import 依赖（status 白名单），与 src/repository.js 保持一致
export const VN_STATUS_VALUES = ['playing', 'finished', 'stalled', 'dropped', 'wishlist'];

export async function getVNList() { return clone(state.vnList); }
export async function getStats() { return clone(state.stats); }
export async function getVNEntry(_env, id) {
  return state.entries[id] ? clone(state.entries[id]) : null;
}
export async function getTierList() { return clone(state.tierList); }
export async function exportData() { return clone(state.exportPayload); }
export async function getSettings() {
  return {
    vndbApiToken: '',
    adminPasswordHash: '',
    jwtSecret: '',
    lastIndexTime: null,
    tagsMode: 'vndb',
    translateTags: true,
    translationUrl: ''
  };
}
export async function saveSettings() {}
export async function saveVNEntry() {}
export async function deleteVNEntry() {}
export async function importData() {}
export async function saveTierList(_env, tierList) { return tierList; }
export async function updateVNTier() { return null; }
export async function batchUpdateVNTiers() { return []; }
export async function clearTierAssignments() { return 0; }
export async function tryAcquireIndexStartLock() { return true; }
export async function releaseIndexStartLock() {}
`;

  const indexTaskStubCode = `
const state = globalThis.__routerEnvelopeTestRegistry?.get('${testId}');
const clone = value => JSON.parse(JSON.stringify(value));

export async function startIndexTask() {
  return { ok: false, status: 500, message: 'unexpected index task call' };
}

export async function getIndexTaskStatus() {
  return clone(state.indexStatus);
}
`;

  const vndbStubCode = `
export async function fetchVNDB() {
  return {};
}

// router.js 顶层 import 依赖（/api/vndb/search），本套件不触达该路由
export class VNDBClient {
  async searchVN() { return []; }
}
`;

  const patchedSource = sourceCode
    .replace(/from '\.\/auth\.js';/, "from './auth.stub.mjs';")
    .replace(/from '\.\/repository\.js';/, "from './repository.stub.mjs';")
    .replace(/from '\.\/index-task\.js';/, "from './index-task.stub.mjs';")
    .replace(/from '\.\/ulist-import\.js';/, "from './ulist-import.stub.mjs';")
    .replace(/from '\.\/utils\.js';/, "from './utils.real.mjs';")
    .replace(/from '\.\/vndb\.js';/, "from './vndb.stub.mjs';");

  await fs.writeFile(authStubPath, authStubCode, 'utf8');
  await fs.writeFile(repositoryStubPath, repositoryStubCode, 'utf8');
  await fs.writeFile(indexTaskStubPath, indexTaskStubCode, 'utf8');
  await fs.writeFile(path.join(tempDir, 'ulist-import.stub.mjs'), 'export async function startUListImport() { return { ok: true, taskId: "ulist_stub" }; }\n', 'utf8');
  await fs.writeFile(utilsRealPath, utilsSourceCode, 'utf8');
  await fs.writeFile(vndbStubPath, vndbStubCode, 'utf8');
  await fs.writeFile(routerPath, patchedSource, 'utf8');

  const moduleUrl = `${pathToFileURL(routerPath).href}?test=${encodeURIComponent(testId)}`;
  const routerModule = await import(moduleUrl);

  return {
    routerModule,
    state,
    async cleanup() {
      globalThis.__routerEnvelopeTestRegistry?.delete(testId);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

async function sendGetRequest(routerModule, requestPath) {
  const request = new Request(`https://example.com${requestPath}`, { method: 'GET' });
  const response = await routerModule.handleRequest(request, {});
  const payload = await response.json();
  return { response, payload };
}

test('GET /api/auth/status 返回成功信封，data 内 initialized/authenticated 为布尔', async () => {
  const { routerModule, cleanup } = await loadRouterModule({ authenticated: true });

  try {
    const { response, payload } = await sendGetRequest(routerModule, '/api/auth/status');

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.ok('data' in payload, '信封必须包含 data 键');
    assert.equal(typeof payload.data.initialized, 'boolean');
    assert.equal(typeof payload.data.authenticated, 'boolean');
    assert.equal(payload.data.initialized, true);
    assert.equal(payload.data.authenticated, true);
  } finally {
    await cleanup();
  }
});

test('GET /api/vn 返回成功信封，data 为数组且 total 保留在顶层', async () => {
  const { routerModule, cleanup } = await loadRouterModule();

  try {
    const { response, payload } = await sendGetRequest(routerModule, '/api/vn');

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.ok(Array.isArray(payload.data), 'data 必须是条目数组');
    assert.equal(payload.data.length, 2);
    assert.deepEqual(payload.data.map(item => item.id).sort(), ['v17', 'v19']);
    assert.equal(payload.total, 2, 'total 必须保留在信封顶层（Q2 决策）');
  } finally {
    await cleanup();
  }
});

test('GET /api/vn/v17 返回成功信封包裹完整条目；不存在条目走错误信封且无 code', async () => {
  const { routerModule, cleanup } = await loadRouterModule();

  try {
    const { response, payload } = await sendGetRequest(routerModule, '/api/vn/v17');

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.id, 'v17');
    // 详情弹窗（shared.js selectedVN = res.data）依赖的 vndb / user 键在 data 层完整
    assert.equal(typeof payload.data.vndb, 'object');
    assert.equal(typeof payload.data.user, 'object');

    // 错误信封零改动守护（AC2）：{ success:false, error }，无 code、无 data
    const missing = await sendGetRequest(routerModule, '/api/vn/v999');
    assert.equal(missing.response.status, 404);
    assert.deepEqual(missing.payload, { success: false, error: '条目不存在' });
    assert.equal('code' in missing.payload, false);
  } finally {
    await cleanup();
  }
});

test('GET /api/tier 返回成功信封，data 为数组且 total/updatedAt 保留在顶层', async () => {
  const { routerModule, cleanup } = await loadRouterModule();

  try {
    const { response, payload } = await sendGetRequest(routerModule, '/api/tier');

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.ok(Array.isArray(payload.data), 'data 必须是 tiers 数组');
    assert.equal(payload.data.length, 1);
    assert.equal(payload.data[0].id, 'tier_a');
    assert.equal(payload.total, 1, 'total 必须保留在信封顶层（Q2 决策）');
    assert.equal(payload.updatedAt, '2026-01-02T00:00:00.000Z', 'updatedAt 必须保留在信封顶层（Q2 决策）');
  } finally {
    await cleanup();
  }
});

test('GET /api/index/status 返回成功信封包裹任务状态对象', async () => {
  const { routerModule, cleanup } = await loadRouterModule({ authenticated: true });

  try {
    const { response, payload } = await sendGetRequest(routerModule, '/api/index/status');

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    // settingsPage 解包整包赋值（indexStatus = res.data）依赖的字段路径全部在 data 层
    assert.equal(payload.data.status, 'running');
    assert.equal(payload.data.taskId, 'idx_envelope_1');
    assert.equal(payload.data.total, 5);
    assert.equal(payload.data.processed, 2);
    assert.deepEqual(payload.data.failed, []);
  } finally {
    await cleanup();
  }
});

test('GET /api/export 信封 data 层保持导出文件格式（version/exportedAt/entries/tierList/appearance）', async () => {
  const { routerModule, cleanup } = await loadRouterModule({ authenticated: true });

  try {
    const { response, payload } = await sendGetRequest(routerModule, '/api/export');

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    // 前端存 res.data（settingsPage exportData 解包后落盘），
    // 导出文件内容必须与旧版裸响应完全一致（R5 历史备份兼容）
    assert.equal(payload.data.version, '1.0');
    assert.equal(typeof payload.data.exportedAt, 'string');
    assert.ok(Array.isArray(payload.data.entries), '导出文件的 entries 必须是数组（import 端校验依赖）');
    assert.equal(payload.data.entries.length, 1);
    assert.ok('tierList' in payload.data, '导出文件必须包含 tierList 键');
    assert.ok('appearance' in payload.data, '导出文件必须包含 appearance 键');
    assert.deepEqual(
      Object.keys(payload.data).sort(),
      ['appearance', 'entries', 'exportedAt', 'tierList', 'version'],
      '导出文件级键必须齐全且无信封字段混入'
    );
  } finally {
    await cleanup();
  }
});

test('GET /api/stats 返回成功信封，data 为聚合对象且区块键齐全', async () => {
  const { routerModule, cleanup } = await loadRouterModule();

  try {
    const { response, payload } = await sendGetRequest(routerModule, '/api/stats');

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    // statsPage 整包解构（stats = res.data）依赖的全部区块键在 data 层
    assert.deepEqual(
      Object.keys(payload.data).sort(),
      [
        'avgPersonalRating',
        'avgRating',
        'ratingDiff',
        'ratingHistograms',
        'statusCounts',
        'timeline',
        'topDevelopers',
        'topTags',
        'total',
        'totalPlayTimeMinutes'
      ],
      '统计聚合区块键必须齐全且无信封字段混入'
    );
    assert.equal(payload.data.total, 2);
    assert.ok(Array.isArray(payload.data.timeline.months), 'timeline.months 必须是数组');
    assert.ok(Array.isArray(payload.data.ratingHistograms.vndb), '直方图必须是数组');
  } finally {
    await cleanup();
  }
});
