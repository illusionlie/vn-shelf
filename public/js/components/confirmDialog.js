/**
 * 确认对话框组件
 *
 * 替代原生 confirm()：可样式化、可键盘可达、带焦点陷阱与焦点还原。
 *
 * 握手：组件通过 init() 把自身挂到全局 Store（init 里 this 是组件实例，
 * 可正确暴露 show 方法），业务侧调用
 * `await this.$store.app.confirm({ title, message, confirmText, cancelText, danger, thirdText })`
 * 即可弹出并拿到结果。
 *
 * 返回值语义：`true`=确认、`false`=取消、`null`=第三按钮（仅当传入 thirdText 时渲染）。
 * 导入场景用此区分“合并 / 替换 / 放弃”：true=合并、false=替换、null=取消导入。
 *
 * 焦点：显示时在 `.modal` 面板上建立 trapFocus，Tab 在按钮间循环不外溢；
 * 关闭时还原焦点到触发元素。Esc 关闭等价于取消。
 */

import { trapFocus } from '../utils.js';

export function confirmDialog() {
  return {
    visible: false,
    title: '',
    message: '',
    confirmText: '确定',
    cancelText: '取消',
    danger: false,
    thirdText: '',
    _resolve: null,
    _trapRelease: null,
    _lastFocus: null,

    init() {
      // 把自身挂到全局 Store，供业务侧 $store.app.confirm() 驱动。
      // 必须在 init() 里做：此处 this 是组件实例（含 show 方法）；
      // 在 HTML 的 x-init 表达式里 this 会回落到外层上下文，无法正确绑定方法。
      this.$store.app._confirmDialog = this;

      // visible 翻转时建立/释放焦点陷阱
      this.$watch('visible', (val) => {
        if (val) {
          this.$nextTick(() => {
            if (this.$refs.dialog) {
              this._trapRelease = trapFocus(this.$refs.dialog);
            }
          });
        } else {
          this._releaseFocus();
        }
      });
    },

    /**
     * 弹出确认对话框，返回 Promise<boolean|null>。
     * @param {Object} [opts]
     * @param {string} [opts.title]
     * @param {string} [opts.message]
     * @param {string} [opts.confirmText='确定']
     * @param {string} [opts.cancelText='取消']
     * @param {boolean} [opts.danger=false] - true 时确认按钮用 danger 样式
     * @param {string} [opts.thirdText=''] - 在传入时额外渲染第三按钮（如“取消导入”），
     *   点击返回 null。默认为空串不渲染。
     * @returns {Promise<boolean|null>} true=确认、false=取消、null=第三按钮
     */
    show({
      title = '',
      message = '',
      confirmText = '确定',
      cancelText = '取消',
      danger = false,
      thirdText = ''
    } = {}) {
      this.title = title;
      this.message = message;
      this.confirmText = confirmText;
      this.cancelText = cancelText;
      this.danger = danger;
      this.thirdText = thirdText || '';
      this._lastFocus = document.activeElement;
      this.visible = true;
      return new Promise((resolve) => {
        this._resolve = resolve;
      });
    },

    confirm() {
      const resolve = this._resolve;
      this._resolve = null;
      this.visible = false;
      if (resolve) resolve(true);
    },

    cancel() {
      const resolve = this._resolve;
      this._resolve = null;
      this.visible = false;
      if (resolve) resolve(false);
    },

    /**
     * 第三按钮（可选，仅当 show 传入 thirdText 时渲染）。点击在此关闭并 resolve(null)。
     * 如“取消导入 / 放弃”之类语义：跳过确认与取消的业务动作。
     */
    third() {
      const resolve = this._resolve;
      this._resolve = null;
      this.visible = false;
      if (resolve) resolve(null);
    },

    _releaseFocus() {
      if (this._trapRelease) {
        try {
          this._trapRelease();
        } catch {
          // 释放陷阱失败时静默降级
        }
        this._trapRelease = null;
      }
      if (this._lastFocus) {
        try {
          if (typeof this._lastFocus.focus === 'function') {
            this._lastFocus.focus();
          }
        } catch {
          // 还原焦点失败时静默降级
        }
        this._lastFocus = null;
      }
    }
  };
}
