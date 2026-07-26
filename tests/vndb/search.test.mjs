import { test } from 'node:test';
import assert from 'node:assert/strict';

import { VNDBClient } from '../../src/vndb.js';

// ============ searchVN：请求体 ============

function createRecordingClient(results = []) {
  const calls = [];
  const client = new VNDBClient('token');
  client.request = async (endpoint, body, method) => {
    calls.push({ endpoint, body, method });
    return { results };
  };
  return { client, calls };
}

test('searchVN：POST /vn，body 含 search filter + sort searchrank + 新字段集 + results=limit', async () => {
  const { client, calls } = createRecordingClient();

  await client.searchVN('命运石之门', 15);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, '/vn');
  // searchVN 不显式传 method，走 request 默认 POST
  assert.equal(calls[0].method ?? 'POST', 'POST');
  assert.deepEqual(calls[0].body.filters, ['search', '=', '命运石之门']);
  assert.equal(calls[0].body.sort, 'searchrank');
  assert.equal(calls[0].body.results, 15);

  const fields = calls[0].body.fields.split(', ');
  assert.deepEqual(fields.sort(), [
    'alttitle',
    'developers.name',
    'id',
    'image.sexual',
    'image.url',
    'image.violence',
    'rating',
    'released',
    'title'
  ]);
});

test('searchVN：limit 缺省为 10', async () => {
  const { client, calls } = createRecordingClient();

  await client.searchVN('clannad');

  assert.equal(calls[0].body.results, 10);
});

// ============ searchVN：结果映射 ============

test('searchVN：完整字段映射（含 released / imageNsfw / rating 0-100→0-10）', async () => {
  const { client } = createRecordingClient([
    {
      id: 'v17',
      title: 'Ever17',
      alttitle: 'エバーセブンティーン',
      released: '2002-08-29',
      image: { url: 'https://img/x.jpg', sexual: 0, violence: 0 },
      rating: 85,
      developers: [{ name: 'KID' }]
    }
  ]);

  const results = await client.searchVN('ever17');

  assert.deepEqual(results, [
    {
      id: 'v17',
      title: 'Ever17',
      original: 'エバーセブンティーン',
      released: '2002-08-29',
      image: 'https://img/x.jpg',
      imageNsfw: false,
      rating: 8.5,
      developers: ['KID']
    }
  ]);
});

test('searchVN：缺省字段兜底（released/alttitle/image 空串、rating 0、developers 空数组）', async () => {
  const { client } = createRecordingClient([{ id: 'v1', title: 'Bare VN' }]);

  const results = await client.searchVN('bare');

  assert.deepEqual(results, [
    {
      id: 'v1',
      title: 'Bare VN',
      original: '',
      released: '',
      image: '',
      imageNsfw: false,
      rating: 0,
      developers: []
    }
  ]);
});

test('searchVN：imageNsfw 边界与 mapVnObjectToVndbData 同口径（sexual>1 或 violence>1）', async () => {
  const { client } = createRecordingClient([
    { id: 'v1', title: 'a', image: { url: 'u', sexual: 2, violence: 0 } },
    { id: 'v2', title: 'b', image: { url: 'u', sexual: 0, violence: 2 } },
    { id: 'v3', title: 'c', image: { url: 'u', sexual: 1, violence: 1 } }
  ]);

  const results = await client.searchVN('nsfw');

  assert.equal(results[0].imageNsfw, true, 'sexual>1 → NSFW');
  assert.equal(results[1].imageNsfw, true, 'violence>1 → NSFW');
  assert.equal(results[2].imageNsfw, false, 'sexual/violence 均 ≤1 → 非 NSFW');
});

test('searchVN：空结果与 results 缺失均返回空数组', async () => {
  const empty = createRecordingClient([]);
  assert.deepEqual(await empty.client.searchVN('nothing'), []);

  const missing = new VNDBClient('token');
  missing.request = async () => ({});
  assert.deepEqual(await missing.searchVN('nothing'), []);
});
