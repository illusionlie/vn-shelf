/**
 * 增强版 Markdown 渲染模块
 * 支持常用 Markdown 语法，保持轻量级和安全性
 */

/**
 * 转义 HTML 特殊字符
 * @param {string} text - 原始文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 检查 URL 是否安全（防止 XSS）
 * 只允许 http、https、mailto 协议和相对路径
 * @param {string} url - 要检查的 URL
 * @returns {boolean}
 */
function isSafeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  
  const trimmedUrl = url.trim().toLowerCase();
  
  // 允许相对路径（以 / 或 # 开头）
  if (trimmedUrl.startsWith('/') || trimmedUrl.startsWith('#')) {
    return true;
  }
  
  // 允许的安全协议白名单
  const safeProtocols = ['http://', 'https://', 'mailto:'];
  
  // 检查是否以安全协议开头
  if (safeProtocols.some(protocol => trimmedUrl.startsWith(protocol))) {
    return true;
  }
  
  // 不包含协议的相对 URL（如 example.com/path）也允许
  // 但要排除 javascript: 等危险协议
  if (!trimmedUrl.includes(':') || /^[a-z0-9]/i.test(trimmedUrl)) {
    return true;
  }
  
  return false;
}

/**
 * 解析内联元素（粗体、斜体、删除线、代码、链接、图片）
 * @param {string} text - 已转义的文本
 * @returns {string} 解析后的 HTML
 */
