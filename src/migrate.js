/**
 * KV → D1 一次性数据迁移
 */

import { initDB } from './db.js';
import { buildSaveVNEntryStatement, saveIndexStatus, saveSettings, saveTierList } from './repository.js';

const MIGRATION_MARKER_KEY = 'migrated_from_kv';
const MIGRATION_ENTRY_BATCH_SIZE = 50;
const MIGRATION_INDEX_ITEM_BATCH_SIZE = 50;

function assertNoMigrationErrors(errors, results) {
  if (errors.length === 0) {
    return;
  }

  const summary = [
    `settings=${results.settings ? 1 : 0}`,
    `tiers=${results.tiers}`,
    `entries=${results.entries}`,
    `indexStatus=${results.indexStatus ? 1 : 0}`,
    `indexItems=${results.indexItems}`
  ].join(', ');

  throw new Error(`迁移未完成，可修复后重试。已迁移: ${summary}。错误: ${errors.join(' | ')}`);
}

function buildIndexItemStatement(db, { taskId, vndbId, state, retryCount, error }) {
  const now = new Date().toISOString();
  const normalizedState = state === 'failed' ? 'failed' : 'success';
  const normalizedError = normalizedState === 'failed' ? (error || null) : null;
  return db.prepare(`
    INSERT INTO index_task_items (task_id, vndb_id, state, retry_count, error, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id, vndb_id) DO UPDATE SET
      state = excluded.state,
      retry_count = excluded.retry_count,
      error = excluded.error,
      updated_at = excluded.updated_at
  `).bind(taskId, vndbId, normalizedState, retryCount, normalizedError, now);
}

export async function migrateKvToD1(env) {
  await initDB(env.DB);

  if (!env.KV) {
    throw new Error('KV namespace binding is required for migration. Please re-add the KV binding before running migration.');
  }

  const migrated = await env.DB.prepare(
    'SELECT value FROM settings WHERE key = ?'
  ).bind(MIGRATION_MARKER_KEY).first();

  if (migrated) {
    return { alreadyMigrated: true };
  }

  const results = {
    settings: false,
    tiers: 0,
    entries: 0,
    indexStatus: false,
    indexItems: 0,
    errors: []
  };
  const errors = results.errors;

  try {
    const settings = await env.KV.get('config:settings', 'json');
    if (settings) {
      const existingSettings = await env.DB.prepare(
        'SELECT value FROM settings WHERE key = ?'
      ).bind('config:settings').first();
      if (!existingSettings) {
        await saveSettings(env, settings);
      }
      results.settings = true;
    }
  } catch (error) {
    errors.push(`settings: ${error.message}`);
  }

  try {
    const tierList = await env.KV.get('tier:list', 'json');
    if (tierList && typeof tierList === 'object' && !Array.isArray(tierList) && Array.isArray(tierList.tiers)) {
      const existingTiers = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM tiers'
      ).first();
      if (!existingTiers || existingTiers.count === 0) {
        await saveTierList(env, tierList);
      }
      results.tiers = tierList.tiers.length;
    }
  } catch (error) {
    errors.push(`tiers: ${error.message}`);
  }

  try {
    let cursor = undefined;
    let previousCursor = undefined;
    const entryBuffer = [];

    const flushEntries = async () => {
      if (entryBuffer.length === 0) return;
      try {
        await env.DB.batch(
          entryBuffer.map(({ statement }) => statement)
        );
        results.entries += entryBuffer.length;
      } catch (batchError) {
        for (const { name, statement } of entryBuffer) {
          try {
            await statement.run();
            results.entries += 1;
          } catch (singleError) {
            errors.push(`entry ${name}: ${singleError.message}`);
          }
        }
      }
      entryBuffer.length = 0;
    };

    do {
      const page = await env.KV.list({ prefix: 'vn:', cursor });
      for (const keyMeta of page.keys) {
        if (keyMeta.name === 'vn:list') continue;

        try {
          const entry = await env.KV.get(keyMeta.name, 'json');
          if (entry?.id) {
            const { statement } = buildSaveVNEntryStatement(env.DB, entry, { preserveUpdatedAt: true });
            entryBuffer.push({ name: keyMeta.name, statement });
          }
        } catch (entryError) {
          errors.push(`entry ${keyMeta.name}: ${entryError.message}`);
        }

        if (entryBuffer.length >= MIGRATION_ENTRY_BATCH_SIZE) {
          await flushEntries();
        }
      }
      previousCursor = cursor;
      cursor = page.list_complete ? undefined : page.cursor;
      if (cursor && cursor === previousCursor) {
        errors.push('entries: KV list returned duplicate cursor, aborting pagination');
        cursor = undefined;
      }
    } while (cursor);

    await flushEntries();
  } catch (error) {
    errors.push(`entries: ${error.message}`);
  }

  try {
    const indexStatus = await env.KV.get('index:status', 'json');
    if (indexStatus?.taskId) {
      await saveIndexStatus(env, indexStatus);
      results.indexStatus = true;
    }
  } catch (error) {
    errors.push(`indexStatus: ${error.message}`);
  }

  try {
    let cursor = undefined;
    let previousCursor = undefined;
    const indexItemStatements = [];

    const flushIndexItems = async () => {
      if (indexItemStatements.length === 0) return;
      try {
        await env.DB.batch(indexItemStatements);
        results.indexItems += indexItemStatements.length;
      } catch (batchError) {
        for (const stmt of indexItemStatements) {
          try {
            await stmt.run();
            results.indexItems += 1;
          } catch (singleError) {
            errors.push(`index item: ${singleError.message}`);
          }
        }
      }
      indexItemStatements.length = 0;
    };

    do {
      const page = await env.KV.list({ prefix: 'index:item:', cursor });
      for (const keyMeta of page.keys) {
        try {
          const item = await env.KV.get(keyMeta.name, 'json');
          const [, , rawTaskId, rawVndbId] = keyMeta.name.split(':');
          const taskId = item?.taskId || rawTaskId;
          const vndbId = item?.vndbId || rawVndbId;

          if (!taskId || !vndbId) {
            continue;
          }

          indexItemStatements.push(buildIndexItemStatement(env.DB, {
            taskId,
            vndbId,
            state: item?.state,
            retryCount: item?.retryCount || 0,
            error: item?.error || null
          }));
        } catch (itemError) {
          errors.push(`index item ${keyMeta.name}: ${itemError.message}`);
        }

        if (indexItemStatements.length >= MIGRATION_INDEX_ITEM_BATCH_SIZE) {
          await flushIndexItems();
        }
      }
      previousCursor = cursor;
      cursor = page.list_complete ? undefined : page.cursor;
      if (cursor && cursor === previousCursor) {
        errors.push('indexItems: KV list returned duplicate cursor, aborting pagination');
        cursor = undefined;
      }
    } while (cursor);

    await flushIndexItems();
  } catch (error) {
    errors.push(`indexItems: ${error.message}`);
  }

  assertNoMigrationErrors(errors, results);

  await env.DB.prepare(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
  ).bind(MIGRATION_MARKER_KEY, JSON.stringify({ migratedAt: new Date().toISOString() })).run();

  return results;
}
