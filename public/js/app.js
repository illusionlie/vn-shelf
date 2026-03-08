/**
 * VN Shelf 主应用模块
 * 使用Alpine.js进行状态管理
 */

import { authAPI, vnAPI, statsAPI, indexAPI, configAPI, dataAPI, tierAPI } from './api.js';
import { renderMarkdown } from './markdown.js';
import {
  initTranslations,
  translateTags,
  getTranslationsCacheStatus,
  clearTranslationsCache,
  DEFAULT_TRANSLATION_URL
} from './translations.js';

function formatUserPlayTime(user) {
  if (!user) return '未记录';

  const rawHours = Number(user.playTimeHours);
  const rawPartMinutes = Number(user.playTimePartMinutes);
  const hasHours = Number.isFinite(rawHours) && rawHours >= 0;
  const hasPartMinutes = Number.isFinite(rawPartMinutes) && rawPartMinutes >= 0;

  if (!hasHours && !hasPartMinutes) {
    return '未记录';
  }

  const inputHours = hasHours ? Math.floor(rawHours) : 0;
  const inputPartMinutes = hasPartMinutes ? Math.floor(rawPartMinutes) : 0;
  const normalizedTotalMinutes = inputHours * 60 + inputPartMinutes;

  if (normalizedTotalMinutes <= 0) {
    return '未记录';
  }

  const displayHours = Math.floor(normalizedTotalMinutes / 60);
  const displayPartMinutes = normalizedTotalMinutes % 60;

  if (displayHours > 0 && displayPartMinutes > 0) {
    return `${displayHours}小时${displayPartMinutes}分钟`;
  }
  if (displayHours > 0) {
    return `${displayHours}小时`;
  }
  return `${displayPartMinutes}分钟`;
}

let modalOpenCount = 0;

function lockPageScroll() {
  modalOpenCount += 1;
  document.body.classList.add('modal-open');
}

function unlockPageScroll() {
  modalOpenCount = Math.max(0, modalOpenCount - 1);
  if (modalOpenCount === 0) {
    document.body.classList.remove('modal-open');
  }
}

// =========== 进度条 ============

function initProgressBar() {
  const progressBar = document.querySelector('.loading-progress-bar');
  const progressFill = progressBar?.querySelector('.progress-fill');
  if (!progressFill) return;

  let progress = 0;
  const interval = setInterval(() => {
    progress += Math.random() * 15;
    if (progress >= 90) {
      progress = 90;
      clearInterval(interval);
    }
    progressFill.style.width = progress + '%';
  }, 200);

  // 页面加载完成时
  window.addEventListener('load', () => {
    clearInterval(interval);
    if (progressFill) {
      progressFill.style.width = '100%';
      setTimeout(() => {
        if (progressBar) progressBar.classList.add('hidden');
      }, 500);
    }
  });

  // Fallback: 3秒后隐藏
  setTimeout(() => {
    clearInterval(interval);
    if (progressFill) progressFill.style.width = '100%';
    setTimeout(() => {
      if (progressBar) progressBar.classList.add('hidden');
    }, 500);
  }, 3000);
}

// ========== 主题 ===========
function createThemeIcon(isDark) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('class', isDark ? 'dark-icon' : 'light-icon');

  if (isDark) {
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z');
    svg.appendChild(path);
    return svg;
  }

  const circle = document.createElementNS(svgNS, 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '5');
  svg.appendChild(circle);

  const rays = [
    ['12', '1', '12', '3'],
    ['12', '21', '12', '23'],
    ['4.22', '4.22', '5.64', '5.64'],
    ['18.36', '18.36', '19.78', '19.78'],
    ['1', '12', '3', '12'],
    ['21', '12', '23', '12'],
    ['4.22', '19.78', '5.64', '18.36'],
    ['18.36', '5.64', '19.78', '4.22']
  ];

  rays.forEach(([x1, y1, x2, y2]) => {
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    svg.appendChild(line);
  });

  return svg;
}

function updateThemeToggleButtons() {
  const isDark = document.body.classList.contains('dark-mode');
  const themeToggleButtons = document.querySelectorAll('.theme-toggle-btn');

  themeToggleButtons.forEach(button => {
    button.setAttribute('aria-label', isDark ? '切换到亮色主题' : '切换到暗色主题');

    const oldIcon = button.querySelector('svg');
    if (oldIcon) {
      oldIcon.remove();
    }

    button.appendChild(createThemeIcon(isDark));
  });
}

function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    document.body.classList.add('dark-mode');
  }

  updateThemeToggleButtons();
}

function toggleTheme() {
  document.body.classList.toggle('dark-mode');
  const isDark = document.body.classList.contains('dark-mode');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  updateThemeToggleButtons();
}

