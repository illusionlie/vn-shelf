/**
 * VN Shelf 主题与背景模块
 */

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

export function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    document.body.classList.add('dark-mode');
  }

  updateThemeToggleButtons();
}

export function toggleTheme() {
  document.body.classList.toggle('dark-mode');
  const isDark = document.body.classList.contains('dark-mode');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  updateThemeToggleButtons();
  applyBackgroundOverlay();
}

// ========== 自定义背景 ===========

let _backgroundConfig = null;

export function setBackgroundConfig(config) {
  _backgroundConfig = config;
}

// 标记是否已挂载后台刷新监听，避免重复 addEventListener
let _appearanceRefreshListenerBound = false;

export async function initBackground() {
  try {
    const cfg = await Alpine.store('app').loadAppearance();
    setBackgroundConfig(cfg);
    applyBackground(cfg);
  } catch (error) {
    console.warn('[theme] initBackground', {
      error: error?.message || String(error)
    });
  }

  // 监听 Store 后台刷新事件，重新应用背景（幂等挂载一次）
  if (!_appearanceRefreshListenerBound) {
    _appearanceRefreshListenerBound = true;
    window.addEventListener('appearance-refreshed', (event) => {
      const cfg = event?.detail || null;
      setBackgroundConfig(cfg);
      applyBackground(cfg);
    });
  }
}

export function applyBackground(config) {
  if (!config || !config.backgroundUrl) {
    document.body.style.backgroundImage = '';
    document.body.classList.remove('has-bg-image');
    applyBackgroundOverlay();
    return;
  }

  const safeUrl = config.backgroundUrl.replace(/["\\]/g, '\\$&');
  document.body.style.backgroundImage = `url("${safeUrl}")`;
  document.body.classList.add('has-bg-image');
  applyBackgroundOverlay();
}

export function applyBackgroundOverlay() {
  const overlay = document.querySelector('.background-overlay');
  if (!overlay) return;

  if (!_backgroundConfig || !_backgroundConfig.backgroundUrl) {
    overlay.style.backgroundColor = '';
    overlay.style.backdropFilter = '';
    overlay.style.webkitBackdropFilter = '';
    return;
  }

  const opacity = _backgroundConfig.backgroundOverlay ?? 0.5;
  const blur = _backgroundConfig.backgroundBlur ?? 4;
  const isDark = document.body.classList.contains('dark-mode');

  if (isDark) {
    overlay.style.backgroundColor = `rgba(18, 18, 18, ${opacity})`;
  } else {
    overlay.style.backgroundColor = `rgba(237, 238, 240, ${opacity})`;
  }

  overlay.style.backdropFilter = `blur(${blur}px)`;
  overlay.style.webkitBackdropFilter = `blur(${blur}px)`;
}


