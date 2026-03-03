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

async function loadRouterModule({ authenticated = true, indexStatus = {}, vnItems = [] } = {}) {
  const sourceCode = await fs.readFile(sourcePath, 'utf8');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vn-shelf-router-index-start-test-'));
  const routerPath = path.join(tempDir, 'router.module.mjs');
  const authStubPath = path.join(tempDir, 'auth.stub.mjs');
  const kvStubPath = path.join(tempDir, 'kv.stub.mjs');
  const utilsStubPath = path.join(tempDir, 'utils.stub.mjs');
  const vndbStubPath = path.join(tempDir, 'vndb.stub.mjs');
  const testId = `${Date.now()}_${Math.random()}`;

  globalThis.__routerIndexStartTestRegistry = globalThis.__routerIndexStartTestRegistry || new Map();
  const state = {
    authenticated,
    indexStatus: createIndexStatus(indexStatus),
    vnList: createVNList(vnItems),
    getIndexStatusCalls: 0,
    getVNListCalls: 0,
    saveIndexStatusCalls: []
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
export async function initAdminPassword() {}
export async function isInitialized() { return true; }
`;

  const kvStubCode = `
const state = globalThis.__routerIndexStartTestRegistry?.get('${testId}');
const clone = value => JSON.parse(JSON.stringify(value));

export async function getVNList() {
  state.getVNListCalls += 1;
  return clone(state.vnList);
}

export async function getIndexStatus() {
  state.getIndexStatusCalls += 1;
  return clone(state.indexStatus);
}

export async function saveIndexStatus(env, status) {
  const next = clone(status);
  state.indexStatus = next;
  state.saveIndexStatusCalls.push(next);
}

export async function getVNEntry() { return null; }
export async function saveVNEntry() {}
export async function deleteVNEntry() {}
export async function addEntryToList() {}
export async function removeEntryFromList() {}
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

export function successResponse(data = null, message = '操作成功') {
  return jsonResponse({ success: true, message, data });
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

  const patchedSource = sourceCode
    .replace(/from '\.\/auth\.js';/, "from './auth.stub.mjs';")
    .replace(/from '\.\/kv\.js';/, "from './kv.stub.mjs';")
    .replace(/from '\.\/utils\.js';/, "from './utils.stub.mjs';")
    .replace(/from '\.\/vndb\.js';/, "from './vndb.stub.mjs';");

  await fs.writeFile(authStubPath, authStubCode, 'utf8');
  await fs.writeFile(kvStubPath, kvStubCode, 'utf8');
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

test('并发启动时仅允许一个请求成功，另一个返回冲突', async () => {
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

    assert.equal(state.saveIndexStatusCalls.length, 1);
    assert.equal(state.getVNListCalls, 1);
    assert.equal(state.getIndexStatusCalls, 2);

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
    assert.equal(state.getIndexStatusCalls, 1);
    assert.equal(state.getVNListCalls, 0);
    assert.equal(state.saveIndexStatusCalls.length, 0);
    assert.equal(sendCalls.length, 0);
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

    assert.equal(state.saveIndexStatusCalls.length, 1);
    const savedStatus = state.saveIndexStatusCalls[0];
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

test('发送失败会写入 failed 状态，并允许后续再次启动', async () => {
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
    assert.equal(firstAttempt.response.status, 500);
    assert.deepEqual(firstAttempt.payload, {
      success: false,
      error: '索引任务启动失败，请稍后重试'
    });

    assert.equal(state.saveIndexStatusCalls.length, 2);
    const runningStatus = state.saveIndexStatusCalls[0];
    const failedStatus = state.saveIndexStatusCalls[1];
    assert.equal(runningStatus.status, 'running');
    assert.equal(failedStatus.status, 'failed');
    assert.equal(failedStatus.taskId, runningStatus.taskId);
    assert.equal(failedStatus.error, 'queue send failed');
    assert.ok(typeof failedStatus.completedAt === 'string' && failedStatus.completedAt.length > 0);

    const secondAttempt = await sendStartIndexRequest(routerModule, env);
    assert.equal(secondAttempt.response.status, 200);
    assert.deepEqual(secondAttempt.payload, {
      success: true,
      message: '索引任务已启动',
      data: { total: 3 }
    });

    assert.equal(state.saveIndexStatusCalls.length, 3);
    const restartedStatus = state.saveIndexStatusCalls[2];
    assert.equal(restartedStatus.status, 'running');
    assert.match(restartedStatus.taskId, /^idx_\d+$/);

    assert.equal(sendCalls, 6);
  } finally {
    await cleanup();
  }
});