// Mobile Menu Toggle
function toggleMobileMenu() {
  const menu = document.getElementById('more-menu');
  if (menu) menu.classList.toggle('open');
}

// ============ 全局状态 ============

document.addEventListener('alpine:init', () => {
  // 全局Store
  Alpine.store('app', {
    isAdmin: false,
    isLoading: false,
    toasts: [],
    _initialized: false,
    init() {
      if (this._initialized) return;
      this._initialized = true;
      this.checkAuth();
      initTheme();
      initProgressBar();
    },

    async checkAuth() {
      try {
        const res = await authAPI.verify();
        this.isAdmin = res.success;
      } catch (error) {
        console.warn('[app] auth verify failed', {
          error: error?.message || String(error)
        });
        this.isAdmin = false;
      }
    },

    addToast(message, type = 'success') {
      const id = Date.now();
      this.toasts.push({ id, message, type });
      setTimeout(() => this.removeToast(id), 3000);
    },

    removeToast(id) {
      this.toasts = this.toasts.filter(t => t.id !== id);
    }
  });

  // 注册 Alpine 组件
  Alpine.data('vnShelf', vnShelf);
  Alpine.data('loginPage', loginPage);
  Alpine.data('settingsPage', settingsPage);
  Alpine.data('statsPage', statsPage);
  Alpine.data('tierlistPage', tierlistPage);
});

// ============ 主页组件 ============

