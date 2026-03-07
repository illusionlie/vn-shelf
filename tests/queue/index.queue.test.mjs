import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const sourcePath = path.join(repoRoot, 'src', 'index.js');

function createQueueMessage(body) {
  return {
    body,
    ackCalled: false,
    retryCalled: false,
    ack() {
      this.ackCalled = true;
    },
    retry() {
      this.retryCalled = true;
    }
  };
}

async function loadWorkerModule({ kvImpl = {}, fetchVNDBImpl, handleRequestImpl } = {}) {
  const sourceCode = await fs.readFile(sourcePath, 'utf8');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vn-shelf-queue-test-'));
  const testId = `queue_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  if (!globalThis.__queueTestRegistry) {
    globalThis.__queueTestRegistry = new Map();
  }

  globalThis.__queueTestRegistry.set(testId, {
    kvImpl,
    fetchVNDBImpl,
    handleRequestImpl
  });

  const kvStubPath = path.join(tempDir, 'kv.stub.mjs');
  const routerStubPath = path.join(tempDir, 'router.stub.mjs');
  const vndbStubPath = path.join(tempDir, 'vndb.stub.mjs');
  const workerPath = path.join(tempDir, 'index.worker.mjs');

  const kvStubCode = `
const state = globalThis.__queueTestRegistry?.get('${testId}') || {};
const impl = state.kvImpl || {};

function pick(name, fallback) {
  return (...args) => {
    const fn = impl[name] || fallback;
    return fn(...args);
  };
}

export const getVNEntry = pick('getVNEntry', async () => null);
export const saveVNEntry = pick('saveVNEntry', async () => {});
export const getIndexStatus = pick('getIndexStatus', async () => ({
  status: 'idle',
  taskId: null,
  total: 0,
  processed: 0,
  failed: [],
  startedAt: null,
  completedAt: null,
  error: null,
  lastReconciledAt: null
}));
export const rebuildVNList = pick('rebuildVNList', async () => {});
export const recordIndexItemResult = pick('recordIndexItemResult', async () => {});
export const reconcileIndexStatusFromItems = pick('reconcileIndexStatusFromItems', async () => ({
  status: 'idle',
  processed: 0,
  total: 0,
  failed: []
}));
`;

  const routerStubCode = `
const state = globalThis.__queueTestRegistry?.get('${testId}') || {};
const handleRequestImpl = state.handleRequestImpl || (async () => new Response('ok'));

export const handleRequest = (...args) => handleRequestImpl(...args);
`;

  const vndbStubCode = `
const state = globalThis.__queueTestRegistry?.get('${testId}') || {};
const fetchVNDBImpl = state.fetchVNDBImpl || (async () => ({ title: 'stub' }));

export const fetchVNDB = (...args) => fetchVNDBImpl(...args);
`;

  const patchedSource = sourceCode
    .replace(/from '\.\/kv\.js';/, "from './kv.stub.mjs';")
    .replace(/from '\.\/router\.js';/, "from './router.stub.mjs';")
    .replace(/from '\.\/vndb\.js';/, "from './vndb.stub.mjs';");

  await fs.writeFile(kvStubPath, kvStubCode, 'utf8');
  await fs.writeFile(routerStubPath, routerStubCode, 'utf8');
  await fs.writeFile(vndbStubPath, vndbStubCode, 'utf8');
  await fs.writeFile(workerPath, patchedSource, 'utf8');

  const moduleUrl = `${pathToFileURL(workerPath).href}?test=${encodeURIComponent(testId)}`;
  const workerModule = await import(moduleUrl);

  return {
    worker: workerModule.default,
    async cleanup() {
      globalThis.__queueTestRegistry?.delete(testId);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

test('queue 在节流时间窗内不做即时 reconcile，仅注册延迟 reconcile', async () => {
  const reconcileCalls = [];
  const nowIso = new Date().toISOString();

  const { worker, cleanup } = await loadWorkerModule({
    fetchVNDBImpl: async () => ({ title: 'ok' }),
    kvImpl: {
      getVNEntry: async id => ({ id, vndb: {}, user: {} }),
      recordIndexItemResult: async () => {},
      getIndexStatus: async () => ({
        status: 'running',
        taskId: 'idx_throttle_window',
        total: 50,
        processed: 1,
        failed: [],
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: null,
        error: null,
        lastReconciledAt: nowIso
      }),
      reconcileIndexStatusFromItems: async (_env, taskId) => {
        reconcileCalls.push(taskId);
        return {
          status: 'running',
          processed: 2,
          total: 50,
          failed: []
        };
      }
    }
  });

  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, _ms, ...args) => {
    fn(...args);
    return 0;
  };

  try {
    const message = createQueueMessage({
      vndbId: 'v17',
      taskId: 'idx_throttle_window',
      retryCount: 0
    });

    const waitUntilPromises = [];
    const ctx = {
      waitUntil(promise) {
        waitUntilPromises.push(Promise.resolve(promise));
      }
    };

    const env = {
      VN_INDEX_QUEUE: {
        async send() {
          throw new Error('should not retry for success path');
        }
      }
    };

    await worker.queue({ messages: [message] }, env, ctx);

    assert.equal(message.ackCalled, true);
    assert.equal(reconcileCalls.length, 0);
    assert.equal(waitUntilPromises.length, 1);

    await Promise.all(waitUntilPromises);

    assert.equal(reconcileCalls.length, 6);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    await cleanup();
  }
});

test('queue 临近完成时即使在时间窗内也会即时 reconcile', async () => {
  const reconcileCalls = [];
  const rebuildCalls = [];
  const nowIso = new Date().toISOString();

  const { worker, cleanup } = await loadWorkerModule({
    fetchVNDBImpl: async () => ({ title: 'ok' }),
    kvImpl: {
      getVNEntry: async id => ({ id, vndb: {}, user: {} }),
      recordIndexItemResult: async () => {},
      getIndexStatus: async () => ({
        status: 'running',
        taskId: 'idx_near_completion',
        total: 2,
        processed: 1,
        failed: [],
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: null,
        error: null,
        lastReconciledAt: nowIso
      }),
      reconcileIndexStatusFromItems: async (_env, taskId) => {
        reconcileCalls.push(taskId);
        return {
          status: 'completed',
          processed: 2,
          total: 2,
          failed: []
        };
      },
      rebuildVNList: async () => {
        rebuildCalls.push('rebuild');
      }
    }
  });

  try {
    const message = createQueueMessage({
      vndbId: 'v18',
      taskId: 'idx_near_completion',
      retryCount: 0
    });

    const waitUntilPromises = [];
    const ctx = {
      waitUntil(promise) {
        waitUntilPromises.push(Promise.resolve(promise));
      }
    };

    const env = {
      VN_INDEX_QUEUE: {
        async send() {
          throw new Error('should not retry for success path');
        }
      }
    };

    await worker.queue({ messages: [message] }, env, ctx);

    assert.equal(message.ackCalled, true);
    assert.equal(reconcileCalls.length, 1);
    assert.equal(rebuildCalls.length, 1);
    assert.equal(waitUntilPromises.length, 0);
  } finally {
    await cleanup();
  }
});

test('queue 延迟 reconcile 仍可收敛到终态并触发 rebuild', async () => {
  const reconcileCalls = [];
  const rebuildCalls = [];
  const nowIso = new Date().toISOString();

  const { worker, cleanup } = await loadWorkerModule({
    fetchVNDBImpl: async () => ({ title: 'ok' }),
    kvImpl: {
      getVNEntry: async id => ({ id, vndb: {}, user: {} }),
      recordIndexItemResult: async () => {},
      getIndexStatus: async () => ({
        status: 'running',
        taskId: 'idx_delayed_terminal',
        total: 50,
        processed: 1,
        failed: [],
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: null,
        error: null,
        lastReconciledAt: nowIso
      }),
      reconcileIndexStatusFromItems: async (_env, taskId) => {
        reconcileCalls.push(taskId);
        return {
          status: 'completed',
          processed: 50,
          total: 50,
          failed: []
        };
      },
      rebuildVNList: async () => {
        rebuildCalls.push('rebuild');
      }
    }
  });

  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, _ms, ...args) => {
    fn(...args);
    return 0;
  };

  try {
    const message = createQueueMessage({
      vndbId: 'v19',
      taskId: 'idx_delayed_terminal',
      retryCount: 0
    });

    const waitUntilPromises = [];
    const ctx = {
      waitUntil(promise) {
        waitUntilPromises.push(Promise.resolve(promise));
      }
    };

    const env = {
      VN_INDEX_QUEUE: {
        async send() {
          throw new Error('should not retry for success path');
        }
      }
    };

    await worker.queue({ messages: [message] }, env, ctx);

    assert.equal(message.ackCalled, true);
    assert.equal(reconcileCalls.length, 0);
    assert.equal(waitUntilPromises.length, 1);

    await Promise.all(waitUntilPromises);

    assert.equal(reconcileCalls.length, 1);
    assert.equal(rebuildCalls.length, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    await cleanup();
  }
});

test('queue schedules delayed reconcile fallback when immediate reconcile remains running', async () => {
  const reconcileCalls = [];
  const rebuildCalls = [];

  const { worker, cleanup } = await loadWorkerModule({
    fetchVNDBImpl: async () => ({ title: 'ok' }),
    kvImpl: {
      getVNEntry: async id => ({ id, vndb: {}, user: {} }),
      recordIndexItemResult: async () => {},
      getIndexStatus: async () => ({
        status: 'running',
        taskId: 'idx_r1',
        total: 2,
        processed: 1,
        failed: [],
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: null,
        error: null,
        lastReconciledAt: null
      }),
      reconcileIndexStatusFromItems: async (_env, taskId) => {
        reconcileCalls.push(taskId);
        return {
          status: reconcileCalls.length >= 2 ? 'completed' : 'running',
          processed: reconcileCalls.length >= 2 ? 2 : 1,
          total: 2,
          failed: []
        };
      },
      rebuildVNList: async () => {
        rebuildCalls.push('rebuild');
      }
    }
  });

  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, _ms, ...args) => {
    fn(...args);
    return 0;
  };

  try {
    const message = createQueueMessage({
      vndbId: 'v17',
      taskId: 'idx_r1',
      retryCount: 0
    });

    const waitUntilPromises = [];
    const ctx = {
      waitUntil(promise) {
        waitUntilPromises.push(Promise.resolve(promise));
      }
    };

    const env = {
      VN_INDEX_QUEUE: {
        async send() {
          throw new Error('should not retry for success path');
        }
      }
    };

    await worker.queue({ messages: [message] }, env, ctx);

    assert.equal(message.ackCalled, true);
    assert.equal(waitUntilPromises.length, 1);

    await Promise.all(waitUntilPromises);

    assert.equal(reconcileCalls.length, 2);
    assert.equal(rebuildCalls.length, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    await cleanup();
  }
});

test('queue delayed reconcile stops retrying after reaching max attempts', async () => {
  const reconcileCalls = [];

  const { worker, cleanup } = await loadWorkerModule({
    fetchVNDBImpl: async () => ({ title: 'ok' }),
    kvImpl: {
      getVNEntry: async id => ({ id, vndb: {}, user: {} }),
      recordIndexItemResult: async () => {},
      getIndexStatus: async () => ({
        status: 'running',
        taskId: 'idx_retry_cap',
        total: 9,
        processed: 1,
        failed: [],
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: null,
        error: null,
        lastReconciledAt: null
      }),
      reconcileIndexStatusFromItems: async (_env, taskId) => {
        reconcileCalls.push(taskId);
        return {
          status: 'running',
          processed: 1,
          total: 9,
          failed: []
        };
      }
    }
  });

  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, _ms, ...args) => {
    fn(...args);
    return 0;
  };

  try {
    const waitUntilPromises = [];
    const ctx = {
      waitUntil(promise) {
        waitUntilPromises.push(Promise.resolve(promise));
      }
    };

    const env = {
      VN_INDEX_QUEUE: {
        async send() {
          throw new Error('should not retry for success path');
        }
      }
    };

    const messages = [
      createQueueMessage({ vndbId: 'v1', taskId: 'idx_retry_cap', retryCount: 0 })
    ];

    await worker.queue({ messages }, env, ctx);

    assert.equal(waitUntilPromises.length, 1);
    await Promise.all(waitUntilPromises);
    assert.equal(reconcileCalls.length, 6);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    await cleanup();
  }
});

test('queue delayed reconcile retries on transient reconcile error before succeeding', async () => {
  const reconcileCalls = [];
  const rebuildCalls = [];

  const { worker, cleanup } = await loadWorkerModule({
    fetchVNDBImpl: async () => ({ title: 'ok' }),
    kvImpl: {
      getVNEntry: async id => ({ id, vndb: {}, user: {} }),
      recordIndexItemResult: async () => {},
      getIndexStatus: async () => ({
        status: 'running',
        taskId: 'idx_retry_on_error',
        total: 50,
        processed: 1,
        failed: [],
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: null,
        error: null,
        lastReconciledAt: null
      }),
      reconcileIndexStatusFromItems: async (_env, taskId) => {
        reconcileCalls.push(taskId);
        if (reconcileCalls.length === 1) {
          throw new Error('transient reconcile failure');
        }
        return {
          status: 'completed',
          processed: 50,
          total: 50,
          failed: []
        };
      },
      rebuildVNList: async () => {
        rebuildCalls.push('rebuild');
      }
    }
  });

  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, _ms, ...args) => {
    fn(...args);
    return 0;
  };

  try {
    const waitUntilPromises = [];
    const ctx = {
      waitUntil(promise) {
        waitUntilPromises.push(Promise.resolve(promise));
      }
    };

    const env = {
      VN_INDEX_QUEUE: {
        async send() {
          throw new Error('should not retry for success path');
        }
      }
    };

    const messages = [
      createQueueMessage({ vndbId: 'v1', taskId: 'idx_retry_on_error', retryCount: 0 })
    ];

    await worker.queue({ messages }, env, ctx);

    assert.equal(waitUntilPromises.length, 1);
    await Promise.all(waitUntilPromises);
    assert.equal(reconcileCalls.length, 2);
    assert.equal(rebuildCalls.length, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    await cleanup();
  }
});

test('queue delayed reconcile scheduling is idempotent per task within one batch', async () => {
  const { worker, cleanup } = await loadWorkerModule({
    fetchVNDBImpl: async () => ({ title: 'ok' }),
    kvImpl: {
      getVNEntry: async id => ({ id, vndb: {}, user: {} }),
      recordIndexItemResult: async () => {},
      getIndexStatus: async () => ({
        status: 'running',
        taskId: 'idx_r2',
        total: 2,
        processed: 1,
        failed: [],
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: null,
        error: null,
        lastReconciledAt: null
      }),
      reconcileIndexStatusFromItems: async () => ({
        status: 'running',
        processed: 1,
        total: 2,
        failed: []
      })
    }
  });

  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, _ms, ...args) => {
    fn(...args);
    return 0;
  };

  try {
    const waitUntilPromises = [];
    const ctx = {
      waitUntil(promise) {
        waitUntilPromises.push(Promise.resolve(promise));
      }
    };

    const env = {
      VN_INDEX_QUEUE: {
        async send() {
          throw new Error('should not retry for success path');
        }
      }
    };

    const messages = [
      createQueueMessage({ vndbId: 'v1', taskId: 'idx_r2', retryCount: 0 }),
      createQueueMessage({ vndbId: 'v2', taskId: 'idx_r2', retryCount: 0 })
    ];

    await worker.queue({ messages }, env, ctx);

    assert.equal(waitUntilPromises.length, 1);
    await Promise.all(waitUntilPromises);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    await cleanup();
  }
});

test('queue acks original message after retry scheduling succeeds', async () => {
  const sendCalls = [];

  const { worker, cleanup } = await loadWorkerModule({
    fetchVNDBImpl: async () => {
      throw new Error('transient failure');
    }
  });

  try {
    const message = createQueueMessage({
      vndbId: 'v17',
      taskId: 'idx_1',
      retryCount: 0
    });

    const env = {
      VN_INDEX_QUEUE: {
        async send(payload, options) {
          sendCalls.push({ payload, options });
        }
      }
    };

    await worker.queue({ messages: [message] }, env, {});

    assert.equal(sendCalls.length, 1);
    assert.deepEqual(sendCalls[0], {
      payload: {
        vndbId: 'v17',
        taskId: 'idx_1',
        retryCount: 1
      },
      options: { delaySeconds: 60 }
    });
    assert.equal(message.ackCalled, true);
    assert.equal(message.retryCalled, false);
    assert.equal(message.retryCalled, false);
  } finally {
    await cleanup();
  }
});

test('queue triggers original message retry when retry scheduling fails', async () => {
  const { worker, cleanup } = await loadWorkerModule({
    fetchVNDBImpl: async () => {
      throw new Error('transient failure');
    }
  });

  try {
    const message = createQueueMessage({
      vndbId: 'v18',
      taskId: 'idx_2',
      retryCount: 1
    });

    const env = {
      VN_INDEX_QUEUE: {
        async send() {
          throw new Error('queue temporarily unavailable');
        }
      }
    };

    await worker.queue({ messages: [message] }, env, {});

    assert.equal(message.ackCalled, false);
    assert.equal(message.retryCalled, true);
  } finally {
    await cleanup();
  }
});

test('queue acks message after terminal failed result is recorded', async () => {
  const recordCalls = [];

  const { worker, cleanup } = await loadWorkerModule({
    fetchVNDBImpl: async () => {
      throw new Error('permanent failure');
    },
    kvImpl: {
      recordIndexItemResult: async (_env, payload) => {
        recordCalls.push(payload);
      }
    }
  });

  try {
    const message = createQueueMessage({
      vndbId: 'v19',
      taskId: 'idx_3',
      retryCount: 3
    });

    const env = {
      VN_INDEX_QUEUE: {
        async send() {
          throw new Error('should not send when retry limit reached');
        }
      }
    };

    await worker.queue({ messages: [message] }, env, {});

    assert.equal(recordCalls.length, 1);
    assert.equal(recordCalls[0].state, 'failed');
    assert.equal(recordCalls[0].vndbId, 'v19');
    assert.equal(message.ackCalled, true);
  } finally {
    await cleanup();
  }
});

test('queue triggers original message retry when terminal failed result recording fails', async () => {
  const { worker, cleanup } = await loadWorkerModule({
    fetchVNDBImpl: async () => {
      throw new Error('permanent failure');
    },
    kvImpl: {
      recordIndexItemResult: async () => {
        throw new Error('kv write failed');
      }
    }
  });

  try {
    const message = createQueueMessage({
      vndbId: 'v20',
      taskId: 'idx_4',
      retryCount: 3
    });

    const env = {
      VN_INDEX_QUEUE: {
        async send() {
          throw new Error('should not send when retry limit reached');
        }
      }
    };

    await worker.queue({ messages: [message] }, env, {});

    assert.equal(message.ackCalled, false);
    assert.equal(message.retryCalled, true);
  } finally {
    await cleanup();
  }
});
