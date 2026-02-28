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
