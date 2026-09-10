import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeVndbIntoListItem } from '../../public/js/vn-list-item.js';

/**
 * mergeVndbIntoListItem 契约测试：
 * 字段口径镜像 src/repository.js rowToListItem（跨端同值约定，见模块头注）。
 */

function baseItem() {
  return {
    id: 'v17',
    title: 'Old Title',
    titleJa: 'Old Ja',
    titleCn: 'Old Cn',
    image: 'https://old/img.jpg',
    imageNsfw: false,
    rating: 7.1,
    personalRating: 9.5,
    playTimeMinutes: 3630,
    developers: ['OldDev'],
    allAge: false,
    tierId: 'tier-a',
    tierSort: 3,
    status: 'finished',
    createdAt: '2024-01-01T00:00:00.000Z'
  };
}

function baseEntry(overrides = {}) {
  return {
    id: 'v17',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2025-06-01T00:00:00.000Z',
    vndb: {
      title: 'CLANNAD',
      titleJa: 'クラナド',
      titleCn: '智代',
      image: 'https://new/img.jpg',
      imageNsfw: true,
      rating: 8.5,
      developers: ['Key'],
      allAge: true,
      ...(overrides.vndb || {})
    },
    user: {
      titleCn: '',
      personalRating: 1, // 故意与 item 不同：合并不得取 entry.user 的用户字段
      status: 'playing',
      tierId: null,
      ...(overrides.user || {})
    }
  };
}

// ============ 1. VNDB 派生字段覆盖 ============

test('VNDB 派生字段全部取自 entry.vndb', () => {
  const out = mergeVndbIntoListItem(baseItem(), baseEntry());

  assert.equal(out.title, 'CLANNAD');
  assert.equal(out.titleJa, 'クラナド');
  assert.equal(out.titleCn, '智代');
  assert.equal(out.image, 'https://new/img.jpg');
  assert.equal(out.imageNsfw, true);
  assert.equal(out.rating, 8.5);
  assert.deepEqual(out.developers, ['Key']);
  assert.equal(out.allAge, true);
});

// ============ 2. 用户 / 行元数据字段保持 ============

test('用户与行元数据字段保持列表项原值（不受 entry.user 影响）', () => {
  const item = baseItem();
  const out = mergeVndbIntoListItem(item, baseEntry());

  assert.equal(out.id, 'v17');
  assert.equal(out.personalRating, 9.5);
  assert.equal(out.playTimeMinutes, 3630);
  assert.equal(out.tierId, 'tier-a');
  assert.equal(out.tierSort, 3);
  assert.equal(out.status, 'finished');
  assert.equal(out.createdAt, '2024-01-01T00:00:00.000Z');
});

// ============ 3. titleCn 回退链 ============

test('titleCn：user.titleCn 优先于 vndb.titleCn', () => {
  const out = mergeVndbIntoListItem(baseItem(), baseEntry({ user: { titleCn: '自定义' } }));
  assert.equal(out.titleCn, '自定义');
});

test('titleCn：user 为空时回退 vndb.titleCn，两者皆空时为空串', () => {
  assert.equal(
    mergeVndbIntoListItem(baseItem(), baseEntry({ user: { titleCn: '' } })).titleCn,
    '智代'
  );
  assert.equal(
    mergeVndbIntoListItem(baseItem(), baseEntry({ user: { titleCn: '' }, vndb: { titleCn: '' } })).titleCn,
    ''
  );
});

// ============ 4. titleJa 回退 ============

test('titleJa 缺失时回退 vndb.title；title 也缺失时为空串', () => {
  assert.equal(
    mergeVndbIntoListItem(baseItem(), baseEntry({ vndb: { titleJa: '' } })).titleJa,
    'CLANNAD'
  );
  assert.equal(
    mergeVndbIntoListItem(baseItem(), baseEntry({ vndb: { titleJa: undefined, title: undefined } })).titleJa,
    ''
  );
});

// ============ 5. 防御性归一 ============

test('rating 非有限 / 负数归 0；developers 非数组归 []', () => {
  assert.equal(mergeVndbIntoListItem(baseItem(), baseEntry({ vndb: { rating: NaN } })).rating, 0);
  assert.equal(mergeVndbIntoListItem(baseItem(), baseEntry({ vndb: { rating: -1 } })).rating, 0);
  assert.equal(mergeVndbIntoListItem(baseItem(), baseEntry({ vndb: { rating: null } })).rating, 0);
  assert.equal(mergeVndbIntoListItem(baseItem(), baseEntry({ vndb: { rating: '8.2' } })).rating, 8.2);
  assert.deepEqual(mergeVndbIntoListItem(baseItem(), baseEntry({ vndb: { developers: 'Key' } })).developers, []);
  assert.deepEqual(mergeVndbIntoListItem(baseItem(), baseEntry({ vndb: { developers: undefined } })).developers, []);
});

test('entry 缺少 vndb / user 时不抛错，VNDB 字段落到空值', () => {
  const out = mergeVndbIntoListItem(baseItem(), { id: 'v17' });
  assert.equal(out.title, '');
  assert.equal(out.titleJa, '');
  assert.equal(out.titleCn, '');
  assert.equal(out.image, '');
  assert.equal(out.imageNsfw, false);
  assert.equal(out.rating, 0);
  assert.deepEqual(out.developers, []);
  assert.equal(out.allAge, false);
  assert.equal(out.personalRating, 9.5, '用户字段仍保留');
});

// ============ 6. 不可变 ============

test('不修改入参，返回新对象', () => {
  const item = Object.freeze(baseItem());
  const entry = baseEntry();
  const snapshot = JSON.parse(JSON.stringify(entry));

  const out = mergeVndbIntoListItem(item, entry);

  assert.notEqual(out, item);
  assert.equal(item.title, 'Old Title');
  assert.deepEqual(entry, snapshot);
});