function vnShelf() {
  return {
    vnList: [],
    filteredList: [],
    searchQuery: '',
    sortBy: 'created_desc',
    isLoading: true,
    selectedVN: null,
    showDetail: false,
    showEdit: false,
    editForm: {},
    // 翻译相关状态
    config: null,
    translations: null,
    _initialized: false,

    async init() {
      if (this._initialized) return;
      this._initialized = true;
      await this.loadConfig();
      await this.initTranslations();
      await this.loadVNList();
    },

    async loadConfig() {
      try {
        const res = await configAPI.get();
        this.config = res.data || {
          tagsMode: 'vndb',
          translateTags: true,
          translationUrl: ''
        };
      } catch (error) {
        console.warn('[vnShelf] load config fallback to defaults', {
          error: error?.message || String(error)
        });
        // 未登录时使用默认配置
        this.config = {
          tagsMode: 'vndb',
          translateTags: true,
          translationUrl: ''
        };
      }
    },

    async initTranslations() {
      // 只在 vndb 模式且启用翻译时加载翻译数据
      if (this.config.tagsMode === 'vndb' && this.config.translateTags) {
        const url = this.config.translationUrl || DEFAULT_TRANSLATION_URL;
        try {
          this.translations = await initTranslations(url);
        } catch (error) {
          console.error('[vnShelf] Failed to load translations:', error);
          this.translations = null;
        }
      }
    },

    /**
     * 获取要显示的 tags
     * @param {Object} vn - VN 条目
     * @returns {string[]} - 要显示的 tags 数组
     */
    getDisplayTags(vn) {
      if (!vn) return [];

      // 手动模式：优先使用用户 tags
      if (this.config.tagsMode === 'manual') {
        return vn.user?.tags || [];
      }

      // VNDB 模式
      const vndbTags = vn.vndb?.tags || [];

      // 如果启用翻译且有翻译数据，翻译 tags
      if (this.config.translateTags && this.translations) {
        return translateTags(vndbTags, this.translations);
      }

      // 否则返回原始英文 tags
      return vndbTags;
    },

    async loadVNList() {
      this.isLoading = true;
      try {
        const res = await vnAPI.getList({ sort: this.sortBy });
        this.vnList = res.data || [];
        this.filteredList = this.vnList;
      } catch (error) {
        this.$store.app.addToast('加载失败: ' + error.message, 'error');
      } finally {
        this.isLoading = false;
      }
    },

    handleSearch() {
      if (!this.searchQuery) {
        this.filteredList = this.vnList;
        return;
      }

      const query = this.searchQuery.toLowerCase();
      this.filteredList = this.vnList.filter(vn =>
        vn.title.toLowerCase().includes(query) ||
        (vn.titleCn && vn.titleCn.toLowerCase().includes(query))
      );
    },

    handleSortChange() {
      this.loadVNList();
    },

    async openDetail(vn) {
      try {
        const res = await vnAPI.get(vn.id);
        this.selectedVN = res;
        if (!this.showDetail) {
          lockPageScroll();
        }
        this.showDetail = true;
      } catch (error) {
        this.$store.app.addToast('加载详情失败: ' + error.message, 'error');
      }
    },

    closeDetail() {
      if (!this.showDetail) return;
      this.showDetail = false;
      this.selectedVN = null;
      unlockPageScroll();
    },

    openEdit(vn = null) {
      if (vn) {
        // 解析 tags 为文本（用于编辑）
        const userTags = vn.user?.tags || [];
        const playTimeHours = Number.isFinite(Number(vn.user?.playTimeHours)) && Number(vn.user?.playTimeHours) >= 0
          ? Math.floor(Number(vn.user?.playTimeHours))
          : 0;
        const playTimePartMinutes = Number.isFinite(Number(vn.user?.playTimePartMinutes)) && Number(vn.user?.playTimePartMinutes) >= 0
          ? Math.floor(Number(vn.user?.playTimePartMinutes))
          : 0;

        this.editForm = {
          id: vn.id,
          vndbId: vn.id,
          titleCn: vn.user?.titleCn || '',
          personalRating: vn.user?.personalRating || 0,
          playTimeHours,
          playTimePartMinutes,
          review: vn.user?.review || '',
          startDate: vn.user?.startDate || '',
          finishDate: vn.user?.finishDate || '',
          tags: userTags.join(', '), // 逗号分隔的文本
          isNew: false
        };
      } else {
        this.editForm = {
          vndbId: '',
          titleCn: '',
          personalRating: 0,
          playTimeHours: 0,
          playTimePartMinutes: 0,
          review: '',
          startDate: '',
          finishDate: '',
          tags: '',
          isNew: true
        };
      }
      if (!this.showEdit) {
        lockPageScroll();
      }
      this.showEdit = true;

      if (this.showDetail) {
        this.showDetail = false;
        unlockPageScroll();
      }
    },

    closeEdit() {
      if (!this.showEdit) return;
      this.showEdit = false;
      this.editForm = {};
      unlockPageScroll();
    },

    formatUserPlayTime,

    normalizePlayTimeInput() {
      const rawHours = Number(this.editForm.playTimeHours);
      const rawPartMinutes = Number(this.editForm.playTimePartMinutes);

      if (!Number.isFinite(rawHours) || rawHours < 0) {
        throw new Error('游玩时长小时必须是非负数字');
      }
      if (!Number.isFinite(rawPartMinutes) || rawPartMinutes < 0) {
        throw new Error('游玩时长分钟必须是非负数字');
      }

      return {
        playTimeHours: Math.floor(rawHours),
        playTimePartMinutes: Math.floor(rawPartMinutes)
      };
    },

    /**
     * 解析 tags 文本为数组
     * @param {string} tagsText - 逗号分隔的 tags 文本
     * @returns {string[]} - tags 数组
     */
    parseTags(tagsText) {
      if (!tagsText || !tagsText.trim()) return [];
      return tagsText
        .split(/[,，]/) // 支持中英文逗号
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);
    },

    async saveEdit() {
      try {
        // 解析 tags
        const tags = this.parseTags(this.editForm.tags);
        const playTimeData = this.normalizePlayTimeInput();

        if (this.editForm.isNew) {
          await vnAPI.create({
            vndbId: this.editForm.vndbId,
            titleCn: this.editForm.titleCn,
            personalRating: this.editForm.personalRating,
            playTimeHours: playTimeData.playTimeHours,
            playTimePartMinutes: playTimeData.playTimePartMinutes,
            review: this.editForm.review,
            startDate: this.editForm.startDate,
            finishDate: this.editForm.finishDate,
            tags: tags
          });
          this.$store.app.addToast('添加成功');
        } else {
          await vnAPI.update(this.editForm.id, {
            titleCn: this.editForm.titleCn,
            personalRating: this.editForm.personalRating,
            playTimeHours: playTimeData.playTimeHours,
            playTimePartMinutes: playTimeData.playTimePartMinutes,
            review: this.editForm.review,
            startDate: this.editForm.startDate,
            finishDate: this.editForm.finishDate,
            tags: tags
          });
          this.$store.app.addToast('更新成功');
        }
        this.closeEdit();
        await this.loadVNList();
      } catch (error) {
        this.$store.app.addToast('保存失败: ' + error.message, 'error');
      }
    },

    async deleteVN() {
      if (!confirm('确定要删除这个条目吗？')) return;

      try {
        await vnAPI.delete(this.selectedVN.id);
        this.$store.app.addToast('删除成功');
        this.closeDetail();
        await this.loadVNList();
      } catch (error) {
        this.$store.app.addToast('删除失败: ' + error.message, 'error');
      }
    },

    renderMarkdown
  };
}

// ============ 登录页组件 ============

