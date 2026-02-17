/**
 * VN Shelf 主应用模块
 * 使用Alpine.js进行状态管理
 */

import { authAPI, vnAPI, statsAPI, indexAPI, configAPI, dataAPI } from './api.js';
import { renderMarkdown } from './markdown.js';

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
function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    document.body.classList.add('dark-mode');
  }
}

function toggleTheme() {
  document.body.classList.toggle('dark-mode');
  const isDark = document.body.classList.contains('dark-mode');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
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
    init() {
      this.checkAuth();
      initTheme();
      initProgressBar();
    },

    async checkAuth() {
      try {
        const res = await authAPI.verify();
        this.isAdmin = res.success;
      } catch { this.isAdmin = false; }
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
    
    async init() {
      await this.loadVNList();
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
        this.showDetail = true;
      } catch (error) {
        this.$store.app.addToast('加载详情失败: ' + error.message, 'error');
      }
    },
    
    closeDetail() {
      this.showDetail = false;
      this.selectedVN = null;
    },
    
    openEdit(vn = null) {
      if (vn) {
        this.editForm = {
          id: vn.id,
          vndbId: vn.id,
          titleCn: vn.user?.titleCn || '',
          personalRating: vn.user?.personalRating || 0,
          playTime: vn.user?.playTime || '',
          playTimeMinutes: vn.user?.playTimeMinutes || 0,
          review: vn.user?.review || '',
          startDate: vn.user?.startDate || '',
          finishDate: vn.user?.finishDate || '',
          isNew: false
        };
      } else {
        this.editForm = {
          vndbId: '',
          titleCn: '',
          personalRating: 0,
          playTime: '',
          playTimeMinutes: 0,
          review: '',
          startDate: '',
          finishDate: '',
          isNew: true
        };
      }
      this.showEdit = true;
      this.showDetail = false;
    },
    
    closeEdit() {
      this.showEdit = false;
      this.editForm = {};
    },
    
    async saveEdit() {
      try {   
        if (this.editForm.isNew) {
          await vnAPI.create({
            vndbId: this.editForm.vndbId,
            titleCn: this.editForm.titleCn,
            personalRating: this.editForm.personalRating,
            playTime: this.editForm.playTime,
            playTimeMinutes: this.editForm.playTimeMinutes,
            review: this.editForm.review,
            startDate: this.editForm.startDate,
            finishDate: this.editForm.finishDate,
          });
          this.$store.app.addToast('添加成功');
        } else {
          await vnAPI.update(this.editForm.id, {
            titleCn: this.editForm.titleCn,
            personalRating: this.editForm.personalRating,
            playTime: this.editForm.playTime,
            playTimeMinutes: this.editForm.playTimeMinutes,
            review: this.editForm.review,
            startDate: this.editForm.startDate,
            finishDate: this.editForm.finishDate,
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
    
    async init() {
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
    config: {},
    vndbApiToken: '',
    newPassword: '',
    confirmPassword: '',
    indexStatus: null,
    isLoading: false,
    tagsSettings: {
      tagsMode: 'vndb',
      translateTags: true,
      translationUrl: ''
    },
    
    async init() {
      await this.loadConfig();
      await this.loadIndexStatus();
    },
    
    async loadConfig() {
      try {
        const res = await configAPI.get();
        this.config = res.data || {};
      } catch (error) {
        this.$store.app.addToast('加载配置失败: ' + error.message, 'error');
      }
    },
    
    async loadIndexStatus() {
      try {
        this.indexStatus = await indexAPI.getStatus();
      } catch {
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
        failed: '失败'
      };
      return map[status] || status;
    }
  };
}

// ============ 统计页组件 ============

function statsPage() {
  return {
    stats: null,
    isLoading: true,
    
    async init() {
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