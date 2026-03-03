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

function createDefaultSettings(overrides = {}) {
  return {
    vndbApiToken: '',
    adminPasswordHash: '',
    jwtSecret: '',
    lastIndexTime: null,
    tagsMode: 'vndb',
    translateTags: true,
    translationUrl: '',
    ...overrides
  };
}

async function loadRouterModule({ initialSettings = {}, authenticated = true } = {}) {
  const sourceCode = await fs.readFile(sourcePath, 'utf8');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vn-shelf-router-test-'));
  const routerPath = path.join(tempDir, 'router.module.mjs');
  const authStubPath = path.join(tempDir, 'auth.stub.mjs');
  const kvStubPath = path.join(tempDir, 'kv.stub.mjs');
  const utilsStubPath = path.join(tempDir, 'utils.stub.mjs');
  const vndbStubPath = path.join(tempDir, 'vndb.stub.mjs');
  const testId = `${Date.now()}_${Math.random()}`;

  globalThis.__routerConfigTestRegistry = globalThis.__routerConfigTestRegistry || new Map();
  const state = {
    settings: createDefaultSettings(initialSettings),
    authenticated,
    initAdminPasswordCalls: [],
    saveSettingsCalls: []
  };
  globalThis.__routerConfigTestRegistry.set(testId, state);

  const authStubCode = `
const state = globalThis.__routerConfigTestRegistry?.get('${testId}');
const clone = value => JSON.parse(JSON.stringify(value));

export async function authMiddleware() {
  return { authenticated: !!state.authenticated };
}

export async function createJWT() {
  return 'stub.jwt.token';
}

export function setAuthCookie() {}
export function clearAuthCookie() {}
export async function verifyAdminPassword() { return true; }

export async function initAdminPassword(env, password) {
  state.initCounter = (state.initCounter || 0) + 1;
  const next = clone(state.settings);
  next.adminPasswordHash = \`salt-\${state.initCounter}:hash-\${password}\`;
  next.jwtSecret = \`jwt-secret-\${state.initCounter}\`;
  state.settings = next;
  state.initAdminPasswordCalls.push({
    password,
    adminPasswordHash: next.adminPasswordHash,
    jwtSecret: next.jwtSecret
  });
}

export async function isInitialized() {
  return !!(state.settings.adminPasswordHash && state.settings.jwtSecret);
}
`;

  const kvStubCode = `
const state = globalThis.__routerConfigTestRegistry?.get('${testId}');
const clone = value => JSON.parse(JSON.stringify(value));

export async function getSettings() {
  return clone(state.settings);
}

export async function saveSettings(env, settings) {
  state.settings = clone(settings);
  state.saveSettingsCalls.push(clone(settings));
}

export async function getVNList() {
  return {
    items: [],
    stats: {
      total: 0,
      totalPlayTimeMinutes: 0,
      avgRating: 0,
      avgPersonalRating: 0
    },
    updatedAt: null
  };
}

export async function getVNEntry() { return null; }
export async function saveVNEntry() {}
export async function deleteVNEntry() {}
export async function addEntryToList() {}
export async function removeEntryFromList() {}
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
export async function getIndexStatus() { return {}; }
export async function saveIndexStatus() {}
export async function getTierList() { return { tiers: [], updatedAt: null }; }
export async function saveTierList(env, tierList) { return tierList; }
export async function updateVNTier() {}
export async function batchUpdateVNTiers() {}
export async function clearTierAssignments() {}
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
      globalThis.__routerConfigTestRegistry?.delete(testId);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

async function sendUpdateConfigRequest(routerModule, body) {
  const request = new Request('https://example.com/api/config', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const response = await routerModule.handleRequest(request, {});
  const payload = await response.json();

  return { response, payload };
}

test('仅修改密码时会持久化新的 adminPasswordHash 与 jwtSecret', async () => {
  const initialSettings = createDefaultSettings({
    adminPasswordHash: 'salt-old:hash-old',
    jwtSecret: 'jwt-secret-old',
    vndbApiToken: 'token-old'
  });
  const { routerModule, state, cleanup } = await loadRouterModule({ initialSettings });

  try {
    const oldHash = state.settings.adminPasswordHash;
    const oldSecret = state.settings.jwtSecret;

    const { response, payload } = await sendUpdateConfigRequest(routerModule, {
      newPassword: 'new-password-123'
    });

    assert.equal(response.status, 200);
    assert.deepEqual(payload, { success: true, message: '设置已更新', data: null });

    assert.equal(state.initAdminPasswordCalls.length, 1);
    assert.notEqual(state.settings.adminPasswordHash, oldHash);
    assert.notEqual(state.settings.jwtSecret, oldSecret);
    assert.equal(state.settings.adminPasswordHash, state.initAdminPasswordCalls[0].adminPasswordHash);
    assert.equal(state.settings.jwtSecret, state.initAdminPasswordCalls[0].jwtSecret);
  } finally {
    await cleanup();
  }
});

test('同时修改密码与其他配置字段时会正确保留新凭据并更新其他字段', async () => {
  const initialSettings = createDefaultSettings({
    adminPasswordHash: 'salt-old:hash-old',
    jwtSecret: 'jwt-secret-old',
    vndbApiToken: 'token-old',
    tagsMode: 'vndb',
    translateTags: true,
    translationUrl: '',
    lastIndexTime: '2024-01-01T00:00:00.000Z'
  });
  const { routerModule, state, cleanup } = await loadRouterModule({ initialSettings });

  try {
    const oldHash = state.settings.adminPasswordHash;
    const oldSecret = state.settings.jwtSecret;

    const { response, payload } = await sendUpdateConfigRequest(routerModule, {
      newPassword: 'new-password-456',
      vndbApiToken: 'token-new',
      tagsMode: 'manual',
      translateTags: false,
      translationUrl: 'https://example.com/translations.json'
    });

    assert.equal(response.status, 200);
    assert.deepEqual(payload, { success: true, message: '设置已更新', data: null });

    assert.equal(state.initAdminPasswordCalls.length, 1);
    assert.notEqual(state.settings.adminPasswordHash, oldHash);
    assert.notEqual(state.settings.jwtSecret, oldSecret);
    assert.equal(state.settings.adminPasswordHash, state.initAdminPasswordCalls[0].adminPasswordHash);
    assert.equal(state.settings.jwtSecret, state.initAdminPasswordCalls[0].jwtSecret);

    assert.equal(state.settings.vndbApiToken, 'token-new');
    assert.equal(state.settings.tagsMode, 'manual');
    assert.equal(state.settings.translateTags, false);
    assert.equal(state.settings.translationUrl, 'https://example.com/translations.json');
    assert.equal(state.settings.lastIndexTime, '2024-01-01T00:00:00.000Z');
  } finally {
    await cleanup();
  }
});

test('不修改密码时不会重置已有凭据', async () => {
  const initialSettings = createDefaultSettings({
    adminPasswordHash: 'salt-stable:hash-stable',
    jwtSecret: 'jwt-secret-stable',
    vndbApiToken: 'token-old',
    tagsMode: 'vndb',
    translateTags: true,
    translationUrl: ''
  });
  const { routerModule, state, cleanup } = await loadRouterModule({ initialSettings });

  try {
    const oldHash = deepClone(state.settings.adminPasswordHash);
    const oldSecret = deepClone(state.settings.jwtSecret);

    const { response, payload } = await sendUpdateConfigRequest(routerModule, {
      vndbApiToken: 'token-updated',
      tagsMode: 'manual',
      translateTags: false,
      translationUrl: 'https://example.com/tags.json'
    });

    assert.equal(response.status, 200);
    assert.deepEqual(payload, { success: true, message: '设置已更新', data: null });

    assert.equal(state.initAdminPasswordCalls.length, 0);
    assert.equal(state.settings.adminPasswordHash, oldHash);
    assert.equal(state.settings.jwtSecret, oldSecret);

    assert.equal(state.settings.vndbApiToken, 'token-updated');
    assert.equal(state.settings.tagsMode, 'manual');
    assert.equal(state.settings.translateTags, false);
    assert.equal(state.settings.translationUrl, 'https://example.com/tags.json');
  } finally {
    await cleanup();
  }
});
