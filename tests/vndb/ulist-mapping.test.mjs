import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  mapUListItemToEntry,
  mapVnObjectToVndbData,
  VNDBClient
} from '../../src/vndb.js';

// ============ mapUListItemToEntry：状态映射 ============

function makeItem(labelIds, extra = {}) {
  return {
    id: 'v100',
    vote: null,
    started: null,
    finished: null,
    labels: labelIds.map(id => ({ id, label: `label-${id}` })),
    vn: {},
    ...extra
  };
}

test('单 label 映射四状态', () => {
  assert.equal(mapUListItemToEntry(makeItem([1])).user.status, 'playing');
  assert.equal(mapUListItemToEntry(makeItem([2])).user.status, 'finished');
  assert.equal(mapUListItemToEntry(makeItem([3])).user.status, 'stalled');
  assert.equal(mapUListItemToEntry(makeItem([4])).user.status, 'dropped');
});

test('多 label 终态优先 2>4>3>1', () => {
  assert.equal(mapUListItemToEntry(makeItem([1, 2])).user.status, 'finished');
  assert.equal(mapUListItemToEntry(makeItem([3, 4])).user.status, 'dropped');
  assert.equal(mapUListItemToEntry(makeItem([1, 3])).user.status, 'stalled');
  assert.equal(mapUListItemToEntry(makeItem([1, 4])).user.status, 'dropped');
  // 全部四状态出现时取 finished
  assert.equal(mapUListItemToEntry(makeItem([1, 2, 3, 4])).user.status, 'finished');
});

test('纯 wishlist（仅 label5、无 1-4）跳过', () => {
  assert.deepEqual(mapUListItemToEntry(makeItem([5])), { skip: true });
});

test('有 1-4 + wishlist：不跳过，取终态优先值 [1,5]→playing', () => {
  const entry = mapUListItemToEntry(makeItem([1, 5]));
  assert.equal(entry.skip, undefined);
  assert.equal(entry.user.status, 'playing');
});

test('无 1-4 但有其他标签（如 7）→ status null，仍导入', () => {
  const entry = mapUListItemToEntry(makeItem([7]));
  assert.equal(entry.skip, undefined);
  assert.equal(entry.user.status, null);
});

test('无任何 label → status null', () => {
  const entry = mapUListItemToEntry(makeItem([]));
  assert.equal(entry.skip, undefined);
  assert.equal(entry.user.status, null);
});

// ============ vote / 日期映射 ============

test('vote 空 → personalRating 0', () => {
  assert.equal(mapUListItemToEntry(makeItem([1], { vote: null })).user.personalRating, 0);
  assert.equal(mapUListItemToEntry(makeItem([1], { vote: 0 })).user.personalRating, 0);
});

test('vote/10 → personalRating（四舍五入一位小数）', () => {
  assert.equal(mapUListItemToEntry(makeItem([1], { vote: 100 })).user.personalRating, 10);
  assert.equal(mapUListItemToEntry(makeItem([1], { vote: 85 })).user.personalRating, 8.5);
  assert.equal(mapUListItemToEntry(makeItem([1], { vote: 73 })).user.personalRating, 7.3);
});

test('started/finished → startDate/finishDate', () => {
  const entry = mapUListItemToEntry(makeItem([2], {
    started: '2025-01-01',
    finished: '2025-02-02'
  }));
  assert.equal(entry.user.startDate, '2025-01-01');
  assert.equal(entry.user.finishDate, '2025-02-02');
});

test('缺省日期 → null', () => {
  const entry = mapUListItemToEntry(makeItem([2]));
  assert.equal(entry.user.startDate, null);
  assert.equal(entry.user.finishDate, null);
});

test('id 与 vndb 元数据来自 item', () => {
  const entry = mapUListItemToEntry(makeItem([1], {
    id: 'v42',
    vn: { title: 'Foo', rating: 80 }
  }));
  assert.equal(entry.id, 'v42');
  assert.equal(entry.vndb.title, 'Foo');
  assert.equal(entry.vndb.rating, 8);
});

// ============ mapVnObjectToVndbData / getVN 回归 ============

const SAMPLE_VN = {
  title: 'Steins;Gate',
  titles: [
    { lang: 'ja', title: 'シュタインズ・ゲート', official: true },
    { lang: 'zh-Hans', title: '命运石之门', official: true },
    { lang: 'zh-Hant', title: '命運石之門', official: false }
  ],
  image: { url: 'https://img/x.jpg', sexual: 0, violence: 0 },
  rating: 89,
  length_minutes: 3000,
  developers: [{ name: '5pb.' }, { name: 'Nitroplus' }],
  tags: [
    { id: 'g1', name: 'Sci-fi', rating: 2.8, category: 'cont', spoiler: 0 },
    { id: 'g2', name: 'Spoilery', rating: 2.5, category: 'cont', spoiler: 1 },
    { id: 'g3', name: 'Ero', rating: 2.0, category: 'ero', spoiler: 0 },
    { id: 'g235', name: 'No Sexual Content', rating: 3.0, category: 'tech', spoiler: 0 }
  ]
};

