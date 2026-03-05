import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const sourcePath = path.join(repoRoot, 'src', 'kv.js');

async function loadKVModule() {
  const sourceCode = await fs.readFile(sourcePath, 'utf8');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vn-shelf-kv-reconcile-test-'));
  const modulePath = path.join(tempDir, 'kv.module.mjs');

  await fs.writeFile(modulePath, sourceCode, 'utf8');

  const moduleUrl = `${pathToFileURL(modulePath).href}?test=${encodeURIComponent(`${Date.now()}_${Math.random()}`)}`;
  const kvModule = await import(moduleUrl);

  return {
    kvModule,
    async cleanup() {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

function createMockEnv(seed = {}) {
  const store = new Map();

  for (const [key, value] of Object.entries(seed)) {
    store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }

  return {
    env: {
      KV: {
        async get(key, type) {
          if (!store.has(key)) {
            return null;
          }

          const value = store.get(key);
          if (type === 'json') {
            return JSON.parse(value);
          }

          return value;
        },

        async put(key, value) {
          store.set(key, String(value));
        },

        async delete(key) {
          store.delete(key);
        },

        async list({ prefix = '', cursor } = {}) {
          if (cursor) {
            return {
              keys: [],
              list_complete: true,
              cursor: undefined
            };
          }

          const keys = Array.from(store.keys())
            .filter(name => name.startsWith(prefix))
            .map(name => ({ name }));

          return {
            keys,
            list_complete: true,
            cursor: undefined
          };
        }
      }
    },
    store
  };
}

function writeJson(store, key, value) {
  store.set(key, JSON.stringify(value));
}

test('reconcileIndexStatusFromItems 在并发陈旧写场景下不回退 processed 且不回滚终态', async () => {
  const { kvModule, cleanup } = await loadKVModule();

  try {
    const taskId = 'idx_merge_guard';
    const { env, store } = createMockEnv();

    writeJson(store, 'index:status', createIndexStatus({
      status: 'running',
      taskId,
      total: 2,
      processed: 1,
      failed: [],
      startedAt: '2026-01-01T00:00:00.000Z'
    }));

    writeJson(store, `index:item:${taskId}:v1`, {
      taskId,
      vndbId: 'v1',
      state: 'success',
      retryCount: 0,
      error: null,
      updatedAt: '2026-01-01T00:00:00.000Z'
    });

    // 预置一个陈旧写：当 reconcile 二次读取 latest 时，看到更高进度和终态
    const originalGet = env.KV.get;
    let getStatusCount = 0;
    env.KV.get = async (key, type) => {
      const value = await originalGet(key, type);

      if (key === 'index:status' && type === 'json') {
        getStatusCount += 1;
        if (getStatusCount === 2) {
          const staleProtectedStatus = createIndexStatus({
            status: 'completed',
            taskId,
            total: 2,
            processed: 2,
            failed: [],
            startedAt: '2026-01-01T00:00:00.000Z',
            completedAt: '2026-01-01T00:00:10.000Z'
          });
          writeJson(store, 'index:status', staleProtectedStatus);
          return staleProtectedStatus;
        }
      }

      return value;
    };

    const result = await kvModule.reconcileIndexStatusFromItems(env, taskId);

    assert.equal(result.status, 'completed');
    assert.equal(result.processed, 2);

    const persisted = await kvModule.getIndexStatus(env);
    assert.equal(persisted.status, 'completed');
    assert.equal(persisted.processed, 2);
  } finally {
    await cleanup();
  }
});

test('reconcileIndexStatusFromItems 不会被旧 taskId 的条目结果污染', async () => {
  const { kvModule, cleanup } = await loadKVModule();

  try {
    const currentTaskId = 'idx_current';
    const oldTaskId = 'idx_old';
    const { env, store } = createMockEnv();

    writeJson(store, 'index:status', createIndexStatus({
      status: 'running',
      taskId: currentTaskId,
      total: 2,
      processed: 0,
      failed: [],
      startedAt: '2026-01-01T00:00:00.000Z'
    }));

    writeJson(store, `index:item:${oldTaskId}:v1`, {
      taskId: oldTaskId,
      vndbId: 'v1',
      state: 'success',
      retryCount: 0,
      error: null,
      updatedAt: '2026-01-01T00:00:00.000Z'
    });

    writeJson(store, `index:item:${oldTaskId}:v2`, {
      taskId: oldTaskId,
      vndbId: 'v2',
      state: 'failed',
      retryCount: 3,
      error: 'old failed',
      updatedAt: '2026-01-01T00:00:00.000Z'
    });

    writeJson(store, `index:item:${currentTaskId}:v1`, {
      taskId: currentTaskId,
      vndbId: 'v1',
      state: 'success',
      retryCount: 0,
      error: null,
      updatedAt: '2026-01-01T00:00:00.000Z'
    });

    const result = await kvModule.reconcileIndexStatusFromItems(env, currentTaskId);

    assert.equal(result.processed, 1);
    assert.equal(result.status, 'running');
    assert.deepEqual(clone(result.failed), []);

    const persisted = await kvModule.getIndexStatus(env);
    assert.equal(persisted.processed, 1);
    assert.deepEqual(clone(persisted.failed), []);
  } finally {
    await cleanup();
  }
});