function parseInline(text) {
  // 图片 ![alt](url) - 必须在链接之前处理
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
    const safeAlt = alt.replace(/"/g, '&quot;');
    // 验证 URL 安全性
    if (!isSafeUrl(url)) {
      return `<span class="md-image-unsafe" title="不安全的图片链接已禁用">[图片]</span>`;
    }
    const safeUrl = url.replace(/"/g, '&quot;');
    return `<img src="${safeUrl}" alt="${safeAlt}" loading="lazy" class="md-image">`;
  });
  
  // 链接 [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
    // 验证 URL 安全性
    if (!isSafeUrl(url)) {
      return `<span class="md-link-unsafe" title="不安全的链接已禁用">${linkText}</span>`;
    }
    const safeUrl = url.replace(/"/g, '&quot;');
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="md-link">${linkText}</a>`;
  });
  
  // 粗体 **text** 或 __text__
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong class="md-strong">$1</strong>');
  text = text.replace(/__(.+?)__/g, '<strong class="md-strong">$1</strong>');
  
  // 斜体 *text* 或 _text_（注意避免与粗体冲突）
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em class="md-em">$1</em>');
  text = text.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em class="md-em">$1</em>');
  
  // 删除线 ~~text~~
  text = text.replace(/~~(.+?)~~/g, '<del class="md-del">$1</del>');
  
  // 行内代码 `code`
  text = text.replace(/`([^`]+)`/g, '<code class="md-code-inline">$1</code>');
  
  // 标记文本 ==text==（高亮）
  text = text.replace(/==(.+?)==/g, '<mark class="md-mark">$1</mark>');
  
  // 上标 ^text^
  text = text.replace(/\^([^^]+)\^/g, '<sup class="md-sup">$1</sup>');
  
  // 下标 ~text~（注意与删除线区分）
  text = text.replace(/(?<!~)~(?!~)([^~]+)(?<!~)~(?!~)/g, '<sub class="md-sub">$1</sub>');
  
  return text;
}

/**
 * 解析多行文本为行数组
 * @param {string} text - 原始文本
 * @returns {string[]} 行数组
 */
function parseLines(text) {
  return text.split('\n');
}

/**
 * 渲染 Markdown 文本
 * @param {string} text - Markdown 文本
 * @param {Object} options - 配置选项
 * @param {boolean} options.disableImages - 禁用图片渲染（默认 false）
 * @param {boolean} options.disableLinks - 禁用链接渲染（默认 false）
 * @returns {string} HTML 字符串
 */
export function renderMarkdown(text, options = {}) {
  if (!text) return '';
  
  const { disableImages = false, disableLinks = false } = options;
  
  // 预处理：统一换行符
  const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  // 分行处理
  const lines = parseLines(normalizedText);
  const result = [];
  let i = 0;
  
  // 处理代码块状态
  let inCodeBlock = false;
  let codeBlockContent = [];
  let codeBlockLang = '';
  
  // 处理列表状态
  let inList = false;
  let listType = ''; // 'ul' or 'ol'
  let listItems = [];
  
  // 处理引用块状态
  let inBlockquote = false;
  let blockquoteLines = [];
  
  // 处理表格状态
  let inTable = false;
  let tableRows = [];
  
  while (i < lines.length) {
    const line = lines[i];
    const trimmedLine = line.trim();
    
    // === 代码块处理 ===
    if (trimmedLine.startsWith('```')) {
      if (!inCodeBlock) {
        // 开始代码块
        inCodeBlock = true;
        codeBlockLang = trimmedLine.slice(3).trim();
        codeBlockContent = [];
      } else {
        // 结束代码块
        inCodeBlock = false;
        const langClass = codeBlockLang ? ` language-${codeBlockLang}` : '';
        const escapedContent = escapeHtml(codeBlockContent.join('\n'));
        result.push(`<pre class="md-code-block"><code class="md-code${langClass}">${escapedContent}</code></pre>`);
        codeBlockLang = '';
        codeBlockContent = [];
      }
      i++;
      continue;
    }
    
    if (inCodeBlock) {
      codeBlockContent.push(line);
      i++;
      continue;
    }
    
    // === 空行处理 ===
    if (trimmedLine === '') {
      // 关闭列表
      if (inList) {
        flushList(result, listItems, listType);
        inList = false;
        listItems = [];
        listType = '';
      }
      // 关闭引用块
      if (inBlockquote) {
        flushBlockquote(result, blockquoteLines);
        inBlockquote = false;
        blockquoteLines = [];
      }
      // 关闭表格
      if (inTable) {
        flushTable(result, tableRows);
        inTable = false;
        tableRows = [];
      }
      i++;
      continue;
    }
    
    // === 标题处理 ===
    const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      // 关闭之前的块级元素
      if (inList) { flushList(result, listItems, listType); inList = false; listItems = []; listType = ''; }
      if (inBlockquote) { flushBlockquote(result, blockquoteLines); inBlockquote = false; blockquoteLines = []; }
      if (inTable) { flushTable(result, tableRows); inTable = false; tableRows = []; }
      
      const level = headingMatch[1].length;
      const content = parseInline(escapeHtml(headingMatch[2]));
      result.push(`<h${level} class="md-heading md-h${level}">${content}</h${level}>`);
      i++;
      continue;
    }
    
    // === 水平分割线 ===
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmedLine)) {
      if (inList) { flushList(result, listItems, listType); inList = false; listItems = []; listType = ''; }
      if (inBlockquote) { flushBlockquote(result, blockquoteLines); inBlockquote = false; blockquoteLines = []; }
      if (inTable) { flushTable(result, tableRows); inTable = false; tableRows = []; }
      
      result.push('<hr class="md-hr">');
      i++;
      continue;
    }
    
    // === 引用块处理 ===
    if (trimmedLine.startsWith('>')) {
      // 关闭其他块级元素
      if (inList) { flushList(result, listItems, listType); inList = false; listItems = []; listType = ''; }
      if (inTable) { flushTable(result, tableRows); inTable = false; tableRows = []; }
      
      if (!inBlockquote) {
        inBlockquote = true;
        blockquoteLines = [];
      }
      // 移除开头的 > 和可选空格
      blockquoteLines.push(trimmedLine.replace(/^>\s?/, ''));
      i++;
      continue;
    }
    
    // === 无序列表处理 ===
    const ulMatch = trimmedLine.match(/^[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (inBlockquote) { flushBlockquote(result, blockquoteLines); inBlockquote = false; blockquoteLines = []; }
      if (inTable) { flushTable(result, tableRows); inTable = false; tableRows = []; }
      
      if (!inList || listType !== 'ul') {
        if (inList) { flushList(result, listItems, listType); }
        inList = true;
        listType = 'ul';
        listItems = [];
      }
      listItems.push(parseInline(escapeHtml(ulMatch[1])));
      i++;
      continue;
    }
    
    // === 有序列表处理 ===
    const olMatch = trimmedLine.match(/^(\d+)\.\s+(.+)$/);
    if (olMatch) {
      if (inBlockquote) { flushBlockquote(result, blockquoteLines); inBlockquote = false; blockquoteLines = []; }
      if (inTable) { flushTable(result, tableRows); inTable = false; tableRows = []; }
      
      if (!inList || listType !== 'ol') {
        if (inList) { flushList(result, listItems, listType); }
        inList = true;
        listType = 'ol';
        listItems = [];
      }
      listItems.push(parseInline(escapeHtml(olMatch[2])));
      i++;
      continue;
    }
    
    // === 任务列表处理 ===
    const taskMatch = trimmedLine.match(/^[-*+]\s+\[([ xX])\]\s+(.+)$/);
    if (taskMatch) {
      if (inBlockquote) { flushBlockquote(result, blockquoteLines); inBlockquote = false; blockquoteLines = []; }
      if (inTable) { flushTable(result, tableRows); inTable = false; tableRows = []; }
      
      if (!inList) {
        inList = true;
        listType = 'ul';
        listItems = [];
      }
      const checked = taskMatch[1].toLowerCase() === 'x' ? ' checked' : '';
      const content = parseInline(escapeHtml(taskMatch[2]));
      listItems.push(`<label class="md-task"><input type="checkbox"${checked} disabled>${content}</label>`);
      i++;
      continue;
    }
    
    // === 表格处理 ===
    if (trimmedLine.includes('|')) {
      // 检查是否是表格行
      const tableMatch = trimmedLine.match(/^\|?(.+)\|?$/);
      if (tableMatch) {
        const cells = tableMatch[1].split('|').map(cell => cell.trim());
        
        // 检查是否是分隔行
        if (cells.every(cell => /^[-:]+$/.test(cell))) {
          // 这是分隔行，跳过（对齐方式暂不处理）
          i++;
          continue;
        }
        
        if (!inTable) {
          if (inList) { flushList(result, listItems, listType); inList = false; listItems = []; listType = ''; }
          if (inBlockquote) { flushBlockquote(result, blockquoteLines); inBlockquote = false; blockquoteLines = []; }
          inTable = true;
          tableRows = [];
        }
        tableRows.push(cells);
        i++;
        continue;
      }
    }
    
    // === 普通段落 ===
    // 关闭其他块级元素
    if (inList) { flushList(result, listItems, listType); inList = false; listItems = []; listType = ''; }
    if (inBlockquote) { flushBlockquote(result, blockquoteLines); inBlockquote = false; blockquoteLines = []; }
    if (inTable) { flushTable(result, tableRows); inTable = false; tableRows = []; }
    
    // 处理段落中的换行（两个空格或反斜杠结尾）
    let paragraphContent = parseInline(escapeHtml(trimmedLine));
    
    // 检查是否需要软换行
    if (trimmedLine.endsWith('  ') || trimmedLine.endsWith('\\')) {
      paragraphContent = paragraphContent.replace(/(  |\\)$/, '<br class="md-br">');
    }
    
    result.push(`<p class="md-paragraph">${paragraphContent}</p>`);
    i++;
  }
  
  // 处理未关闭的块级元素
  if (inCodeBlock) {
    const langClass = codeBlockLang ? ` language-${codeBlockLang}` : '';
    const escapedContent = escapeHtml(codeBlockContent.join('\n'));
    result.push(`<pre class="md-code-block"><code class="md-code${langClass}">${escapedContent}</code></pre>`);
  }
  if (inList) {
    flushList(result, listItems, listType);
  }
  if (inBlockquote) {
    flushBlockquote(result, blockquoteLines);
  }
  if (inTable) {
    flushTable(result, tableRows);
  }
  
  // 应用选项过滤
  let html = result.join('\n');
  
  if (disableImages) {
    html = html.replace(/<img[^>]*>/g, '');
  }
  
  if (disableLinks) {
    html = html.replace(/<a[^>]*>([^<]*)<\/a>/g, '$1');
  }
  
  return html;
}