test('mapVnObjectToVndbData：标题/tags/g235/rating/length 正确', () => {
  const data = mapVnObjectToVndbData(SAMPLE_VN);
  assert.equal(data.title, 'Steins;Gate');
  assert.equal(data.titleJa, 'シュタインズ・ゲート');
  assert.equal(data.titleCn, '命运石之门');
  assert.equal(data.image, 'https://img/x.jpg');
  assert.equal(data.imageNsfw, false);
  assert.equal(data.rating, 8.9);
  assert.equal(data.lengthMinutes, 3000);
  assert.equal(data.length, '50小时');
  assert.deepEqual(data.developers, ['5pb.', 'Nitroplus']);
  // 只保留 rating>1 + cont + 无剧透 → 仅 Sci-fi
  assert.deepEqual(data.tags, ['Sci-fi']);
  assert.equal(data.allAge, true);
});

test('getVN 抽共享函数后回归：输出与 mapVnObjectToVndbData 一致', async () => {
  const client = new VNDBClient('token');
  // stub request 返回单条 SAMPLE_VN
  client.request = async () => ({ results: [SAMPLE_VN] });

  const result = await client.getVN('v17');
  assert.deepEqual(result, mapVnObjectToVndbData(SAMPLE_VN));
});

test('getVN 未找到抛错', async () => {
  const client = new VNDBClient('token');
  client.request = async () => ({ results: [] });
  await assert.rejects(() => client.getVN('v999'), /未找到视觉小说/);
});

// ============ getAuthInfo / fetchUList：方法 / body / 错误分支 ============

test('getAuthInfo：GET /authinfo，校验 listread，返回 id/username/permissions', async () => {
  const calls = [];
  const client = new VNDBClient('token');
  client.request = async (endpoint, body, method) => {
    calls.push({ endpoint, body, method });
    return { id: 'u1', username: 'me', permissions: ['listread', 'listwrite'] };
  };

  const info = await client.getAuthInfo();
  assert.deepEqual(calls[0], { endpoint: '/authinfo', body: null, method: 'GET' });
  assert.equal(info.id, 'u1');
  assert.equal(info.username, 'me');
  assert.deepEqual(info.permissions, ['listread', 'listwrite']);
});

test('getAuthInfo：无 listread 权限抛明确错误', async () => {
  const client = new VNDBClient('token');
  client.request = async () => ({ id: 'u1', username: 'me', permissions: [] });
  await assert.rejects(() => client.getAuthInfo(), /listread/);
});

test('getAuthInfo：无 id（token 无效）抛错', async () => {
  const client = new VNDBClient('token');
  client.request = async () => ({});
  await assert.rejects(() => client.getAuthInfo(), /用户信息/);
});

test('fetchUList：POST /ulist，body 带 user/page/results/sort，返回 results+more', async () => {
  const calls = [];
  const client = new VNDBClient('token');
  client.request = async (endpoint, body, method) => {
    calls.push({ endpoint, body, method });
    return { results: [{ id: 'v1' }], more: true };
  };

  const res = await client.fetchUList('u1', { page: 2, results: 50 });
  assert.equal(calls[0].endpoint, '/ulist');
  // fetchUList 不显式传 method，走 request 默认 POST
  assert.equal(calls[0].method ?? 'POST', 'POST');
  assert.equal(calls[0].body.user, 'u1');
  assert.equal(calls[0].body.page, 2);
  assert.equal(calls[0].body.results, 50);
  assert.equal(calls[0].body.sort, 'id');
  assert.ok(calls[0].body.fields.includes('vote'));
  assert.ok(calls[0].body.fields.includes('labels.id'));
  assert.ok(calls[0].body.fields.includes('vn.title'));
  assert.deepEqual(res, { results: [{ id: 'v1' }], more: true });
});

// ============ request GET vs POST ============

test('request：GET 不带 body，POST 带 body', async () => {
  const fetchCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return { ok: true, json: async () => ({}) };
  };

  try {
    const client = new VNDBClient('token');
    await client.request('/authinfo', null, 'GET');
    assert.equal(fetchCalls[0].options.method, 'GET');
    assert.equal(fetchCalls[0].options.body, undefined);

    await client.request('/vn', { filters: [] });
    assert.equal(fetchCalls[1].options.method, 'POST');
    assert.ok(fetchCalls[1].options.body.includes('filters'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
