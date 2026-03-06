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
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vn-shelf-kv-test-'));
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

        async list({ prefix = '' } = {}) {
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

function createEntry(id, title = `Title ${id}`) {
  return {
    id,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    vndb: {
      title,
      titleJa: title,
      titleCn: title,
      image: '',
      imageNsfw: false,
      rating: 8,
      length: '',
      lengthMinutes: 0,
      developers: [],
      tags: [],
      allAge: false
    },
    user: {
      titleCn: '',
      personalRating: 0,
      playTimeHours: 0,
      playTimePartMinutes: 0,
      playTimeMinutes: 0,
      review: '',
      startDate: '',
      finishDate: '',
      tags: [],
      tierId: null,
      tierSort: 0
    }
  };
}

function createListSnapshot(ids) {
  return {
    items: ids.map(id => ({ id })),
    stats: {
      total: ids.length,
      totalPlayTimeMinutes: 0,
      avgRating: 0,
      avgPersonalRating: 0
    },
    updatedAt: '2024-01-01T00:00:00.000Z'
  };
}

test('importData merge 导入新增条目后列表可见，并去重过滤空ID', async () => {
  const { kvModule, cleanup } = await loadKVModule();

  try {
    const { env } = createMockEnv({
      'vn:v1': createEntry('v1', 'Old Entry'),
      'vn:list': createListSnapshot(['v1'])
    });

    await kvModule.importData(env, {
      entries: [
        createEntry('v2', 'New Entry A'),
        createEntry('v2', 'New Entry B'),
        createEntry(''),
        createEntry('   ')
      ]
    }, 'merge');

    const list = await kvModule.getVNList(env);
    const listIds = list.items.map(item => item.id);

    assert.deepEqual(listIds, ['v1', 'v2']);
    assert.equal(listIds.some(id => !id || id.trim() === ''), false);
  } finally {
    await cleanup();
  }
});

test('rebuildVNList 在 vn:list 缺项时仍基于真实键重建，并过滤非法 vn:* 键', async () => {
  const { kvModule, cleanup } = await loadKVModule();

  try {
    const { env } = createMockEnv({
      'vn:v2': createEntry('v2', 'Real Entry 2'),
      'vn:v1': createEntry('v1', 'Real Entry 1'),
      'vn:vx': createEntry('vx', 'Invalid Id Entry'),
      'vn:v3:shadow': createEntry('v3', 'Shadow Entry'),
      'vn:list': createListSnapshot(['v999'])
    });

    await kvModule.rebuildVNList(env);

    const list = await kvModule.getVNList(env);
    assert.deepEqual(list.items.map(item => item.id), ['v1', 'v2']);
    assert.equal(list.stats.total, 2);
  } finally {
    await cleanup();
  }
});

test('importData replace 基于真实键删除旧条目，且不会删除非法 vn:* 键', async () => {
  const { kvModule, cleanup } = await loadKVModule();

  try {
    const { env, store } = createMockEnv({
      'vn:v1': createEntry('v1', 'Old Entry 1'),
      'vn:v2': createEntry('v2', 'Old Entry 2'),
      'vn:legacy-meta': { note: 'keep me' },
      'vn:v5:meta': { note: 'keep me too' },
      'vn:list': createListSnapshot(['v1'])
    });

    await kvModule.importData(env, {
      entries: [createEntry('v3', 'New Entry')]
    }, 'replace');

    const list = await kvModule.getVNList(env);
    assert.deepEqual(list.items.map(item => item.id), ['v3']);

    const oldEntry1 = await kvModule.getVNEntry(env, 'v1');
    const oldEntry2 = await kvModule.getVNEntry(env, 'v2');
    assert.equal(oldEntry1, null);
    assert.equal(oldEntry2, null);

    assert.equal(store.has('vn:legacy-meta'), true);
    assert.equal(store.has('vn:v5:meta'), true);
  } finally {
    await cleanup();
  }
});

test('batchUpdateVNTiers 在分片内写入失败时仍会重建聚合列表以收敛一致性', async () => {
  const { kvModule, cleanup } = await loadKVModule();

  try {
    const sourceCode = await fs.readFile(sourcePath, 'utf8');
    const saveMatch = sourceCode.match(/const BATCH_UPDATE_TIER_CHUNK_SIZE\s*=\s*(\d+)/);
    const chunkSize = saveMatch ? Number(saveMatch[1]) : 25;

    const ids = Array.from({ length: chunkSize + 1 }, (_, index) => `v${index + 1}`);
    const seed = {
      'vn:list': createListSnapshot(ids)
    };

    for (const id of ids) {
      seed[`vn:${id}`] = createEntry(id, `Entry ${id}`);
    }

    const { env, store } = createMockEnv(seed);

    let putCount = 0;
    const originalPut = env.KV.put;
    env.KV.put = async (key, value) => {
      if (key.startsWith('vn:') && key !== 'vn:list') {
        putCount += 1;
        if (putCount === chunkSize + 1) {
          throw new Error('simulated put failure on second chunk');
        }
      }
      return originalPut(key, value);
    };

    const updates = ids.map((id, index) => ({
      id,
      tierId: 'tier-a',
      tierSort: index
    }));

    await assert.rejects(
      () => kvModule.batchUpdateVNTiers(env, updates),
      /simulated put failure on second chunk/
    );

    const changedEntries = [];
    for (const id of ids) {
      const entry = JSON.parse(store.get(`vn:${id}`));
      if (entry?.user?.tierId === 'tier-a') {
        changedEntries.push(id);
      }
    }

    assert.equal(changedEntries.length, chunkSize);

    const list = await kvModule.getVNList(env);
    const listTiered = (list.items || []).filter(item => item.tierId === 'tier-a').map(item => item.id).sort();

    assert.deepEqual(listTiered, changedEntries.sort());
  } finally {
    await cleanup();
  }
});
