/**
 * VN Shelf 翻译模块
 * 负责 tags 翻译数据的加载、缓存和翻译功能
 */

const TRANSLATIONS_DB_NAME = 'vn-shelf-translations';
const TRANSLATIONS_STORE = 'translations';
const TRANSLATIONS_KEY = 'tagTranslations';

// 默认翻译文件 URL（可被用户配置覆盖）
const DEFAULT_TRANSLATION_URL = 'https://illusionlie.github.io/vndb-tags-cn/tags_cn.json';

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
 * 初始化翻译数据
 * 支持版本检查，如果缓存存在且版本匹配则使用缓存
 * 
 * @param {string} url - 翻译文件 URL
 * @param {string|null} currentVersion - 当前期望的版本号（可选）
 * @param {boolean} forceRefresh - 是否强制刷新
 * @returns {Promise<Object|null>} - 翻译映射对象
 */
async function initTranslations(url, currentVersion = null, forceRefresh = false) {
  const translationUrl = url || DEFAULT_TRANSLATION_URL;
  
  // 如果不是强制刷新，检查 IndexedDB 缓存
  if (!forceRefresh) {
    const cached = await getFromIndexedDB();
    
    if (cached && cached.sourceUrl === translationUrl) {
      // 如果有版本信息且版本相同，直接使用缓存
      if (currentVersion && cached.version === currentVersion) {
        console.log('[Translations] Using cached translations (version match):', cached.version);
        return cached.translations;
      }
      // 如果没有指定版本或缓存没有版本信息，使用缓存
      if (!currentVersion || !cached.version) {
        console.log('[Translations] Using cached translations (no version check):', cached.version || 'unknown');
        return cached.translations;
      }
    }
  }
  
  // 下载翻译数据
  console.log('[Translations] Downloading translations from:', translationUrl);
  
  try {
    const response = await fetch(translationUrl);
    
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
      sourceUrl: translationUrl
    };
    
    await saveToIndexedDB(cacheData);
    console.log('[Translations] Cached translations successfully, version:', cacheData.version);
    
    return data.translations;
  } catch (error) {
    console.error('[Translations] Failed to load translations:', error);
    
    // 如果下载失败但有缓存，尝试使用缓存
    const cached = await getFromIndexedDB();
    if (cached) {
      console.log('[Translations] Falling back to cached translations');
      return cached.translations;
    }
    
    return null;
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
