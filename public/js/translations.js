/**
 * VN Shelf 翻译模块
 * 负责 tags 翻译数据的加载、缓存和翻译功能
 * 
 * 加载策略：缓存优先 + 后台更新
 * 1. 有缓存时立即返回缓存（用户无感知）
 * 2. 后台检查 version.json 是否有更新
 * 3. 有更新时自动下载并更新缓存
 */

const TRANSLATIONS_DB_NAME = 'vn-shelf-translations';
const TRANSLATIONS_STORE = 'translations';
const TRANSLATIONS_KEY = 'tagTranslations';

// 默认翻译文件 URL（可被用户配置覆盖）
const DEFAULT_TRANSLATION_URL = 'https://illusionlie.github.io/vndb-tags-cn/tags_cn.json';
// 版本文件 URL（用于轻量级版本检查）
const DEFAULT_VERSION_URL = 'https://illusionlie.github.io/vndb-tags-cn/version.json';

/**
 * 打开 IndexedDB 数据库
 * @returns {Promise<IDBDatabase>}
 */
function openTranslationsDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(TRANSLATIONS_DB_NAME, 1);
    
    request.onerror = () => {
      console.error('[Translations] Failed to open IndexedDB:', request.error);
      reject(request.error);
    };
    
    request.onsuccess = () => {
      resolve(request.result);
    };
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(TRANSLATIONS_STORE)) {
        db.createObjectStore(TRANSLATIONS_STORE, { keyPath: 'key' });
      }
    };
  });
}

/**
 * 从 IndexedDB 获取缓存的翻译数据
 * @returns {Promise<Object|null>}
 */
async function getFromIndexedDB() {
  try {
    const db = await openTranslationsDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TRANSLATIONS_STORE, 'readonly');
      const store = transaction.objectStore(TRANSLATIONS_STORE);
      const request = store.get(TRANSLATIONS_KEY);
      
      request.onerror = () => {
        console.error('[Translations] Failed to read from IndexedDB:', request.error);
        reject(request.error);
      };
      
      request.onsuccess = () => {
        resolve(request.result?.value || null);
      };
      
      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error('[Translations] Error accessing IndexedDB:', error);
    return null;
  }
}

/**
 * 保存翻译数据到 IndexedDB
 * @param {Object} data - 翻译数据
 * @returns {Promise<boolean>}
 */
async function saveToIndexedDB(data) {
  try {
    const db = await openTranslationsDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TRANSLATIONS_STORE, 'readwrite');
      const store = transaction.objectStore(TRANSLATIONS_STORE);
      const request = store.put({
        key: TRANSLATIONS_KEY,
        value: data
      });
      
      request.onerror = () => {
        console.error('[Translations] Failed to save to IndexedDB:', request.error);
        reject(request.error);
      };
      
      request.onsuccess = () => {
        resolve(true);
      };
      
      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error('[Translations] Error saving to IndexedDB:', error);
    return false;
  }
}

/**
 * 清除 IndexedDB 中的翻译缓存
 * @returns {Promise<boolean>}
 */
async function clearTranslationsCache() {
  try {
    const db = await openTranslationsDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TRANSLATIONS_STORE, 'readwrite');
      const store = transaction.objectStore(TRANSLATIONS_STORE);
      const request = store.delete(TRANSLATIONS_KEY);
      
      request.onerror = () => {
        console.error('[Translations] Failed to clear IndexedDB:', request.error);
        reject(request.error);
      };
      
      request.onsuccess = () => {
        resolve(true);
      };
      
      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error('[Translations] Error clearing IndexedDB:', error);
    return false;
  }
}

/**
 * 获取远程翻译数据的版本信息
 * 通过请求轻量的 version.json 文件
 *
 * @param {string} versionUrl - 版本文件 URL
 * @returns {Promise<Object|null>} - { version, updatedAt } 或 null
 */
async function fetchRemoteVersion(versionUrl) {
  try {
    const response = await fetch(versionUrl, { cache: 'no-store' }); // 禁用缓存，确保获取最新版本
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    return {
      version: data.version || 'unknown',
      updatedAt: data.updatedAt || new Date().toISOString()
    };
  } catch (error) {
    console.error('[Translations] Failed to fetch remote version:', error);
    return null;
  }
}

/**
 * 从翻译文件 URL 推导版本文件 URL
 * 例如: https://example.com/tags_cn.json -> https://example.com/version.json
 * @param {string} translationUrl - 翻译文件 URL
 * @returns {string} - 版本文件 URL
 */
function deriveVersionUrl(translationUrl) {
  try {
    const url = new URL(translationUrl);
    // 获取目录路径，然后拼接 version.json
    const pathParts = url.pathname.split('/');
    pathParts[pathParts.length - 1] = 'version.json';
    url.pathname = pathParts.join('/');
    return url.toString();
  } catch {
    // URL 解析失败，返回默认版本 URL
    return DEFAULT_VERSION_URL;
  }
}

/**
 * 下载并缓存翻译数据
 * @param {string} url - 翻译文件 URL
 * @returns {Promise<Object|null>} - 翻译映射对象
 */