function loginPage() {
  return {
    isInitialized: null,
    password: '',
    vndbApiToken: '',
    error: '',
    isLoading: false,
    _initialized: false,

    async init() {
      if (this._initialized) return;
      this._initialized = true;
      try {
        // 这里只检查初始化
        // 因为全局会 checkAuth
        const status = await authAPI.status();
        if (status.authenticated) {
          window.location.href = '/';
          return;
        }
        this.isInitialized = status.initialized;
      } catch (error) {
        this.isInitialized = false;
      }
    },

    async handleSubmit() {
      if (!this.password) {
        this.error = '请输入密码';
        return;
      }

      this.isLoading = true;
      this.error = '';

      try {
        if (!this.isInitialized) {
          // 初始化
          await authAPI.init(this.password, this.vndbApiToken);
        }

        // 登录
        await authAPI.login(this.password);
        window.location.href = '/';
      } catch (error) {
        this.error = error.message;
      } finally {
        this.isLoading = false;
      }
    }
  };
}

// ============ 设置页组件 ============

function settingsPage() {
  return {
    config: {
      tagsMode: 'vndb',
      translateTags: true,
      translationUrl: ''
    },
    vndbApiToken: '',
    newPassword: '',
    confirmPassword: '',
    indexStatus: null,
    translationCacheStatus: null,
    isLoading: false,
    _initialized: false,

    async init() {
      if (this._initialized) return;
      this._initialized = true;
      try {
        const status = await authAPI.status();
        if (!status.authenticated) {
          window.location.href = '/login';
          return;
        }
      } catch (error) {
        console.warn('[settings] auth status failed', {
          error: error?.message || String(error)
        });
        window.location.href = '/login';
        return;
      }
      await this.loadConfig();
      await this.loadIndexStatus();
      await this.loadTranslationCacheStatus();
    },

    async loadConfig() {
      try {
        const res = await configAPI.get();
        this.config = res.data || {
          tagsMode: 'vndb',
          translateTags: true,
          translationUrl: ''
        };
      } catch (error) {
        this.$store.app.addToast('加载配置失败: ' + error.message, 'error');
      }
    },

    async loadIndexStatus() {
      try {
        this.indexStatus = await indexAPI.getStatus();
      } catch (error) {
        console.warn('[settings] load index status failed', {
          error: error?.message || String(error)
        });
        this.indexStatus = null;
      }
    },

    async saveVndbToken() {
      if (!this.vndbApiToken) return;

      this.isLoading = true;
      try {
        await configAPI.update({ vndbApiToken: this.vndbApiToken });
        this.vndbApiToken = '';
        this.$store.app.addToast('VNDB API Token已保存');
        await this.loadConfig();
      } catch (error) {
        this.$store.app.addToast('保存失败: ' + error.message, 'error');
      } finally {
        this.isLoading = false;
      }
    },

    async changePassword() {
      if (!this.newPassword || this.newPassword.length < 6) {
        this.$store.app.addToast('密码长度至少6位', 'error');
        return;
      }

      if (this.newPassword !== this.confirmPassword) {
        this.$store.app.addToast('两次输入的密码不一致', 'error');
        return;
      }

      this.isLoading = true;
      try {
        await configAPI.update({ newPassword: this.newPassword });
        this.newPassword = '';
        this.confirmPassword = '';
        this.$store.app.addToast('密码已更新');
      } catch (error) {
        this.$store.app.addToast('更新失败: ' + error.message, 'error');
      } finally {
        this.isLoading = false;
      }
    },

    async startIndex() {
      this.isLoading = true;
      try {
        const res = await indexAPI.start();
        this.$store.app.addToast(`索引已启动，共${res.data.total}个条目`);
        await this.loadIndexStatus();
      } catch (error) {
        this.$store.app.addToast('启动索引失败: ' + error.message, 'error');
      } finally {
        this.isLoading = false;
      }
    },

    async exportData() {
      try {
        const data = await dataAPI.export();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vn-shelf-export-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.$store.app.addToast('导出成功');
      } catch (error) {
        this.$store.app.addToast('导出失败: ' + error.message, 'error');
      }
    },

    async importData(event) {
      const file = event.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data.entries || !Array.isArray(data.entries)) {
          throw new Error('无效的导入文件格式');
        }

        const mode = confirm('选择导入模式：\n确定 = 合并（保留现有数据）\n取消 = 替换（清空现有数据）') ? 'merge' : 'replace';

        await dataAPI.import(data, mode);
        this.$store.app.addToast(`导入成功，共${data.entries.length}个条目`);
      } catch (error) {
        this.$store.app.addToast('导入失败: ' + error.message, 'error');
      }

      // 清空文件输入
      event.target.value = '';
    },

    async logout() {
      try {
        await authAPI.logout();
        window.location.href = '/login';
      } catch (error) {
        this.$store.app.addToast('退出失败: ' + error.message, 'error');
      }
    },

    formatStatus(status) {
      const map = {
        idle: '空闲',
        running: '运行中',
        completed: '已完成',
        failed: '失败',
        partial: '部分完成'
      };
      return map[status] || status;
    },

    formatDate(dateStr) {
      if (!dateStr) return '未知';
      const date = new Date(dateStr);
      if (Number.isNaN(date.getTime())) {
        console.warn('[settings] formatDate received invalid date', { dateStr });
        return dateStr;
      }

      return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
    },

    async loadTranslationCacheStatus() {
      try {
        this.translationCacheStatus = await getTranslationsCacheStatus();
      } catch (error) {
        console.warn('[settings] load translation cache status failed', {
          error: error?.message || String(error)
        });
        this.translationCacheStatus = null;
      }
    },

    async saveTagsConfig() {
      this.isLoading = true;
      try {
        await configAPI.update({
          tagsMode: this.config.tagsMode,
          translateTags: this.config.translateTags,
          translationUrl: this.config.translationUrl
        });
        this.$store.app.addToast('Tags 设置已保存');

        // 如果启用了翻译，预加载翻译数据
        if (this.config.tagsMode === 'vndb' && this.config.translateTags) {
          const url = this.config.translationUrl || DEFAULT_TRANSLATION_URL;
          await initTranslations(url, false);
          await this.loadTranslationCacheStatus();
        }
      } catch (error) {
        this.$store.app.addToast('保存失败: ' + error.message, 'error');
      } finally {
        this.isLoading = false;
      }
    },

    async clearTranslationCache() {
      if (!confirm('确定要清除翻译缓存吗？下次使用时需要重新下载翻译数据。')) return;

      try {
        await clearTranslationsCache();
        this.translationCacheStatus = null;
        this.$store.app.addToast('翻译缓存已清除');
      } catch (error) {
        this.$store.app.addToast('清除缓存失败: ' + error.message, 'error');
      }
    }
  };
}

