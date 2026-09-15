/**
 * 统一详情弹窗注入（09-12 详情弹窗统一）
 *
 * index 与 tier 两页的详情弹窗此前是两份复制粘贴模板，已发生呈现漂移
 * （tier 版十星级行 / 无状态徽章 / 无管理员按钮）。收敛为本模块的单一模板，
 * 以 index 版为基准，口径见任务 09-12-detail-modal-unification design.md：
 * - 标题：vndb.org 链接 + 外链图标按钮（tier 版升级）
 * - 状态徽章：statusBadgeLabel / statusIcon（tier 版补齐）
 * - 评分：单 ★ + 数字 + 颜色语义（绿=个人 / 金=VNDB；tier 版弃十星级行）
 * - 页脚：admin 渲染刷新 + 删除；「编辑」由组件级 detailCanEdit 控制
 *   （vnShelf true / tierlistPage false，编辑表单注入另立后续任务）
 *
 * 注入契约与 layout.js injectShell/injectFooter 同模式：纯 DOM 注入、无 Alpine 依赖；
 * app.js 在 injectFooter() 之后、首遍 applyI18nDom() 之前调用，注入模板的
 * data-i18n 标记（含 template.content 内的）随首遍扫描翻译就位。Alpine 接管
 * 注入 DOM 是成熟先例（confirmDialog 即由 injectShell 注入）。mount 必须位于
 * 页面 x-data 根内（两页均为 body x-data，mount 放原弹窗位置即契约成立），
 * 模板的 x-show / x-ref / 方法引用才能挂到页面组件作用域。
 *
 * 模板依赖的组件成员（页面组件 / shared.js mixin 提供）：
 * - selectedVN / showDetail / closeDetail（createDetailModal）
 * - statusBadgeLabel / statusIcon / formatUserPlayTime（utils.js 导出，组件挂引用）
 * - getDisplayTags（createTagsView）、renderMarkdown（markdown.js）
 * - isRefreshing / refreshVN / deleteVN（createDetailAdminActions）
 * - openEdit（仅 vnShelf）+ detailCanEdit（组件级标志）
 */

