import { test } from 'node:test';
import assert from 'node:assert/strict';

import zhCN from '../../public/js/locales/zh-CN.js';
import en from '../../public/js/locales/en.js';

/**
 * en 与 zh-CN 词典结构契约测试（B6a）：
 * 词典为纯数据 ESM（无 DOM / vendor 依赖），直接静态 import 断言。
 *
 * 1. 叶子路径集合（`domain.key` 形式）双向相等——任一方向漂移都报缺失/多出清单；
 * 2. 逐 key 的 {placeholder} 名称集合一致——防插值参数漂移；
 * 3. 所有叶子值均为非空 string。
 */

/**
 * 递归收集词典叶子路径与对应值。
 * @param {Object} dict
 * @param {string} [prefix]
 * @param {Map<string, unknown>} [out]
 * @returns {Map<string, unknown>} `domain.key` → 叶子值
 */
function collectLeaves(dict, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(dict)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') {
      collectLeaves(value, path, out);
    } else {
      out.set(path, value);
    }
  }
  return out;
}

/**
 * 提取模板串中的 {placeholder} 名称集合（与 i18n.js interpolate 同一正则形态）。
 * @param {string} template
 * @returns {string[]} 排序后的占位符名称数组
 */
function extractPlaceholders(template) {
  const names = new Set();
  for (const match of String(template).matchAll(/\{(\w+)\}/g)) {
    names.add(match[1]);
  }
  return [...names].sort();
}

const zhLeaves = collectLeaves(zhCN);
const enLeaves = collectLeaves(en);

test('en 与 zh-CN 叶子 key 集合双向相等', () => {
  const enKeySet = new Set(enLeaves.keys());
  const zhKeySet = new Set(zhLeaves.keys());

  const missingInEn = [...zhKeySet].filter((key) => !enKeySet.has(key));
  const extraInEn = [...enKeySet].filter((key) => !zhKeySet.has(key));

  assert.deepEqual(missingInEn, [], `en 缺失 key: ${missingInEn.join(', ')}`);
  assert.deepEqual(extraInEn, [], `en 多出 key: ${extraInEn.join(', ')}`);
});

test('逐 key 的 {placeholder} 名称集合一致', () => {
  for (const [key, zhValue] of zhLeaves) {
    if (!enLeaves.has(key)) continue; // key 集合差异由上一用例负责报告
    assert.deepEqual(
      extractPlaceholders(enLeaves.get(key)),
      extractPlaceholders(zhValue),
      `key "${key}" 的占位符集合 en 与 zh-CN 不一致`
    );
  }
});

test('两词典所有叶子值均为非空 string', () => {
  for (const [name, leaves] of [['zh-CN', zhLeaves], ['en', enLeaves]]) {
    for (const [key, value] of leaves) {
      assert.equal(typeof value, 'string', `${name} 词典 "${key}" 的值不是 string`);
      assert.ok(value.trim().length > 0, `${name} 词典 "${key}" 的值为空字符串`);
    }
  }
});