// ============ Tier List页组件 ============

function tierlistPage() {
  return {
    tiers: [],
    allVN: [],
    tieredVN: {},
    untieredVN: [],
    isLoading: true,

    // 翻译相关状态
    config: {
      tagsMode: 'vndb',
      translateTags: true,
      translationUrl: ''
    },
    translations: null,

    selectedVN: null,
    showDetail: false,

    showTierEdit: false,
    editingTier: null,
    tierForm: {
      name: '',
      color: '#ff4757'
    },
    isSavingTier: false,

    draggedVN: null,
    dragOverTierId: null,
    dropIndicatorTierKey: null,
    dropIndicatorIndex: null,

    MAX_BATCH_TIER_UPDATES: 200,
    _initialized: false,

    getErrorMessage(error) {
      return error?.message || '未知错误';
    },

    async loadConfig() {
      try {
        const res = await configAPI.get();
        this.config = res.data || {
          tagsMode: 'vndb',
          translateTags: true,
          translationUrl: ''
        };
      } catch (error) {
        console.warn('[tierlistPage] load config fallback to defaults', {
          error: error?.message || String(error)
        });
        this.config = {
          tagsMode: 'vndb',
          translateTags: true,
          translationUrl: ''
        };
      }
    },

    async initTranslations() {
      if (this.config.tagsMode === 'vndb' && this.config.translateTags) {
        const url = this.config.translationUrl || DEFAULT_TRANSLATION_URL;
        try {
          this.translations = await initTranslations(url);
        } catch (error) {
          console.error('[tierlistPage] Failed to load translations:', error);
          this.translations = null;
        }
      }
    },

    async init() {
      if (this._initialized) return;
      this._initialized = true;
      this.isLoading = true;
      try {
        await this.loadConfig();
        await this.initTranslations();

        const [tierLoaded, vnLoaded] = await Promise.all([
          this.loadTiers({ silent: true }),
          this.loadVNList({ silent: true })
        ]);

        if (!tierLoaded || !vnLoaded) {
          this.$store.app.addToast('加载 Tier 页面数据失败，请稍后重试', 'error');
        }
      } finally {
        this.isLoading = false;
      }
    },

    async loadTiers({ silent = false } = {}) {
      try {
        const res = await tierAPI.getList();
        this.tiers = Array.isArray(res.data)
          ? [...res.data].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          : [];
        this.normalizeTierSortForAllVN();
        this.rebuildTierGroups();
        return true;
      } catch (error) {
        this.tiers = [];
        this.rebuildTierGroups();
        if (!silent) {
          this.$store.app.addToast('加载 Tier 列表失败: ' + this.getErrorMessage(error), 'error');
        }
        return false;
      }
    },

    async loadVNList({ silent = false } = {}) {
      try {
        const res = await vnAPI.getList();
        this.allVN = Array.isArray(res.data) ? res.data : [];
        this.normalizeTierSortForAllVN();
        this.rebuildTierGroups();
        return true;
      } catch (error) {
        this.allVN = [];
        this.rebuildTierGroups();
        if (!silent) {
          this.$store.app.addToast('加载 VN 列表失败: ' + this.getErrorMessage(error), 'error');
        }
        return false;
      }
    },

    normalizeTierSortForAllVN() {
      const groupedByTierId = new Map();

      for (const vn of this.allVN) {
        const tierId = vn?.tierId || null;
        if (!tierId) continue;

        if (!groupedByTierId.has(tierId)) {
          groupedByTierId.set(tierId, []);
        }
        groupedByTierId.get(tierId).push(vn);
      }

      for (const [tierId, items] of groupedByTierId.entries()) {
        const validTier = this.tiers.some(item => item.id === tierId);
        if (!validTier) continue;

        items.sort((a, b) => {
          const aSort = Number.isFinite(Number(a?.tierSort)) ? Number(a.tierSort) : Number.MAX_SAFE_INTEGER;
          const bSort = Number.isFinite(Number(b?.tierSort)) ? Number(b.tierSort) : Number.MAX_SAFE_INTEGER;
          if (aSort !== bSort) return aSort - bSort;
          return (a?.createdAt || '').localeCompare(b?.createdAt || '');
        });

        items.forEach((vn, index) => {
          vn.tierSort = index;
        });
      }
    },

    rebuildTierGroups() {
      const grouped = {};
      for (const tier of this.tiers) {
        grouped[tier.id] = [];
      }

      const untiered = [];
      for (const vn of this.allVN) {
        if (vn?.tierId && grouped[vn.tierId]) {
          grouped[vn.tierId].push(vn);
        } else {
          untiered.push(vn);
        }
      }

      for (const tierId of Object.keys(grouped)) {
        grouped[tierId].sort((a, b) => {
          const aSort = Number.isFinite(Number(a?.tierSort)) ? Number(a.tierSort) : Number.MAX_SAFE_INTEGER;
          const bSort = Number.isFinite(Number(b?.tierSort)) ? Number(b.tierSort) : Number.MAX_SAFE_INTEGER;
          if (aSort !== bSort) return aSort - bSort;
          return (a?.createdAt || '').localeCompare(b?.createdAt || '');
        });
      }

      this.tieredVN = grouped;
      this.untieredVN = untiered;
    },

    getTierItems(tierId) {
      return this.tieredVN[tierId] || [];
    },

    resolveTierKey(tierId) {
      return tierId || '__untiered__';
    },

    getItemsByTierKey(tierKey) {
      if (tierKey === '__untiered__') {
        return this.untieredVN || [];
      }
      return this.tieredVN[tierKey] || [];
    },

    clearDropIndicator() {
      this.dropIndicatorTierKey = null;
      this.dropIndicatorIndex = null;
    },

    isDropBefore(tierId, index) {
      return this.dropIndicatorTierKey === this.resolveTierKey(tierId) && this.dropIndicatorIndex === index;
    },

    isDropAtEnd(tierId) {
      const tierKey = this.resolveTierKey(tierId);
      const items = this.getItemsByTierKey(tierKey);
      return this.dropIndicatorTierKey === tierKey && this.dropIndicatorIndex === items.length && items.length > 0;
    },

    openCreateTier() {
      this.editingTier = null;
      this.tierForm = {
        name: '',
        color: '#ff4757'
      };
      if (!this.showTierEdit) {
        lockPageScroll();
      }
      this.showTierEdit = true;
    },

    openTierEdit(tier) {
      this.editingTier = tier;
      this.tierForm = {
        name: tier?.name || '',
        color: tier?.color || '#ff4757'
      };
      if (!this.showTierEdit) {
        lockPageScroll();
      }
      this.showTierEdit = true;
    },

    closeTierEdit() {
      if (!this.showTierEdit) return;
      this.showTierEdit = false;
      this.editingTier = null;
      unlockPageScroll();
    },

    async saveTier() {
      const name = (this.tierForm.name || '').trim();
      const color = (this.tierForm.color || '').trim();

      if (!name) {
        this.$store.app.addToast('Tier 名称不能为空', 'error');
        return;
      }

      if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
        this.$store.app.addToast('Tier 颜色必须是 #RRGGBB 格式', 'error');
        return;
      }

      this.isSavingTier = true;
      try {
        if (this.editingTier?.id) {
          await tierAPI.update(this.editingTier.id, { name, color });
          this.$store.app.addToast('Tier 已更新');
        } else {
          await tierAPI.create({ name, color });
          this.$store.app.addToast('Tier 已创建');
        }

        await this.loadTiers();
        this.closeTierEdit();
      } catch (error) {
        this.$store.app.addToast('保存 Tier 失败: ' + error.message, 'error');
      } finally {
        this.isSavingTier = false;
      }
    },

    async deleteTier(id) {
      if (!confirm('删除该 Tier 后，其下条目将变为未分类。确定删除？')) return;

      try {
        await tierAPI.delete(id);
        this.$store.app.addToast('Tier 已删除');
        await Promise.all([this.loadTiers(), this.loadVNList()]);
      } catch (error) {
        this.$store.app.addToast('删除 Tier 失败: ' + error.message, 'error');
      }
    },

    async moveTier(tierId, direction) {
      const index = this.tiers.findIndex(item => item.id === tierId);
      if (index < 0) return;

      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= this.tiers.length) return;

      const nextTiers = [...this.tiers];
      const [moved] = nextTiers.splice(index, 1);
      nextTiers.splice(nextIndex, 0, moved);

      try {
        await tierAPI.updateOrder(nextTiers.map(item => item.id));
        this.tiers = nextTiers;
        this.rebuildTierGroups();
      } catch (error) {
        this.$store.app.addToast('更新排序失败: ' + error.message, 'error');
      }
    },

    onDragStart(vn, event) {
      if (!this.$store.app.isAdmin) return;
      this.draggedVN = vn;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', vn.id);
    },

    onDragEnd() {
      this.draggedVN = null;
      this.dragOverTierId = null;
      this.clearDropIndicator();
    },

    onDragOver(tierId, event) {
      if (!this.$store.app.isAdmin) return;
      event.preventDefault();
      this.dragOverTierId = tierId;
      event.dataTransfer.dropEffect = 'move';

      const draggedId = this.draggedVN?.id || event.dataTransfer.getData('text/plain');
      const tierKey = this.resolveTierKey(tierId);
      const originalItems = this.getItemsByTierKey(tierKey);
      const itemsWithoutDragged = originalItems.filter(item => item.id !== draggedId);
      const draggedIndex = originalItems.findIndex(item => item.id === draggedId);

      let insertIndex = itemsWithoutDragged.length;
      const targetCard = event.target?.closest?.('.tier-vn-card');
      const targetId = targetCard?.dataset?.vnId || null;

      if (targetId) {
        const targetIndex = originalItems.findIndex(item => item.id === targetId);
        if (targetIndex >= 0) {
          const rect = targetCard.getBoundingClientRect();
          const isBefore = (event.clientX - rect.left) < rect.width / 2;
          insertIndex = isBefore ? targetIndex : targetIndex + 1;

          if (draggedIndex >= 0 && draggedIndex < insertIndex) {
            insertIndex -= 1;
          }
        }
      }

      this.dropIndicatorTierKey = tierKey;
      this.dropIndicatorIndex = Math.max(0, Math.min(insertIndex, itemsWithoutDragged.length));
    },

    onDragLeave(tierId, event) {
      const currentTarget = event.currentTarget;
      const relatedTarget = event.relatedTarget;
      if (currentTarget && relatedTarget && currentTarget.contains(relatedTarget)) {
        return;
      }

      if (this.dragOverTierId === tierId) {
        this.dragOverTierId = null;
      }

      const tierKey = this.resolveTierKey(tierId);
      if (this.dropIndicatorTierKey === tierKey) {
        this.clearDropIndicator();
      }
    },

    async applyTierBatchUpdates(payloads) {
      if (!Array.isArray(payloads) || payloads.length === 0) {
        return;
      }

      for (let index = 0; index < payloads.length; index += this.MAX_BATCH_TIER_UPDATES) {
        const chunk = payloads.slice(index, index + this.MAX_BATCH_TIER_UPDATES);
        await vnAPI.batchUpdateTier(chunk);
      }
    },

    async onDrop(tierId, event) {
      if (!this.$store.app.isAdmin) return;

      event.preventDefault();
      const draggedId = this.draggedVN?.id || event.dataTransfer.getData('text/plain');
      this.dragOverTierId = null;

      if (!draggedId) return;

      const vn = this.allVN.find(item => item.id === draggedId);
      if (!vn) return;

      const targetTierKey = this.resolveTierKey(tierId);
      const targetTierId = targetTierKey === '__untiered__' ? null : targetTierKey;
      const sourceTierId = vn.tierId || null;
      const sourceTierKey = this.resolveTierKey(sourceTierId);
      const orderedTargetItems = [...this.getItemsByTierKey(targetTierKey)];

      let insertIndex = this.dropIndicatorTierKey === targetTierKey && Number.isFinite(Number(this.dropIndicatorIndex))
        ? Number(this.dropIndicatorIndex)
        : orderedTargetItems.filter(item => item.id !== draggedId).length;

      const payloadMap = new Map();
      const addPayload = (id, nextTierId, nextTierSort = undefined) => {
        if (typeof id !== 'string' || !id) return;
        payloadMap.set(id, { id, tierId: nextTierId, tierSort: nextTierSort });
      };

      const collectReorderDiff = (beforeItems, afterItems, tierIdForItems) => {
        const beforeIndexMap = new Map(beforeItems.map((item, index) => [item.id, index]));
        afterItems.forEach((item, index) => {
          const prevIndex = beforeIndexMap.get(item.id);
          if (prevIndex !== index) {
            addPayload(item.id, tierIdForItems, index);
          }
        });
      };

      if (!targetTierId) {
        if (sourceTierId !== null) {
          addPayload(draggedId, null, undefined);

          const sourceBefore = [...this.getItemsByTierKey(sourceTierKey)];
          const sourceAfter = sourceBefore.filter(item => item.id !== draggedId);
          collectReorderDiff(sourceBefore, sourceAfter, sourceTierId);
        }
      } else {
        const targetBefore = [...orderedTargetItems];
        const targetAfter = orderedTargetItems.filter(item => item.id !== draggedId);

        insertIndex = Math.max(0, Math.min(insertIndex, targetAfter.length));
        targetAfter.splice(insertIndex, 0, vn);

        const nextOrderIds = targetAfter.map(item => item.id);
        const prevOrderIds = targetBefore.map(item => item.id);
        const sameOrder = sourceTierId === targetTierId &&
          nextOrderIds.length === prevOrderIds.length &&
          nextOrderIds.every((id, idx) => id === prevOrderIds[idx]);

        if (sameOrder) {
          this.draggedVN = null;
          this.clearDropIndicator();
          return;
        }

        collectReorderDiff(targetBefore, targetAfter, targetTierId);

        if (sourceTierId && sourceTierId !== targetTierId) {
          const sourceBefore = [...this.getItemsByTierKey(sourceTierKey)];
          const sourceAfter = sourceBefore.filter(item => item.id !== draggedId);
          collectReorderDiff(sourceBefore, sourceAfter, sourceTierId);
        }
      }

      const payloads = Array.from(payloadMap.values());

      try {
        if (payloads.length === 0) {
          return;
        }

        await this.applyTierBatchUpdates(payloads);

        for (const payload of payloads) {
          const localEntry = this.allVN.find(item => item.id === payload.id);
          if (localEntry) {
            localEntry.tierId = payload.tierId;
            if (payload.tierSort !== undefined) {
              localEntry.tierSort = payload.tierSort;
            } else if (!payload.tierId) {
              localEntry.tierSort = 0;
            }
          }
        }

        this.normalizeTierSortForAllVN();
        this.rebuildTierGroups();
        this.$store.app.addToast('Tier 顺序更新成功');
      } catch (error) {
        this.$store.app.addToast('拖拽更新失败: ' + this.getErrorMessage(error), 'error');
        await this.loadVNList({ silent: true });
      } finally {
        this.draggedVN = null;
        this.clearDropIndicator();
      }
    },

    async onDropToUntiered(event) {
      await this.onDrop(null, event);
    },

    async openDetail(vn) {
      try {
        const res = await vnAPI.get(vn.id);
        this.selectedVN = res;
        if (!this.showDetail) {
          lockPageScroll();
        }
        this.showDetail = true;
      } catch (error) {
        this.$store.app.addToast('加载详情失败: ' + error.message, 'error');
      }
    },

    closeDetail() {
      if (!this.showDetail) return;
      this.showDetail = false;
      this.selectedVN = null;
      unlockPageScroll();
    },

    getDetailTags(vn) {
      if (!vn) return [];

      if (this.config.tagsMode === 'manual') {
        return Array.isArray(vn?.user?.tags) ? vn.user.tags : [];
      }

      const vndbTags = Array.isArray(vn?.vndb?.tags) ? vn.vndb.tags : [];

      if (this.config.translateTags && this.translations) {
        return translateTags(vndbTags, this.translations);
      }

      return vndbTags;
    },

    formatUserPlayTime,

    renderMarkdown
  };
}

// ============ 统计页组件 ============

function statsPage() {
  return {
    stats: null,
    isLoading: true,
    _initialized: false,

    async init() {
      if (this._initialized) return;
      this._initialized = true;
      await this.loadStats();
    },

    async loadStats() {
      this.isLoading = true;
      try {
        const res = await statsAPI.get();
        this.stats = res.data || res;
      } catch (error) {
        this.$store.app.addToast('加载统计失败: ' + error.message, 'error');
      } finally {
        this.isLoading = false;
      }
    },

    formatMinutes(minutes) {
      if (!minutes) return '0小时';
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours}小时`;
      const days = Math.floor(hours / 24);
      const remainHours = hours % 24;
      return `${days}天${remainHours}小时`;
    },

    formatRating(rating) {
      if (!rating) return '0.00';
      return rating.toFixed(2);
    }
  };
}

// 注册全局函数（供 HTML onclick 使用）
window.toggleTheme = toggleTheme;
window.toggleMobileMenu = toggleMobileMenu;
