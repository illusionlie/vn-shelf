/**
 * VN Shelf 统计页组件
 */

import { friendlyErrorMessage, statsAPI } from '../api.js';

export function statsPage() {
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
        this.stats = res.data;
      } catch (error) {
        this.$store.app.addToast(friendlyErrorMessage(error, '加载统计失败'), 'error');
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