/**
 * 刷新列表到结果
 */
function flushList(result, items, type) {
  if (items.length === 0) return;
  
  const tag = type === 'ol' ? 'ol' : 'ul';
  const listClass = type === 'ol' ? 'md-list md-list-ordered' : 'md-list md-list-unordered';
  
  const listItems = items.map(item => {
    // 检查是否已经是任务列表项
    if (item.startsWith('<label')) {
      return `<li class="md-list-item md-task-item">${item}</li>`;
    }
    return `<li class="md-list-item">${item}</li>`;
  }).join('\n');
  
  result.push(`<${tag} class="${listClass}">\n${listItems}\n</${tag}>`);
}

/**
 * 刷新引用块到结果
 */
function flushBlockquote(result, lines) {
  if (lines.length === 0) return;
  
  // 递归处理引用块内容（支持嵌套 Markdown）
  const content = renderMarkdown(lines.join('\n'));
  result.push(`<blockquote class="md-blockquote">${content}</blockquote>`);
}

/**
 * 刷新表格到结果
 */
function flushTable(result, rows) {
  if (rows.length === 0) return;
  
  const tableRows = rows.map((row, index) => {
    const tag = index === 0 ? 'th' : 'td';
    const cells = row.map(cell => `<${tag} class="md-cell">${parseInline(escapeHtml(cell))}</${tag}>`).join('');
    const rowClass = index === 0 ? 'md-row md-row-header' : 'md-row';
    return `<tr class="${rowClass}">${cells}</tr>`;
  }).join('\n');
  
  result.push(`<table class="md-table">\n${tableRows}\n</table>`);
}