async function downloadAndCacheTranslations(url) {
  console.log('[Translations] Downloading translations from:', url);
  
  try {
    const response = await fetch(url, { cache: 'no-store' });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // 验证数据格式
    if (!data.translations || typeof data.translations !== 'object') {
      throw new Error('Invalid translation data format: missing translations object');
    }
    
    // 存入 IndexedDB
    const cacheData = {
      version: data.version || 'unknown',
      updatedAt: data.updatedAt || new Date().toISOString(),
      translations: data.translations,
      sourceUrl: url
    };
    
    await saveToIndexedDB(cacheData);
    console.log('[Translations] Cached translations successfully, version:', cacheData.version);
    
    return data.translations;
  } catch (error) {
    console.error('[Translations] Failed to download translations:', error);
    return null;
  }
}

/**
 * 初始化翻译数据
 * 实现缓存优先 + 后台更新策略：
 * 1. 无缓存 → 直接下载完整数据
 * 2. 有缓存 → 立即返回缓存，后台检查版本并更新
 *
 * @param {string} url - 翻译文件 URL
 * @param {string|null} currentVersion - 已废弃，保留参数兼容性
 * @param {boolean} forceRefresh - 是否强制刷新
 * @returns {Promise<Object|null>} - 翻译映射对象
 */
async function initTranslations(url, currentVersion = null, forceRefresh = false) {
  const translationUrl = url || DEFAULT_TRANSLATION_URL;
  
  // 强制刷新：直接下载
  if (forceRefresh) {
    const translations = await downloadAndCacheTranslations(translationUrl);
    if (translations) {
      return translations;
    }
    // 下载失败，尝试使用缓存
    const cached = await getFromIndexedDB();
    return cached?.translations || null;
  }
  
  // 检查 IndexedDB 缓存
  const cached = await getFromIndexedDB();
  
  // 无缓存：直接下载
  if (!cached) {
    console.log('[Translations] No cache found, downloading...');
    const translations = await downloadAndCacheTranslations(translationUrl);
    return translations;
  }
  
  // 缓存的 URL 不匹配：直接下载
  if (cached.sourceUrl !== translationUrl) {
    console.log('[Translations] URL changed, downloading new translations...');
    const translations = await downloadAndCacheTranslations(translationUrl);
    return translations;
  }
  
  // 有缓存：立即返回缓存，后台检查更新
  console.log('[Translations] Using cached version:', cached.version);
  
  // 后台检查版本更新（不阻塞返回）
  checkForUpdatesInBackground(translationUrl, cached.version);
  
  return cached.translations;
}

/**
 * 后台检查翻译更新
 * 如果有新版本，自动下载并更新缓存
 * 
 * @param {string} translationUrl - 翻译文件 URL
 * @param {string} currentVersion - 当前缓存版本
 */
async function checkForUpdatesInBackground(translationUrl, currentVersion) {
  const versionUrl = deriveVersionUrl(translationUrl);
  
  try {
    console.log('[Translations] Background check: fetching version.json...');
    const remoteVersion = await fetchRemoteVersion(versionUrl);
    
    if (!remoteVersion) {
      console.log('[Translations] Background check: cannot fetch version');
      return;
    }
    
    // 比较版本
    if (remoteVersion.version === currentVersion) {
      console.log('[Translations] Background check: version up-to-date');
      return;
    }
    
    // 版本不同，下载新数据
    console.log('[Translations] Background check: new version available:', currentVersion, '→', remoteVersion.version);
    const translations = await downloadAndCacheTranslations(translationUrl);
    
    if (translations) {
      console.log('[Translations] Background check: cache updated successfully');
      // 触发自定义事件，通知应用翻译已更新
      window.dispatchEvent(new CustomEvent('translations-updated', { 
        detail: { version: remoteVersion.version } 
      }));
    }
  } catch (error) {
    console.error('[Translations] Background check failed:', error);
  }
}

/**
 * 翻译单个 tag
 * @param {string} tag - 原始 tag
 * @param {Object} translations - 翻译映射
 * @returns {string} - 翻译后的 tag（如果没有翻译则返回原文）
 */
function translateTag(tag, translations) {
  if (!tag || !translations) return tag;
  return translations[tag] || tag;
}

/**
 * 翻译 tags 数组
 * @param {string[]} tags - 原始 tags 数组
 * @param {Object} translations - 翻译映射
 * @returns {string[]} - 翻译后的 tags 数组
 */
function translateTags(tags, translations) {
  if (!tags || !Array.isArray(tags) || !translations) {
    return tags || [];
  }
  return tags.map(tag => translateTag(tag, translations));
}

/**
 * 获取翻译缓存状态
 * @returns {Promise<Object|null>}
 */
async function getTranslationsCacheStatus() {
  const cached = await getFromIndexedDB();
  if (!cached) return null;
  
  return {
    version: cached.version,
    updatedAt: cached.updatedAt,
    sourceUrl: cached.sourceUrl,
    count: cached.translations ? Object.keys(cached.translations).length : 0
  };
}

// 导出模块
export {
  DEFAULT_TRANSLATION_URL,
  initTranslations,
  translateTag,
  translateTags,
  getFromIndexedDB,
  saveToIndexedDB,
  clearTranslationsCache,
  getTranslationsCacheStatus
};
