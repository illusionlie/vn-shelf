/**
 * VN Shelf 统计页组件
 *
 * 数据全部来自 GET /api/stats 的后端聚合（shape 见 src/stats.js 头注），
 * 本组件只做视图派生：状态段百分比、直方图/柱状高度、年份分组、tag 择源与翻译。
 * tags 配置与翻译管线复用 createTagsView mixin（与书架/Tier 页同源）。
 */

import { friendlyErrorMessage, statsAPI } from '../api.js';
import { t } from '../i18n.js';
import { translateTag } from '../translations.js';

import { createTagsView } from './shared.js';

// 状态段展示顺序：四态 + 未设置；wishlist 为后端预留值，仅 >0 时防御性插在 none 之前
const STATUS_SEGMENT_ORDER = ['playing', 'finished', 'stalled', 'dropped', 'none'];

export function statsPage() {
  return {
    ...createTagsView(),

    stats: null,
    isLoading: true,
    selectedYear: '',
    _initialized: false,

    async init() {
      if (this._initialized) return;
      this._initialized = true;
      this.setupTranslationsRefresh();
      await this.loadConfig();
      await this.initTranslations();
      await this.loadStats();
    },

    async loadStats() {
      this.isLoading = true;
      try {
        const res = await statsAPI.get();
        this.stats = res.data;
        this.selectedYear = this.timelineYears[0] || '';
      } catch (error) {
        this.$store.app.addToast(friendlyErrorMessage(error, t('prefix.loadStatsFailed')), 'error');
      } finally {
        this.isLoading = false;
      }
    },

    // ===== 概览 =====

    get finishedCount() {
      return this.stats?.statusCounts?.finished || 0;
    },

    get finishedRatePercent() {
      const total = this.stats?.total || 0;
      return total > 0 ? Math.round((this.finishedCount / total) * 100) : 0;
    },

    // ===== ① 状态 =====

    get statusSegments() {
      const counts = this.stats?.statusCounts || {};
      const total = this.stats?.total || 0;
      const keys = [...STATUS_SEGMENT_ORDER];
      if ((counts.wishlist || 0) > 0) {
        keys.splice(keys.indexOf('none'), 0, 'wishlist');
      }
      return keys
        .map(key => {
          const count = counts[key] || 0;
          return {
            key,
            count,
            percent: total > 0 ? (count / total) * 100 : 0
          };
        })
        .filter(segment => segment.count > 0);
    },

    statusLabel(key) {
      return t(`status.${key}`);
    },

    get statusAriaLabel() {
      return this.statusSegments
        .map(segment => `${this.statusLabel(segment.key)} ${segment.count}`)
        .join(', ');
    },

    // ===== ② 评分 =====

    histogramBars(kind) {
      const buckets = this.stats?.ratingHistograms?.[kind];
      if (!Array.isArray(buckets)) return [];
      const max = Math.max(...buckets, 1);
      return buckets.map((count, index) => ({
        score: index + 1,
        count,
        heightPercent: (count / max) * 100
      }));
    },

    histogramTotal(kind) {
      const buckets = this.stats?.ratingHistograms?.[kind];
      return Array.isArray(buckets) ? buckets.reduce((sum, count) => sum + count, 0) : 0;
    },

    get hasRatingSamples() {
      return this.histogramTotal('vndb') > 0 || this.histogramTotal('personal') > 0;
    },

    histogramAriaLabel(kind) {
      const title = kind === 'personal' ? t('stats.personalHistogram') : t('stats.vndbHistogram');
      return `${title}: ${this.histogramBars(kind).map(bar => `${bar.score}=${bar.count}`).join(', ')}`;
    },

    get diffSummaryText() {
      const diff = this.stats?.ratingDiff;
      if (!diff || diff.count === 0) return '';
      return t('stats.diffSummary', { avg: this.formatDiff(diff.avg), n: diff.count });
    },

    displayTitle(item) {
      return item.titleCn || item.titleJa || item.title || item.id;
    },

    vndbUrl(id) {
      return `https://vndb.org/${id}`;
    },

    formatDiff(diff) {
      const value = Number(diff) || 0;
      return value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
    },

    // ===== ③ 时间线 =====

    get timelineYears() {
      const months = this.stats?.timeline?.months || [];
      const years = Array.from(new Set(months.map(bucket => bucket.month.slice(0, 4))));
      years.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
      return years;
    },

    get yearMonths() {
      const year = this.selectedYear;
      if (!year) return [];
      const byMonth = new Map(
        (this.stats?.timeline?.months || [])
          .filter(bucket => bucket.month.startsWith(`${year}-`))
          .map(bucket => [bucket.month, bucket])
      );
      const list = [];
      for (let index = 1; index <= 12; index++) {
        const key = `${year}-${String(index).padStart(2, '0')}`;
        const bucket = byMonth.get(key);
        list.push({
          monthIndex: index,
          month: key,
          finished: bucket?.finished || 0,
          playTimeMinutes: bucket?.playTimeMinutes || 0
        });
      }
      const max = Math.max(...list.map(item => item.finished), 1);
      return list.map(item => ({ ...item, heightPercent: (item.finished / max) * 100 }));
    },

    get yearFinishedTotal() {
      return this.yearMonths.reduce((sum, item) => sum + item.finished, 0);
    },

    get yearTotalText() {
      return t('stats.yearTotal', { n: this.yearFinishedTotal });
    },

    monthTooltip(item) {
      return t('stats.monthTooltip', {
        month: item.month,
        n: item.finished,
        time: this.formatMinutes(item.playTimeMinutes)
      });
    },

    get timelineAriaLabel() {
      return `${t('stats.timelineTitle')} ${this.selectedYear}: ${this.yearMonths
        .map(item => `${item.monthIndex}=${item.finished}`)
        .join(', ')}`;
    },

    get spanText() {
      const timeline = this.stats?.timeline;
      if (!timeline || timeline.spanCount === 0 || timeline.avgSpanDays === null) {
        return t('stats.noSpanSamples');
      }
      return t('stats.spanSummary', { d: timeline.avgSpanDays, n: timeline.spanCount });
    },

    // ===== ④ 偏好 =====

    get developerBars() {
      const developers = this.stats?.topDevelopers || [];
      const max = Math.max(...developers.map(dev => dev.count), 1);
      return developers.map(dev => ({ ...dev, widthPercent: (dev.count / max) * 100 }));
    },

    devCountText(dev) {
      return t('stats.devCount', { n: dev.count });
    },

    get displayTopTags() {
      const top = this.stats?.topTags;
      if (!top) return [];
      if (this.config.tagsMode === 'manual') {
        return (top.user || []).map(tag => ({ key: tag.name, name: tag.name, count: tag.count }));
      }
      const useTranslation = this.config.translateTags && this.translations;
      return (top.vndb || []).map(tag => ({
        key: tag.name,
        name: useTranslation ? translateTag(tag.name, this.translations) : tag.name,
        count: tag.count
      }));
    },

    // ===== 格式化 =====

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
