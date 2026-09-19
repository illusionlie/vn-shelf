/**
 * Cloudflare Turnstile 前端装载助手（登录页 widget 与设置页临时测试 widget 共用）
 *
 * 例外说明：Turnstile 挑战脚本无法自托管（挑战逻辑与 Cloudflare 域绑定且持续更新），
 * 是 vendor 自托管规则的显式例外（09-19 任务沉淀 spec）。按需注入——
 * siteKey 未配置的部署零第三方请求。禁止把脚本 URL 写死进任何 *.html。
 */

const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

// 模块级 promise 单例：同一页面多次调用只注入一个 <script> 标签
let turnstileScriptPromise = null;

/**
 * 懒加载 Turnstile 脚本（?render=explicit：不自动扫 cf-turnstile，由调用方显式 render）
 * @returns {Promise<void>} 脚本就绪（window.turnstile 可用）后 resolve；
 *   加载失败 reject 并复位单例，允许下次重试
 */
export function loadTurnstileScript() {
  if (typeof window !== 'undefined' && window.turnstile) {
    return Promise.resolve();
  }
  if (!turnstileScriptPromise) {
    turnstileScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        // 失败复位单例：下次调用可重试（瞬时网络故障场景）
        turnstileScriptPromise = null;
        reject(new Error('Turnstile script failed to load'));
      };
      document.head.appendChild(script);
    });
  }
  return turnstileScriptPromise;
}

/**
 * 站点手动主题下的 widget theme 取值（Turnstile 的 'auto' 跟系统而非站点主题）
 * @returns {'light'|'dark'}
 */
export function turnstileTheme() {
  return document.documentElement.classList.contains('dark-mode') ? 'dark' : 'light';
}
