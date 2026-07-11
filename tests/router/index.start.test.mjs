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
const indexTaskSourcePath = path.join(repoRoot, 'src', 'index-task.js');

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createVNItems(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `v${index + 1}`
  }));
}

function createVNList(items = []) {
  return {
    items: deepClone(items),
    stats: {
      total: items.length,
      totalPlayTimeMinutes: 0,
      avgRating: 0,
      avgPersonalRating: 0
    },
    updatedAt: null
  };
}

function createIndexStatus(overrides = {}) {
  return {
    status: 'idle',
    taskId: null,
    total: 0,
    processed: 0,
    failed: [],
    startedAt: null,
    completedAt: null,
    error: null,
    lastReconciledAt: null,
    ...overrides
  };
}

function createSharedKvState({ indexStatus = {}, vnItems = [] } = {}) {
  return {
    indexStatus: createIndexStatus(indexStatus),
    vnList: createVNList(vnItems),
    getIndexStatusCalls: 0,
    getVNListCalls: 0,
    saveIndexStatusCalls: [],
    startLock: null,
    tryAcquireCalls: 0,
    releaseCalls: 0,
    forceAcquireConflict: false,
    throwOnRelease: false
  };
}

async function loadRouterModule({ authenticated = true, indexStatus = {}, vnItems = [], sharedKvState = null } = {}) {
  const sourceCode = await fs.readFile(sourcePath, 'utf8');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vn-shelf-router-index-start-test-'));
  const routerPath = path.join(tempDir, 'router.module.mjs');
  const indexTaskPath = path.join(tempDir, 'index-task.module.mjs');
  const authStubPath = path.join(tempDir, 'auth.stub.mjs');
  const repositoryStubPath = path.join(tempDir, 'repository.stub.mjs');
  const utilsStubPath = path.join(tempDir, 'utils.stub.mjs');
  const vndbStubPath = path.join(tempDir, 'vndb.stub.mjs');
  const testId = `${Date.now()}_${Math.random()}`;

  globalThis.__routerIndexStartTestRegistry = globalThis.__routerIndexStartTestRegistry || new Map();
  const state = {
    authenticated,
    sharedKvState: sharedKvState || createSharedKvState({ indexStatus, vnItems })
  };
  globalThis.__routerIndexStartTestRegistry.set(testId, state);

  const authStubCode = `
const state = globalThis.__routerIndexStartTestRegistry?.get('${testId}');

export async function authMiddleware() {
  return { authenticated: !!state.authenticated };
}

export async function createJWT() {
  return 'stub.jwt.token';
}

export function setAuthCookie() {}
export function clearAuthCookie() {}
export async function verifyAdminPassword() { return true; }
export async function setAdminPassword() {}
export async function isInitialized() { return true; }
`;

  const repositoryStubCode = `
const state = globalThis.__routerIndexStartTestRegistry?.get('${testId}');
const kv = state.sharedKvState;
const clone = value => JSON.parse(JSON.stringify(value));

export async function listIndexableVNIds() {
  kv.getVNListCalls += 1;
  const rawIds = Array.isArray(kv.vnList?.items)
    ? kv.vnList.items.map(item => (typeof item?.id === 'string' ? item.id.trim() : '')).filter(Boolean)
    : [];

  return Array.from(new Set(rawIds)).sort((a, b) => a.localeCompare(b, 'en'));
}

export async function getIndexStatus() {
  kv.getIndexStatusCalls += 1;
  return clone(kv.indexStatus);
}

export async function saveIndexStatus(env, status) {
  const next = clone(status);
  kv.indexStatus = next;
  kv.saveIndexStatusCalls.push(next);
}

export async function recordIndexItemResult(_env, payload) {
  kv.recordIndexItemResultCalls = kv.recordIndexItemResultCalls || [];
  kv.recordIndexItemResultCalls.push(clone(payload));
}

export async function reconcileIndexStatusFromItems(_env, taskId) {
  kv.reconcileCalls = (kv.reconcileCalls || 0) + 1;
  kv.reconcileTaskIds = kv.reconcileTaskIds || [];
  kv.reconcileTaskIds.push(taskId);

  if (typeof kv.reconcileResultFactory === 'function') {
    const next = clone(kv.reconcileResultFactory(clone(kv.indexStatus), taskId));
    kv.indexStatus = next;
    return clone(next);
  }

  return clone(kv.indexStatus);
}

export async function tryAcquireIndexStartLock(_env, holder) {
  kv.tryAcquireCalls = (kv.tryAcquireCalls || 0) + 1;

  if (kv.forceAcquireConflict) {
    return false;
  }

  const now = Date.now();
  const lock = kv.startLock;
  if (lock && lock.expiresAt > now) {
    return false;
  }

  kv.startLock = {
    holder,
    expiresAt: now + 30 * 1000
  };
  return true;
}

export async function releaseIndexStartLock(_env, holder) {
  kv.releaseCalls = (kv.releaseCalls || 0) + 1;
  if (kv.throwOnRelease) {
    throw new Error('release lock failed');
  }
  if (kv.startLock?.holder === holder) {
    kv.startLock = null;
  }
}

export async function getVNEntry() { return null; }
export async function saveVNEntry() {}
export async function deleteVNEntry() {}
export async function addEntryToList() {}
export async function removeEntryFromList() {}
export async function getVNList() { return clone(kv.vnList); }
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
export async function exportData() {
  return {
    entries: [],
    tierList: {
      tiers: [],
      updatedAt: null
    }
  };
}
export async function importData() {}
export async function getTierList() { return { tiers: [], updatedAt: null }; }
export async function saveTierList(env, tierList) { return tierList; }
export async function updateVNTier() { return null; }
export async function batchUpdateVNTiers() { return []; }
export async function clearTierAssignments() { return 0; }
`;


  const utilsStubCode = `
export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}

export function errorResponse(message, status = 400) {
  return jsonResponse({ success: false, error: message }, status);
}

export function successResponse(data = null, message = '操作成功', extra = {}) {
  return jsonResponse({ success: true, message, data, ...extra });
}

export function isValidVNDBId(id) {
  return /^v\\d+$/.test(id);
}

export async function parseRequestBody(request) {
  try {
    return await request.json();
  } catch {
    throw new Error('请求体格式错误');
  }
}
`;

  const vndbStubCode = `
export async function fetchVNDB() {
  return {};
}
`;

  const indexTaskSourceCode = await fs.readFile(indexTaskSourcePath, 'utf8');
  const patchedIndexTaskSource = indexTaskSourceCode
    .replace(/from '\.\/repository\.js';/, "from './repository.stub.mjs';");

  const patchedSource = sourceCode
    .replace(/from '\.\/auth\.js';/, "from './auth.stub.mjs';")
    .replace(/from '\.\/repository\.js';/, "from './repository.stub.mjs';")
    .replace(/from '\.\/index-task\.js';/, "from './index-task.module.mjs';")
    .replace(/from '\.\/utils\.js';/, "from './utils.stub.mjs';")
    .replace(/from '\.\/vndb\.js';/, "from './vndb.stub.mjs';");

  await fs.writeFile(authStubPath, authStubCode, 'utf8');
  await fs.writeFile(repositoryStubPath, repositoryStubCode, 'utf8');
  await fs.writeFile(indexTaskPath, patchedIndexTaskSource, 'utf8');
  await fs.writeFile(utilsStubPath, utilsStubCode, 'utf8');
  await fs.writeFile(vndbStubPath, vndbStubCode, 'utf8');
  await fs.writeFile(routerPath, patchedSource, 'utf8');

  const moduleUrl = `${pathToFileURL(routerPath).href}?test=${encodeURIComponent(testId)}`;
  const routerModule = await import(moduleUrl);

  return {
    routerModule,
    state,
    async cleanup() {
      globalThis.__routerIndexStartTestRegistry?.delete(testId);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

async function sendStartIndexRequest(routerModule, envOverrides = {}) {
  const request = new Request('https://example.com/api/index/start', {
    method: 'POST'
  });

  const env = {
    VN_INDEX_QUEUE: {
      async send() {}
    },
    ...envOverrides
  };

  const response = await routerModule.handleRequest(request, env);
  const payload = await response.json();

  return { response, payload };
}

test('并发启动时仅允许一个请求成功，另一个返回冲突（同实例内锁）', async () => {
  const vnItems = createVNItems(5);
  const sendCalls = [];

  const { routerModule, state, cleanup } = await loadRouterModule({
    indexStatus: {
      status: 'idle'
    },
    vnItems
  });

  try {
    const env = {
      VN_INDEX_QUEUE: {
        async send(message) {
          sendCalls.push(deepClone(message));
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      }
    };

    const [firstResult, secondResult] = await Promise.all([
      sendStartIndexRequest(routerModule, env),
      sendStartIndexRequest(routerModule, env)
    ]);

    const statuses = [firstResult.response.status, secondResult.response.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [200, 409]);

    const successResult = firstResult.response.status === 200 ? firstResult : secondResult;
    const conflictResult = firstResult.response.status === 409 ? firstResult : secondResult;

    assert.deepEqual(successResult.payload, {
      success: true,
      message: '索引任务已启动',
      data: { total: 5 }
    });

    assert.deepEqual(conflictResult.payload, {
      success: false,
      error: '已有索引任务正在运行'
    });

    assert.equal(state.sharedKvState.saveIndexStatusCalls.length, 2);
    assert.equal(state.sharedKvState.getVNListCalls, 1);
    assert.equal(state.sharedKvState.getIndexStatusCalls, 2);

    assert.equal(sendCalls.length, 5);
    const taskIds = Array.from(new Set(sendCalls.map(item => item.taskId)));
    assert.equal(taskIds.length, 1);
    assert.ok(sendCalls.every(item => item.retryCount === 0));
  } finally {
    await cleanup();
  }
});

test('running 状态下重复启动会被拒绝', async () => {
  const sendCalls = [];
  const { routerModule, state, cleanup } = await loadRouterModule({
    indexStatus: {
      status: 'running',
      taskId: 'idx_existing',
      total: 10,
      processed: 2,
      failed: []
    },
    vnItems: createVNItems(3)
  });

  try {
    const { response, payload } = await sendStartIndexRequest(routerModule, {
      VN_INDEX_QUEUE: {
        async send(payload) {
          sendCalls.push(payload);
        }
      }
    });

    assert.equal(response.status, 409);
    assert.deepEqual(payload, {
      success: false,
      error: '已有索引任务正在运行'
    });
    assert.equal(state.sharedKvState.getIndexStatusCalls, 1);
    assert.equal(state.sharedKvState.getVNListCalls, 0);
    assert.equal(state.sharedKvState.saveIndexStatusCalls.length, 0);
    assert.equal(sendCalls.length, 0);
  } finally {
    await cleanup();
  }
});

test('查询索引状态时直接返回当前状态，不触发 reconcile', async () => {
  const sharedKvState = createSharedKvState({
    indexStatus: {
      status: 'running',
      taskId: 'idx_running_1',
      total: 8,
      processed: 1,
      failed: []
    }
  });

  const { routerModule, state, cleanup } = await loadRouterModule({ sharedKvState });

  try {
    const request = new Request('https://example.com/api/index/status', {
      method: 'GET'
    });

    const response = await routerModule.handleRequest(request, {});
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.status, 'running');
    assert.equal(payload.data.processed, 1);
    assert.equal(state.sharedKvState.getIndexStatusCalls, 1);
    assert.equal(state.sharedKvState.reconcileCalls || 0, 0);
  } finally {
    await cleanup();
  }
});

test('查询索引状态时，非 running 任务不会触发 reconcile', async () => {
  const sharedKvState = createSharedKvState({
    indexStatus: {
      status: 'completed',
      taskId: 'idx_completed_1',
      total: 8,
      processed: 8,
      failed: []
    }
  });

  const { routerModule, state, cleanup } = await loadRouterModule({ sharedKvState });

  try {
    const request = new Request('https://example.com/api/index/status', {
      method: 'GET'
    });

    const response = await routerModule.handleRequest(request, {});
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.status, 'completed');
    assert.equal(payload.data.processed, 8);
    assert.equal(state.sharedKvState.getIndexStatusCalls, 1);
    assert.equal(state.sharedKvState.reconcileCalls || 0, 0);
  } finally {
    await cleanup();
  }
});

test('查询索引状态时不会因 reconcile 副作用而报错', async () => {
  const sharedKvState = createSharedKvState({
    indexStatus: {
      status: 'running',
      taskId: 'idx_running_fallback',
      total: 6,
      processed: 2,
      failed: []
    }
  });

  const { routerModule, state, cleanup } = await loadRouterModule({ sharedKvState });

  try {
    const request = new Request('https://example.com/api/index/status', {
      method: 'GET'
    });

    const response = await routerModule.handleRequest(request, {});
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.status, 'running');
    assert.equal(payload.data.processed, 2);
    assert.equal(state.sharedKvState.getIndexStatusCalls, 1);
    assert.equal(state.sharedKvState.reconcileCalls || 0, 0);
  } finally {
    await cleanup();
  }
});

test('正常启动会创建任务状态并发送全部消息', async () => {
  const vnItems = [{ id: 'v17' }, { id: 'v19' }, { id: 'v23' }];
  const sendCalls = [];
  const { routerModule, state, cleanup } = await loadRouterModule({
    indexStatus: {
      status: 'idle'
    },
    vnItems
  });

  try {
    const { response, payload } = await sendStartIndexRequest(routerModule, {
      VN_INDEX_QUEUE: {
        async send(message) {
          sendCalls.push(deepClone(message));
        }
      }
    });

    assert.equal(response.status, 200);
    assert.deepEqual(payload, {
      success: true,
      message: '索引任务已启动',
      data: { total: 3 }
    });

    assert.equal(state.sharedKvState.saveIndexStatusCalls.length, 2);
    const [startingStatus, savedStatus] = state.sharedKvState.saveIndexStatusCalls;
    assert.equal(startingStatus.status, 'starting');
    assert.equal(savedStatus.status, 'running');
    assert.equal(savedStatus.status, 'running');
    assert.equal(savedStatus.total, 3);
    assert.equal(savedStatus.processed, 0);
    assert.deepEqual(savedStatus.failed, []);
    assert.equal(savedStatus.completedAt, null);
    assert.equal(savedStatus.error, null);
    assert.equal(savedStatus.lastReconciledAt, null);
    assert.match(savedStatus.taskId, /^idx_\d+$/);
    assert.ok(typeof savedStatus.startedAt === 'string' && savedStatus.startedAt.length > 0);

    assert.equal(sendCalls.length, 3);
    assert.deepEqual(sendCalls.map(item => item.vndbId).sort(), ['v17', 'v19', 'v23']);
    assert.ok(sendCalls.every(item => item.taskId === savedStatus.taskId));
    assert.ok(sendCalls.every(item => item.retryCount === 0));
  } finally {
    await cleanup();
  }
});

test('启动索引时会去重重复 VN ID，并按去重后 total 入队', async () => {
  const vnItems = [
    { id: 'v17' },
    { id: 'v17' },
    { id: 'v19' },
    { id: 'v19' },
    { id: 'v23' }
  ];
  const sendCalls = [];

  const { routerModule, state, cleanup } = await loadRouterModule({
    indexStatus: {
      status: 'idle'
    },
    vnItems
  });

  try {
    const { response, payload } = await sendStartIndexRequest(routerModule, {
      VN_INDEX_QUEUE: {
        async send(message) {
          sendCalls.push(deepClone(message));
        }
      }
    });

    assert.equal(response.status, 200);
    assert.deepEqual(payload, {
      success: true,
      message: '索引任务已启动',
      data: { total: 3 }
    });

    assert.equal(state.sharedKvState.saveIndexStatusCalls.length, 2);
    const savedStatus = state.sharedKvState.saveIndexStatusCalls[1];
    assert.equal(savedStatus.total, 3);

    assert.equal(sendCalls.length, 3);
    assert.deepEqual(sendCalls.map(item => item.vndbId).sort(), ['v17', 'v19', 'v23']);
  } finally {
    await cleanup();
  }
});

test('批量发送使用分片并发并限制并发上界', async () => {
  const vnItems = createVNItems(60);
  let active = 0;
  let maxActive = 0;
  let sendCalls = 0;

  const { routerModule, cleanup } = await loadRouterModule({
    indexStatus: {
      status: 'idle'
    },
    vnItems
  });

  try {
    const { response, payload } = await sendStartIndexRequest(routerModule, {
      VN_INDEX_QUEUE: {
        async send() {
          sendCalls += 1;
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise(resolve => setTimeout(resolve, 5));
          active -= 1;
        }
      }
    });

    assert.equal(response.status, 200);
    assert.deepEqual(payload, {
      success: true,
      message: '索引任务已启动',
      data: { total: 60 }
    });
    assert.equal(sendCalls, 60);
    assert.ok(maxActive > 1, `期望存在并发发送，实际 maxActive=${maxActive}`);
    assert.equal(maxActive, 25);
  } finally {
    await cleanup();
  }
});

test('部分发送失败会记录失败条目，但任务仍进入 running 并允许后续再次启动', async () => {
  const vnItems = [{ id: 'v101' }, { id: 'v102' }, { id: 'v103' }];
  let shouldFailOnce = true;
  let sendCalls = 0;

  const { routerModule, state, cleanup } = await loadRouterModule({
    indexStatus: {
      status: 'idle'
    },
    vnItems
  });

  try {
    const env = {
      VN_INDEX_QUEUE: {
        async send() {
          sendCalls += 1;
          if (shouldFailOnce) {
            shouldFailOnce = false;
            throw new Error('queue send failed');
          }
        }
      }
    };

     const firstAttempt = await sendStartIndexRequest(routerModule, env);
    assert.equal(firstAttempt.response.status, 200);
    assert.deepEqual(firstAttempt.payload, {
      success: true,
      message: '索引任务已启动',
      data: { total: 3 }
    });

     assert.equal(state.sharedKvState.saveIndexStatusCalls.length, 2);
    const startingStatus = state.sharedKvState.saveIndexStatusCalls[0];
    const runningStatus = state.sharedKvState.saveIndexStatusCalls[1];
    assert.equal(startingStatus.status, 'starting');
    assert.equal(runningStatus.status, 'running');
    assert.equal(runningStatus.taskId, startingStatus.taskId);
    assert.equal(runningStatus.processed, 1);
    assert.deepEqual(runningStatus.failed, ['v101']);
    assert.equal(runningStatus.error, '1 个条目入队失败');
    assert.equal(state.sharedKvState.recordIndexItemResultCalls.length, 1);
    assert.deepEqual(state.sharedKvState.recordIndexItemResultCalls[0], {
      taskId: runningStatus.taskId,
      vndbId: 'v101',
      state: 'failed',
      retryCount: 0,
      error: 'enqueue_failed'
    });

    const secondAttempt = await sendStartIndexRequest(routerModule, env);
    assert.equal(secondAttempt.response.status, 409);
    assert.deepEqual(secondAttempt.payload, {
      success: false,
      error: '已有索引任务正在运行'
    });

    assert.equal(state.sharedKvState.saveIndexStatusCalls.length, 2);

    assert.equal(sendCalls, 3);
    assert.equal(state.sharedKvState.releaseCalls, 2);
  } finally {
    await cleanup();
  }
});

test('全部发送失败时会写入 start_failed 状态并返回 500', async () => {
  const vnItems = [{ id: 'v201' }, { id: 'v202' }];

  const { routerModule, state, cleanup } = await loadRouterModule({
    indexStatus: {
      status: 'idle'
    },
    vnItems
  });

  try {
    const { response, payload } = await sendStartIndexRequest(routerModule, {
      VN_INDEX_QUEUE: {
        async send() {
          throw new Error('queue send failed');
        }
      }
    });

    assert.equal(response.status, 500);
    assert.deepEqual(payload, {
      success: false,
      error: '索引任务启动失败，请稍后重试'
    });

    assert.equal(state.sharedKvState.saveIndexStatusCalls.length, 2);
    const startFailedStatus = state.sharedKvState.saveIndexStatusCalls[1];
    assert.equal(startFailedStatus.status, 'start_failed');
    assert.equal(startFailedStatus.processed, 2);
    assert.deepEqual(startFailedStatus.failed, ['v201', 'v202']);
    assert.equal(startFailedStatus.error, 'queue send failed');
    assert.ok(typeof startFailedStatus.completedAt === 'string' && startFailedStatus.completedAt.length > 0);

    assert.equal(state.sharedKvState.recordIndexItemResultCalls.length, 2);
  } finally {
    await cleanup();
  }
});

test('释放锁失败不会覆盖已成功启动的响应', async () => {
  const vnItems = createVNItems(2);
  const sendCalls = [];

  const { routerModule, state, cleanup } = await loadRouterModule({
    indexStatus: {
      status: 'idle'
    },
    vnItems
  });

  state.sharedKvState.throwOnRelease = true;

  try {
    const { response, payload } = await sendStartIndexRequest(routerModule, {
      VN_INDEX_QUEUE: {
        async send(message) {
          sendCalls.push(deepClone(message));
        }
      }
    });

    assert.equal(response.status, 200);
    assert.deepEqual(payload, {
      success: true,
      message: '索引任务已启动',
      data: { total: 2 }
    });

    assert.equal(state.sharedKvState.saveIndexStatusCalls.length, 2);
    assert.equal(state.sharedKvState.saveIndexStatusCalls[1].status, 'running');
    assert.equal(sendCalls.length, 2);
    assert.equal(state.sharedKvState.releaseCalls, 1);
  } finally {
    await cleanup();
  }
});

test('跨实例并发启动会被分布式锁拦截为一个成功一个冲突', async () => {
  const sharedKvState = createSharedKvState({
    indexStatus: { status: 'idle' },
    vnItems: createVNItems(4)
  });

  const first = await loadRouterModule({ sharedKvState });
  const second = await loadRouterModule({ sharedKvState });

  const sendCalls = [];

  try {
    const env = {
      VN_INDEX_QUEUE: {
        async send(message) {
          sendCalls.push(deepClone(message));
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      }
    };

    const [firstResult, secondResult] = await Promise.all([
      sendStartIndexRequest(first.routerModule, env),
      sendStartIndexRequest(second.routerModule, env)
    ]);

    const statuses = [firstResult.response.status, secondResult.response.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [200, 409]);

    const successResult = firstResult.response.status === 200 ? firstResult : secondResult;
    const conflictResult = firstResult.response.status === 409 ? firstResult : secondResult;

    assert.deepEqual(successResult.payload, {
      success: true,
      message: '索引任务已启动',
      data: { total: 4 }
    });
    assert.deepEqual(conflictResult.payload, {
      success: false,
      error: '已有索引任务正在运行'
    });

    assert.equal(sendCalls.length, 4);

    const taskIds = Array.from(new Set(sendCalls.map(item => item.taskId)));
    assert.equal(taskIds.length, 1);

    assert.equal(sharedKvState.saveIndexStatusCalls.length, 2);
    assert.equal(sharedKvState.getIndexStatusCalls, 1);
    assert.equal(sharedKvState.getVNListCalls, 1);
    assert.equal(sharedKvState.tryAcquireCalls, 2);
    assert.equal(sharedKvState.releaseCalls, 1);
    assert.equal(sharedKvState.startLock, null);
  } finally {
    await first.cleanup();
    await second.cleanup();
  }
});

