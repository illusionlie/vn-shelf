/**
 * VN Shelf 统计页组件
 */

import { friendlyErrorMessage, statsAPI } from '../api.js';
import { t } from '../i18n.js';

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
        this.$store.app.addToast(friendlyErrorMessage(error, t('prefix.loadStatsFailed')), 'error');
      } finally {
        this.isLoading = false;
      }
    },

    formatMinutes(minutes) {
      if (!minutes) return t('time.hours', { h: 0 });
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return t('time.hours', { h: hours });
      const days = Math.floor(hours / 24);
      const remainHours = hours % 24;
      return t('time.daysHours', { d: days, h: remainHours });
    },

    formatRating(rating) {
      if (!rating) return '0.00';
      return rating.toFixed(2);
    }
  };
}