/**
 * 清理 Markdown 文本（移除格式符号）
 * @param {string} text - Markdown 文本
 * @returns {string} 纯文本
 */
export function stripMarkdown(text) {
  if (!text) return '';
  
  return text
    // 移除代码块
    .replace(/```[\s\S]*?```/g, '')
    // 移除行内代码
    .replace(/`([^`]+)`/g, '$1')
    // 移除图片
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // 移除链接
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // 移除粗体
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    // 移除斜体
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    // 移除删除线
    .replace(/~~(.+?)~~/g, '$1')
    // 移除高亮
    .replace(/==(.+?)==/g, '$1')
    // 移除上标下标
    .replace(/\^([^^]+)\^/g, '$1')
    .replace(/~([^~]+)~/g, '$1')
    // 移除标题标记
    .replace(/^#{1,6}\s+/gm, '')
    // 移除列表标记
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    // 移除任务列表标记
    .replace(/^\[[ xX]\]\s+/gm, '')
    // 移除引用标记
    .replace(/^>\s?/gm, '')
    // 移除水平线
    .replace(/^[-*_]{3,}$/gm, '')
    // 清理多余空行
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 获取 Markdown 文本摘要
 * @param {string} text - Markdown 文本
 * @param {number} maxLength - 最大长度
 * @returns {string} 摘要文本
 */
export function getMarkdownExcerpt(text, maxLength = 200) {
  if (!text) return '';
  
  const plainText = stripMarkdown(text);
  if (plainText.length <= maxLength) return plainText;
  
  return plainText.slice(0, maxLength).trim() + '...';
}
