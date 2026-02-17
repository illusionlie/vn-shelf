/**
 * 简易Markdown渲染模块
 */

/**
 * 渲染Markdown文本
 * @param {string} text - Markdown文本
 * @returns {string} HTML字符串
 */
export function renderMarkdown(text) {
  if (!text) return '';
  
  // 转义HTML特殊字符
  let html = text
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>');
  
  // 粗体 **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  
  // 斜体 *text*
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  
  // 删除线 ~~text~~
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
  
  // 行内代码 `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // 链接 [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  
  // 换行
  html = html.replace(/\n/g, '<br>');
  
  return html;
}

/**
 * 清理Markdown文本（移除格式符号）
 * @param {string} text - Markdown文本
 * @returns {string} 纯文本
 */
export function stripMarkdown(text) {
  if (!text) return '';
  
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
}