const DETAIL_MODAL_TEMPLATE = `
  <div class="modal-overlay" x-show="showDetail" x-cloak
       x-transition:enter="modal-fade-enter" x-transition:enter-start="modal-fade-enter-start" x-transition:enter-end="modal-fade-enter-end"
       x-transition:leave="modal-fade-leave" x-transition:leave-start="modal-fade-leave-start" x-transition:leave-end="modal-fade-leave-end"
       @click.self="closeDetail()" @keydown.escape.window="!$store.app._confirmDialog?.visible && closeDetail()">
    <div class="modal" x-ref="detailModal" x-show="showDetail"
         x-transition:enter="modal-scale-enter" x-transition:enter-start="modal-scale-enter-start" x-transition:enter-end="modal-scale-enter-end"
         x-transition:leave="modal-scale-leave" x-transition:leave-start="modal-scale-leave-start" x-transition:leave-end="modal-scale-leave-end"
         role="dialog" aria-modal="true" aria-labelledby="detailModalTitle">
      <template x-if="selectedVN">
        <div>
          <div class="modal-header">
            <h2 id="detailModalTitle" class="modal-title" x-text="selectedVN.user?.titleCn || selectedVN.vndb?.titleCn || selectedVN.vndb?.titleJa || selectedVN.vndb?.title || $t('common.details')"></h2>
            <button class="modal-close" data-i18n-aria-label="common.close" @click="closeDetail()">&times;</button>
          </div>

          <div class="modal-body">
            <div class="detail-header">
              <div style="position:relative;flex-shrink:0;" x-data="{ showNsfw: false }">
                <img
                  :src="selectedVN.vndb?.image || ''"
                  :alt="selectedVN.vndb?.title"
                  class="detail-image"
                  decoding="async"
                  :class="{ 'nsfw-blur': selectedVN.vndb?.imageNsfw && !showNsfw }"
                  @error="$event.target.style.display='none'"
                >
                <div
                  class="nsfw-overlay"
                  x-show="selectedVN.vndb?.imageNsfw && !showNsfw"
                  @click.stop="showNsfw = true"
                  style="border-radius:var(--border-radius-md);"
                  data-i18n-title="common.clickToShow"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg>
                </div>
              </div>
              <div class="detail-info">
                <h1 class="detail-title">
                  <a
                    :href="'https://vndb.org/' + selectedVN.id"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="detail-title-link"
                    data-i18n-title="index.viewOnVndb"
                  >
                    <span x-text="selectedVN.user?.titleCn || selectedVN.vndb?.titleCn || selectedVN.vndb?.titleJa || selectedVN.vndb?.title"></span>
                  </a>
                  <a
                    :href="'https://vndb.org/' + selectedVN.id"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="vndb-link-btn"
                    data-i18n-title="index.goToVndb"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                      <polyline points="15 3 21 3 21 9"></polyline>
                      <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                  </a>
                  <span class="all-age-badge" x-show="selectedVN.vndb?.allAge" data-i18n-title="common.allAgeTitle" data-i18n="common.allAge"></span>
                  <span
                    class="status-badge"
                    :class="'status-' + selectedVN.user?.status"
                    x-show="statusBadgeLabel(selectedVN.user?.status)"
                    :title="statusBadgeLabel(selectedVN.user?.status)"
                    :aria-label="statusBadgeLabel(selectedVN.user?.status)"
                  >
                    <span x-html="statusIcon(selectedVN.user?.status)"></span>
                    <span class="status-badge-label" x-text="statusBadgeLabel(selectedVN.user?.status)"></span>
                  </span>
                </h1>
                <p class="detail-subtitle" x-text="(selectedVN.user?.titleCn || selectedVN.vndb?.titleCn) ? (selectedVN.vndb?.titleJa || selectedVN.vndb?.title) : ''" x-show="selectedVN.user?.titleCn || selectedVN.vndb?.titleCn"></p>
                <p class="detail-company" x-text="selectedVN.vndb?.developers?.join(', ') || ''" x-show="selectedVN.vndb?.developers?.length"></p>

                <!-- VNDB评分 -->
                <div class="detail-stars-group" x-show="selectedVN.vndb?.rating">
                  <span class="detail-stars-label" data-i18n="common.vndbRating"></span>
                  <div class="detail-stars vndb-rating">
                    <span class="star">★</span>
                    <span class="detail-rating-score" x-text="selectedVN.vndb?.rating?.toFixed(1) || '-'"></span>
                  </div>
                </div>

                <!-- 个人评分 -->
                <div class="detail-stars-group" x-show="selectedVN.user?.personalRating">
                  <span class="detail-stars-label" data-i18n="common.personalRating"></span>
                  <div class="detail-stars personal-rating">
                    <span class="star">★</span>
                    <span class="detail-rating-score" x-text="selectedVN.user?.personalRating?.toFixed(1) || '-'"></span>
                  </div>
                </div>

                <div class="detail-meta">
                  <div class="detail-meta-item">
                    <span class="detail-meta-label" data-i18n="common.gameLength"></span>
                    <span class="detail-meta-value" x-text="selectedVN.vndb?.length || $t('common.unknown')"></span>
                  </div>
                  <div class="detail-meta-item">
                    <span class="detail-meta-label" data-i18n="common.myPlayTime"></span>
                    <span class="detail-meta-value" x-text="formatUserPlayTime(selectedVN.user)"></span>
                  </div>
                </div>
              </div>
            </div>
            <div class="detail-tags" x-show="getDisplayTags(selectedVN).length">
              <h4 class="detail-tags-title" data-i18n="common.tags"></h4>
              <div class="detail-tags-list">
                <template x-for="tag in getDisplayTags(selectedVN).slice(0, 15)" :key="tag">
                  <span class="detail-tag" x-text="tag"></span>
                </template>
              </div>
            </div>

            <div class="detail-review" x-show="selectedVN.user?.review">
              <h3 class="detail-review-title" data-i18n="common.review"></h3>
              <div class="detail-review-content" x-html="renderMarkdown(selectedVN.user?.review || '')"></div>
            </div>
          </div>

          <!-- 管理员页脚用 x-if（访客不渲染进 DOM）；「编辑」由组件级 detailCanEdit 控制 -->
          <template x-if="$store.app.isAdmin">
            <div class="modal-footer">
              <!-- 刷新左靠（modal-footer-start）：「从源同步」与「改我的数据」视觉分组；同条目刷新中编辑/删除禁用（后端整行写入）。
                   刷新钮自身用 aria-disabled（真 disabled 会让焦点掉出弹窗焦点陷阱） -->
              <button
                type="button"
                class="btn btn-secondary modal-footer-start"
                :aria-disabled="isRefreshing(selectedVN.id) ? 'true' : 'false'"
                :aria-busy="isRefreshing(selectedVN.id) ? 'true' : 'false'"
                @click="refreshVN(selectedVN.id)"
              >
                <span x-text="isRefreshing(selectedVN.id) ? $t('common.refreshing') : $t('common.refreshVndb')"></span>
              </button>
              <button type="button" class="btn btn-secondary" x-show="detailCanEdit" :disabled="isRefreshing(selectedVN.id)" @click="openEdit(selectedVN)" data-i18n="common.edit"></button>
              <button type="button" class="btn btn-danger" :disabled="isRefreshing(selectedVN.id)" @click="deleteVN(selectedVN.id)" data-i18n="common.delete"></button>
            </div>
          </template>
        </div>
      </template>
    </div>
  </div>
`;

/**
 * 把统一详情弹窗模板写入 #detail-modal-mount 占位（index / tier 两页提供，
 * 位于页面 x-data 根内）。无占位的页面（login / settings / stats）静默空操作。
 * 重复调用覆写相同内容，与 injectShell 同语义。
 */
export function injectDetailModal() {
  const mount = document.getElementById('detail-modal-mount');
  if (mount) {
    mount.innerHTML = DETAIL_MODAL_TEMPLATE;
  }
}
