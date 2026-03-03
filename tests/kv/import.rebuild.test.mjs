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

test('importData replace 导入后列表仅包含新条目', async () => {
  const { kvModule, cleanup } = await loadKVModule();

  try {
    const { env } = createMockEnv({
      'vn:v1': createEntry('v1', 'Old Entry 1'),
      'vn:v2': createEntry('v2', 'Old Entry 2'),
      'vn:list': createListSnapshot(['v1', 'v2'])
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
  } finally {
    await cleanup();
  }
});

test('导入后 exportData 不会漏掉新条目（列表与导出一致）', async () => {
  const { kvModule, cleanup } = await loadKVModule();

  try {
    const { env } = createMockEnv({
      'vn:v1': createEntry('v1', 'Old Entry'),
      'vn:list': createListSnapshot(['v1'])
    });

    await kvModule.importData(env, {
      entries: [createEntry('v2', 'Imported Entry')]
    }, 'merge');

    const list = await kvModule.getVNList(env);
    const exported = await kvModule.exportData(env);

    const listIds = list.items.map(item => item.id);
    const exportedIds = exported.entries.map(entry => entry.id);

    assert.deepEqual(listIds, ['v1', 'v2']);
    assert.deepEqual(exportedIds, ['v1', 'v2']);
    assert.deepEqual(exportedIds, listIds);
  } finally {
    await cleanup();
  }
});
