/**
 * HTML模板模块
 * 将所有前端代码内联到Worker中
 */

// CSS样式 - Liquid Glass 风格
export const CSS_CONTENT = `
/* ===== CSS Variables - Liquid Glass Theme ===== */
:root {
  /* --- Base --- */
  --font-family-base: 'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
  --accent-color: #007AFF;
  --border-radius-sm: 8px;
  --border-radius-md: 16px;
  --border-radius-lg: 24px;
  --transition-fast: 0.2s ease-in-out;
  --transition-medium: 0.3s ease-in-out;
  
  /* --- Light Mode (Default) - Frosted Silver --- */
  --primary-text-color: #1d1d1f;
  --secondary-text-color: #6e6e73;
  --muted-text-color: #8e8e93;
  --body-bg-color: #edeef0d5;
  --bg-overlay-color: transparent;
  --header-bg-color: rgba(255, 255, 255, 0.45);
  --card-bg-color: rgba(255, 255, 255, 0.8);
  --drawer-bg-color: rgba(245, 245, 247, 0.9);
  --modal-bg-color: rgba(242, 242, 247, 0.95);
  --overlay-bg-color: rgba(0, 0, 0, 0.3);
  --input-bg-color: rgba(0, 0, 0, 0.04);
  --input-focus-bg-color: rgba(0, 0, 0, 0.08);
  --tag-bg-color: rgba(0, 0, 0, 0.06);
  --border-color: rgba(0, 0, 0, 0.08);
  --border-glow: rgba(0, 122, 255, 0.25);
  --shadow-light: 0 2px 8px rgba(0, 0, 0, 0.06);
  --shadow-medium: 0 8px 24px rgba(0, 0, 0, 0.1);
  --shadow-glow: 0 0 30px rgba(0, 122, 255, 0.1);
  --star-empty-color: #d1d1d6;
  --success-color: #34c759;
  --error-color: #ff3b30;
  --warning-color: #ff9500;
}

body.dark-mode {
  /* --- Dark Mode - Obsidian Glass --- */
  --primary-text-color: #E2E2E2;
  --secondary-text-color: #A0A0A0;
  --muted-text-color: #6e6e73;
  --body-bg-color:  #121212ef;
  --bg-overlay-color: transparent;
  --header-bg-color: rgba(28, 28, 30, 0.85);
  --card-bg-color: rgba(40, 40, 42, 0.75);
  --drawer-bg-color: rgba(20, 20, 20, 0.9);
  --modal-bg-color: rgba(44, 44, 46, 0.9);
  --overlay-bg-color: rgba(0, 0, 0, 0.5);
  --input-bg-color: rgba(255, 255, 255, 0.08);
  --input-focus-bg-color: rgba(255, 255, 255, 0.12);
  --tag-bg-color: rgba(255, 255, 255, 0.08);
  --border-color: rgba(255, 255, 255, 0.08);
  --border-glow: rgba(0, 122, 255, 0.3);
  --shadow-light: 0 2px 8px rgba(0, 0, 0, 0.2);
  --shadow-medium: 0 8px 24px rgba(0, 0, 0, 0.3);
  --shadow-glow: 0 0 30px rgba(0, 122, 255, 0.15);
  --star-empty-color: #48484a;
}

/* ===== Reset & Base ===== */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { font-size: 16px; scroll-behavior: smooth; }

body {
  font-family: var(--font-family-base);
  background-color: var(--body-bg-color);
  background-size: cover;
  background-position: center;
  background-attachment: fixed;
  color: var(--primary-text-color);
  line-height: 1.6;
  min-height: 100vh;
  padding-top: 120px;
  transition: padding-left var(--transition-medium), color var(--transition-medium), background-color var(--transition-medium);
}

/* ===== Loading Progress Bar ===== */
.loading-progress-bar {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 3px;
  background-color: rgba(255, 255, 255, 0.1);
  z-index: 1001;
  overflow: hidden;
  opacity: 1;
  transition: opacity 0.5s ease-out;
}

.loading-progress-bar.hidden {
  opacity: 0;
  pointer-events: none;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg,
    var(--accent-color) 0%,
    rgba(0, 122, 255, 0.8) 50%,
    var(--accent-color) 100%);
  width: 0%;
  transition: width 0.3s ease-out;
  position: relative;
  overflow: hidden;
}

.progress-fill::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.4) 50%,
    transparent 100%);
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

/* Background Overlay */
.background-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: var(--bg-overlay-color);
  z-index: -1;
  transition: background-color var(--transition-medium);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

/* ===== Links ===== */
a { 
  color: var(--accent-color); 
  text-decoration: none; 
  transition: color var(--transition-fast); 
}
a:hover { 
  color: var(--secondary-text-color); 
}

/* ===== Images ===== */
img { max-width: 100%; height: auto; display: block; }

/* ===== Layout Container ===== */
.container { 
  max-width: 1500px; 
  margin: 0 auto; 
  padding: 0 5%; 
}

/* ===== Header - Liquid Glass ===== */
.main-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  background: var(--header-bg-color);
  backdrop-filter: blur(8px) saturate(180%);
  border-bottom: 1px solid var(--border-color);
  padding: 12px 5%;
  transition: left var(--transition-medium);
}

.banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 40px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 15px;
  height: 40px;
}

.banner-title {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0;
  color: var(--primary-text-color);
}

.banner-title:hover {
  color: var(--accent-color);
}

/* ===== Navigation - Unified Position ===== */
.banner-nav {
  display: flex;
  align-items: center;
  gap: 20px;
}

.banner-nav a {
  color: var(--secondary-text-color);
  text-decoration: none;
  transition: color var(--transition-fast);
  font-weight: 500;
  padding: 8px 16px;
  border-radius: var(--border-radius-sm);
}

.banner-nav a:hover {
  color: var(--accent-color);
  background: var(--tag-bg-color);
}

.banner-nav a.active {
  color: var(--accent-color);
  background: rgba(0, 122, 255, 0.15);
}

/* Mobile Navigation */
.mobile-nav {
  position: relative;
  display: none;
}

.more-menu-toggle-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 5px;
  color: var(--secondary-text-color);
  display: flex;
  align-items: center;
  justify-content: center;
}
.more-menu-toggle-btn:hover {
  color: var(--accent-color);
}
.more-menu-toggle-btn svg {
  width: 22px;
  height: 22px;
}

.more-menu {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  background-color: var(--drawer-bg-color);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: var(--border-radius-sm);
  box-shadow: var(--shadow-medium);
  border: 1px solid var(--border-color);
  width: 150px;
  padding: 8px;
  z-index: 110;
  opacity: 0;
  transform: translateY(-10px);
  pointer-events: none;
  transition: opacity var(--transition-fast), transform var(--transition-fast);
}

.more-menu.open {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

.more-menu a {
  display: block;
  color: var(--primary-text-color);
  text-decoration: none;
  padding: 10px 12px;
  border-radius: 6px;
  transition: background-color var(--transition-fast), color var(--transition-fast);
}

.more-menu a:hover {
  background-color: var(--accent-color);
  color: #fff;
}

/* Theme Toggle Button */
.theme-toggle-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 5px;
  color: var(--secondary-text-color);
  display: flex;
  align-items: center;
  justify-content: center;
}

.theme-toggle-btn:hover {
  color: var(--accent-color);
}

.theme-toggle-btn svg {
  width: 20px;
  height: 20px;
}

/* ===== Controls Bar ===== */
.controls-bar {
  display: flex;
  align-items: center;
  gap: 15px;
  flex-wrap: wrap;
}

.search-container {
  flex-grow: 1;
  max-width: 400px;
}

.search-input {
  width: 100%;
  padding: 8px 15px;
  background-color: var(--input-bg-color);
  border: 1px solid transparent;
  border-radius: var(--border-radius-sm);
  color: var(--primary-text-color);
  font-size: 1rem;
  outline: none;
  transition: all var(--transition-fast);
}

.search-input:focus {
  background-color: var(--input-focus-bg-color);
  border-color: var(--accent-color);
}

.search-input::placeholder {
  color: var(--muted-text-color);
}

.sort-select {
  background-color: var(--input-bg-color);
  border: 1px solid transparent;
  border-radius: var(--border-radius-sm);
  padding: 8px 15px;
  color: var(--primary-text-color);
  font-size: 0.9rem;
  cursor: pointer;
  transition: all var(--transition-fast);
  outline: none;
}

.sort-select:focus {
  border-color: var(--accent-color);
}

/* ===== Buttons - Liquid Glass ===== */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: var(--border-radius-sm);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
  border: none;
  position: relative;
  overflow: hidden;
}

.btn-primary {
  background: var(--accent-color);
  color: white;
  box-shadow: 0 4px 15px rgba(0, 122, 255, 0.3);
}

.btn-primary:hover {
  background: #0056b3;
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 122, 255, 0.4);
}

.btn-secondary {
  background: var(--tag-bg-color);
  color: var(--primary-text-color);
  border: 1px solid var(--border-color);
  backdrop-filter: blur(10px);
}

.btn-secondary:hover {
  background: var(--input-focus-bg-color);
  border-color: var(--accent-color);
  transform: translateY(-1px);
}

.btn-danger {
  background: var(--error-color);
  color: white;
}

.btn-danger:hover {
  background: #d63029;
  transform: translateY(-2px);
}

.btn-sm { 
  padding: 6px 12px; 
  font-size: 0.8rem; 
}

/* ===== Scrollbar ===== */
::-webkit-scrollbar {
  width: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background-color: var(--tag-bg-color);
  border-radius: 10px;
  border: 2px solid transparent;
  background-clip: content-box;
}

::-webkit-scrollbar-thumb:hover {
  background-color: var(--accent-color);
}

/* ===== VN List & Cards ===== */
.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 30px;
  padding: 24px 0;
  transition: opacity var(--transition-medium);
}

.vn-card {
  background: var(--card-bg-color);
  border-radius: var(--border-radius-md);
  overflow: hidden;
  box-shadow: var(--shadow-light);
  transition: transform var(--transition-medium), box-shadow var(--transition-medium);
  display: flex;
  flex-direction: column;
  backdrop-filter: blur(15px);
  -webkit-backdrop-filter: blur(15px);
  border: 1px solid var(--border-color);
  cursor: pointer;
}

.vn-card:hover {
  transform: translateY(-8px);
  box-shadow: var(--shadow-medium);
  border-color: var(--border-glow);
}

.vn-card-image-wrapper {
  position: relative;
  overflow: hidden;
}

.vn-card-image-wrapper .all-age-badge {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 10;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  font-size: 0.8rem;
  padding: 4px 10px;
}

.vn-card-image {
  width: 100%;
  height: 400px;
  object-fit: cover;
  transition: transform 0.4s ease;
  background: var(--card-bg-color);
}

.vn-card:hover .vn-card-image {
  transform: scale(1.05);
}

.vn-card-content {
  padding: 20px;
  display: flex;
  flex-direction: column;
  flex-grow: 1;
}

.vn-card-title {
  font-size: 1.1rem;
  font-weight: 700;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--primary-text-color);
  display: flex;
  align-items: center;
  gap: 8px;
}

.all-age-badge {
  display: inline-block;
  font-size: 0.65rem;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  background: linear-gradient(135deg, #10b981, #059669);
  color: white;
  white-space: nowrap;
  flex-shrink: 0;
  vertical-align: middle;
}

.vn-card-subtitle {
  font-size: 0.85rem;
  color: var(--secondary-text-color);
  margin-bottom: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vn-card-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.8rem;
  margin-top: auto;
}

/* Rating Display */
.vn-card-rating {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rating-value {
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--accent-color);
}

/* Star Rating Visualization */
.stars-container {
  display: flex;
  gap: 2px;
}

.star {
  color: #FFD700;
  font-size: 1.2rem;
}

.star.empty {
  color: var(--star-empty-color);
}

.vn-card-company {
  font-size: 0.85rem;
  color: var(--secondary-text-color);
  margin-bottom: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-divider {
  margin: 8px 0;
  border: none;
  height: 2px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0), var(--border-color), rgba(255, 255, 255, 0));
}

/* ===== Modal - Liquid Glass ===== */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--overlay-bg-color);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
  opacity: 0;
  visibility: hidden;
  transition: all 0.3s ease;
}

.modal-overlay.active {
  opacity: 1;
  visibility: visible;
}

.modal {
  background: var(--modal-bg-color);
  border-radius: var(--border-radius-lg);
  max-width: 700px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  transform: scale(0.95);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-medium);
  backdrop-filter: blur(25px);
  -webkit-backdrop-filter: blur(25px);
}

.modal-overlay.active .modal {
  transform: scale(1);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color);
  position: sticky;
  top: 0;
  background: var(--modal-bg-color);
  backdrop-filter: blur(10px);
  z-index: 1;
}

.modal-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--primary-text-color);
}

.modal-close {
  background: var(--tag-bg-color);
  border: none;
  color: var(--secondary-text-color);
  font-size: 1.25rem;
  cursor: pointer;
  padding: 8px;
  line-height: 1;
  border-radius: var(--border-radius-sm);
  transition: all var(--transition-fast);
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-close:hover {
  color: var(--primary-text-color);
  background: var(--input-focus-bg-color);
}

.modal-body { 
  padding: 24px; 
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 20px 24px;
  border-top: 1px solid var(--border-color);
  position: sticky;
  bottom: 0;
  background: var(--modal-bg-color);
}

/* ===== Forms ===== */
.form-group { 
  margin-bottom: 20px; 
}

.form-label {
  display: block;
  margin-bottom: 8px;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--secondary-text-color);
}

.form-input {
  width: 100%;
  background: var(--input-bg-color);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius-sm);
  padding: 12px 16px;
  color: var(--primary-text-color);
  font-size: 0.95rem;
  transition: all var(--transition-fast);
}

.form-input:focus {
  outline: none;
  border-color: var(--accent-color);
  background: var(--input-focus-bg-color);
  box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.15);
}

.form-input::placeholder { 
  color: var(--muted-text-color); 
}

.form-textarea {
  min-height: 120px;
  resize: vertical;
}

.form-hint {
  font-size: 0.8rem;
  color: var(--muted-text-color);
  margin-top: 6px;
}

.form-error {
  font-size: 0.85rem;
  color: var(--error-color);
  margin-top: 6px;
}

/* ===== Detail Page ===== */
.detail-header {
  display: flex;
  gap: 24px;
  margin-bottom: 24px;
}

.detail-image {
  width: 280px;
  flex-shrink: 0;
  border-radius: var(--border-radius-md);
  object-fit: cover;
  box-shadow: var(--shadow-medium);
}

.detail-info { flex: 1; }

.detail-title {
  font-size: 1.75rem;
  font-weight: 700;
  margin-bottom: 4px;
  letter-spacing: -0.02em;
  color: var(--primary-text-color);
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.detail-title .all-age-badge {
  font-size: 0.75rem;
  padding: 3px 8px;
}

.detail-subtitle {
  font-size: 1.1rem;
  color: var(--secondary-text-color);
  margin-bottom: 8px;
}

.detail-company {
  font-size: 0.95rem;
  color: var(--secondary-text-color);
  margin-bottom: 16px;
}

.detail-meta {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.detail-tags {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}

.detail-tags-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--secondary-text-color);
  margin-bottom: 12px;
}

.detail-tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.detail-tag {
  background-color: var(--tag-bg-color);
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 0.85rem;
  color: var(--primary-text-color);
  border: 1px solid var(--border-color);
}

.detail-stars-group {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.detail-stars-label {
  font-size: 0.85rem;
  color: var(--muted-text-color);
  min-width: 70px;
}

.detail-stars {
  display: flex;
  align-items: center;
  gap: 8px;
}

.detail-stars .stars-container {
  gap: 2px;
}

.detail-stars .star {
  font-size: 1.2rem;
}

.detail-rating-score {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--accent-color);
}

/* 个人评分使用不同颜色 */
.detail-stars.personal-rating .star {
  color: #6bff6b;
}

.detail-stars.personal-rating .star.empty {
  color: var(--star-empty-color);
}

.detail-stars.personal-rating .detail-rating-score {
  color: #6bff6b;
}

.detail-meta-item {
  display: flex;
  flex-direction: column;
  padding: 12px 16px;
  background: var(--tag-bg-color);
  border-radius: var(--border-radius-sm);
  border: 1px solid var(--border-color);
}

.detail-meta-label {
  font-size: 0.75rem;
  color: var(--muted-text-color);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.detail-meta-value {
  font-size: 1rem;
  color: var(--primary-text-color);
  font-weight: 500;
  margin-top: 4px;
}

.detail-review {
  background: var(--tag-bg-color);
  border-radius: var(--border-radius-md);
  padding: 20px;
  margin-top: 24px;
  border: 1px solid var(--border-color);
}

.detail-review-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--primary-text-color);
}

.detail-review-content {
  color: var(--secondary-text-color);
  line-height: 1.8;
}

/* ===== Stats Page ===== */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 20px;
  margin-bottom: 32px;
}

.stat-card {
  background: var(--card-bg-color);
  border-radius: var(--border-radius-md);
  padding: 28px 24px;
  text-align: center;
  border: 1px solid var(--border-color);
  position: relative;
  overflow: hidden;
  transition: all 0.3s ease;
  backdrop-filter: blur(15px);
}

.stat-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--accent-color), #5856d6, #af52de);
}

.stat-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-medium);
  border-color: var(--border-glow);
}

.stat-value {
  font-size: 2.5rem;
  font-weight: 700;
  color: var(--accent-color);
}

.stat-label {
  font-size: 0.9rem;
  color: var(--muted-text-color);
  margin-top: 8px;
}

/* ===== Login Page ===== */
.login-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  padding-top: 0;
}

.login-box {
  background: var(--card-bg-color);
  backdrop-filter: blur(20px);
  border-radius: var(--border-radius-lg);
  padding: 48px 40px;
  width: 100%;
  max-width: 420px;
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-medium);
}

.login-title {
  font-size: 1.75rem;
  font-weight: 700;
  text-align: center;
  margin-bottom: 32px;
  color: var(--primary-text-color);
}

/* ===== Settings Page ===== */
.settings-section {
  background: var(--card-bg-color);
  border-radius: var(--border-radius-md);
  padding: 24px;
  margin-bottom: 20px;
  border: 1px solid var(--border-color);
  backdrop-filter: blur(10px);
}

.settings-section-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--primary-text-color);
}

.settings-section-title::before {
  content: '';
  width: 4px;
  height: 18px;
  background: var(--accent-color);
  border-radius: 2px;
}

/* ===== Empty State ===== */
.empty-state {
  text-align: center;
  padding: 80px 20px;
  color: var(--muted-text-color);
}

.empty-state-icon {
  font-size: 4rem;
  margin-bottom: 16px;
  filter: grayscale(0.5);
}

.empty-state-title {
  font-size: 1.25rem;
  color: var(--secondary-text-color);
  margin-bottom: 8px;
}

/* ===== Loading ===== */
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px;
}

.loading-spinner {
  width: 44px;
  height: 44px;
  border: 3px solid var(--border-color);
  border-top-color: var(--accent-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ===== Toast Messages ===== */
.toast-container {
  position: fixed;
  top: 24px;
  right: 24px;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.toast {
  background: var(--modal-bg-color);
  border-radius: var(--border-radius-sm);
  padding: 14px 20px;
  box-shadow: var(--shadow-medium);
  display: flex;
  align-items: center;
  gap: 12px;
  animation: slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  max-width: 380px;
  border: 1px solid var(--border-color);
  backdrop-filter: blur(10px);
}

.toast-success { border-left: 4px solid var(--success-color); }
.toast-error { border-left: 4px solid var(--error-color); }
.toast-warning { border-left: 4px solid var(--warning-color); }

@keyframes slideIn {
  from { transform: translateX(100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

/* ===== Page Title ===== */
.page-title {
  font-size: 1.75rem;
  font-weight: 700;
  margin-bottom: 24px;
  letter-spacing: -0.02em;
  color: var(--primary-text-color);
}

/* ===== Responsive Design ===== */
.mobile-only {
  display: none;
}

@media screen and (max-width: 700px) {
  body {
    padding-top: 140px;
  }
  
  .main-header {
    padding: 10px 15px;
  }
  
  .banner-nav { 
    display: none; 
  }
  
  .desktop-only {
    display: none;
  }
  
  .mobile-only {
    display: block;
  }
  
  .cards-grid {
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 14px;
  }
  
  .vn-card-image {
    height: 280px;
  }
  
  .detail-header {
    flex-direction: column;
  }
  
  .detail-image {
    width: 100%;
    max-height: 300px;
  }
  
  .detail-meta {
    grid-template-columns: 1fr;
  }
  
  .controls-bar {
    flex-direction: column;
    align-items: stretch;
  }
  
  .search-container {
    max-width: 100%;
  }
}

/* ===== Utility Classes ===== */
.hidden { display: none !important; }
.text-center { text-align: center; }
.text-muted { color: var(--muted-text-color); }
.mt-4 { margin-top: 16px; }
.mb-4 { margin-bottom: 16px; }
.p-4 { padding: 16px; }
`;

// JavaScript代码
const JS_API = `
const API_BASE = '/api';
async function apiRequest(endpoint, options = {}) {
  const url = API_BASE + endpoint;
  const config = {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  };
  if (options.body && typeof options.body === 'object') {
    config.body = JSON.stringify(options.body);
  }
  const response = await fetch(url, config);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'HTTP ' + response.status);
  return data;
}
const authAPI = {
  async status() {
    return apiRequest('/auth/status');
  },
  async init(password, vndbApiToken = '') {
    return apiRequest('/auth/init', { method: 'POST', body: { password, vndbApiToken } });
  },
  async login(password) {
    return apiRequest('/auth/login', { method: 'POST', body: { password } });
  },
  async logout() {
    return apiRequest('/auth/logout', { method: 'POST' });
  },
  async verify() {
    return apiRequest('/auth/verify');
  }
};
const vnAPI = {
  async getList(params = {}) {
    const query = new URLSearchParams();
    if (params.sort) query.set('sort', params.sort);
    if (params.search) query.set('search', params.search);
    const queryString = query.toString();
    return apiRequest('/vn' + (queryString ? '?' + queryString : ''));
  },
  async get(id) { return apiRequest('/vn/' + id); },
  async create(data) { return apiRequest('/vn', { method: 'POST', body: data }); },
  async update(id, data) { return apiRequest('/vn/' + id, { method: 'PUT', body: data }); },
  async delete(id) { return apiRequest('/vn/' + id, { method: 'DELETE' }); }
};
const statsAPI = { async get() { return apiRequest('/stats'); } };
const indexAPI = {
  async start() { return apiRequest('/index/start', { method: 'POST' }); },
  async getStatus() { return apiRequest('/index/status'); }
};
const configAPI = {
  async get() { return apiRequest('/config'); },
  async update(data) { return apiRequest('/config', { method: 'PUT', body: data }); }
};
const dataAPI = {
  async export() { return apiRequest('/export'); },
  async import(data, mode = 'merge') {
    return apiRequest('/import', { method: 'POST', body: { entries: data.entries, mode } });
  }
};
`;

const JS_MARKDOWN = `
function renderMarkdown(text) {
  if (!text) return '';
  let html = text
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>');
  html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
  html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
  html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
  html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  html = html.replace(/\\n/g, '<br>');
  return html;
}
`;

const JS_APP = `
// Progress Bar Animation
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
  
  // Complete on load
  window.addEventListener('load', () => {
    clearInterval(interval);
    if (progressFill) {
      progressFill.style.width = '100%';
      setTimeout(() => {
        if (progressBar) progressBar.classList.add('hidden');
      }, 500);
    }
  });
  
  // Fallback: hide after 3 seconds
  setTimeout(() => {
    clearInterval(interval);
    if (progressFill) progressFill.style.width = '100%';
    setTimeout(() => {
      if (progressBar) progressBar.classList.add('hidden');
    }, 500);
  }, 3000);
}

// Theme Toggle - Default Light Mode
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

document.addEventListener('alpine:init', () => {
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
    removeToast(id) { this.toasts = this.toasts.filter(t => t.id !== id); }
  });
});

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
    async init() { await this.loadVNList(); },
    async loadVNList() {
      this.isLoading = true;
      try {
        const res = await vnAPI.getList({ sort: this.sortBy });
        this.vnList = res.data || [];
        this.filteredList = this.vnList;
      } catch (error) {
        this.\$store.app.addToast('加载失败: ' + error.message, 'error');
      } finally { this.isLoading = false; }
    },
    handleSearch() {
      if (!this.searchQuery) { this.filteredList = this.vnList; return; }
      const query = this.searchQuery.toLowerCase();
      this.filteredList = this.vnList.filter(vn =>
        vn.title.toLowerCase().includes(query) ||
        (vn.titleCn && vn.titleCn.toLowerCase().includes(query))
      );
    },
    handleSortChange() { this.loadVNList(); },
    async openDetail(vn) {
      try {
        const res = await vnAPI.get(vn.id);
        this.selectedVN = res;
        this.showDetail = true;
      } catch (error) {
        this.\$store.app.addToast('加载详情失败: ' + error.message, 'error');
      }
    },
    closeDetail() { this.showDetail = false; this.selectedVN = null; },
    openEdit(vn = null) {
      if (vn) {
        this.editForm = {
          id: vn.id, vndbId: vn.id,
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
          vndbId: '', titleCn: '', personalRating: 0, playTime: '',
          playTimeMinutes: 0, review: '', startDate: '', finishDate: '', isNew: true
        };
      }
      this.showEdit = true;
      this.showDetail = false;
    },
    closeEdit() { this.showEdit = false; this.editForm = {}; },
    async saveEdit() {
      try {
        if (this.editForm.isNew) {
          await vnAPI.create({
            vndbId: this.editForm.vndbId, titleCn: this.editForm.titleCn,
            personalRating: this.editForm.personalRating, playTime: this.editForm.playTime,
            playTimeMinutes: this.editForm.playTimeMinutes, review: this.editForm.review,
            startDate: this.editForm.startDate, finishDate: this.editForm.finishDate
          });
          this.\$store.app.addToast('添加成功');
        } else {
          await vnAPI.update(this.editForm.id, {
            titleCn: this.editForm.titleCn, personalRating: this.editForm.personalRating,
            playTime: this.editForm.playTime, playTimeMinutes: this.editForm.playTimeMinutes,
            review: this.editForm.review, startDate: this.editForm.startDate, finishDate: this.editForm.finishDate
          });
          this.\$store.app.addToast('更新成功');
        }
        this.closeEdit();
        await this.loadVNList();
      } catch (error) {
        this.\$store.app.addToast('保存失败: ' + error.message, 'error');
      }
    },
    async deleteVN() {
      if (!confirm('确定要删除这个条目吗？')) return;
      try {
        await vnAPI.delete(this.selectedVN.id);
        this.\$store.app.addToast('删除成功');
        this.closeDetail();
        await this.loadVNList();
      } catch (error) {
        this.\$store.app.addToast('删除失败: ' + error.message, 'error');
      }
    },
    renderMarkdown
  };
}

function loginPage() {
  return {
    isInitialized: null, password: '', vndbApiToken: '', error: '', isLoading: false,
    async init() {
      try {
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
      if (!this.password) { this.error = '请输入密码'; return; }
      this.isLoading = true;
      this.error = '';
      try {
        if (!this.isInitialized) await authAPI.init(this.password, this.vndbApiToken);
        await authAPI.login(this.password);
        window.location.href = '/';
      } catch (error) { this.error = error.message; }
      finally { this.isLoading = false; }
    }
  };
}

function settingsPage() {
  return {
    config: {}, vndbApiToken: '', newPassword: '', confirmPassword: '',
    indexStatus: null, isLoading: false,
    async init() { await this.loadConfig(); await this.loadIndexStatus(); },
    async loadConfig() {
      try {
        const res = await configAPI.get();
        this.config = res.data || {};
      } catch (error) {
        this.\$store.app.addToast('加载配置失败: ' + error.message, 'error');
      }
    },
    async loadIndexStatus() {
      try { this.indexStatus = await indexAPI.getStatus(); }
      catch { this.indexStatus = null; }
    },
    async saveVndbToken() {
      if (!this.vndbApiToken) return;
      this.isLoading = true;
      try {
        await configAPI.update({ vndbApiToken: this.vndbApiToken });
        this.vndbApiToken = '';
        this.\$store.app.addToast('VNDB API Token已保存');
        await this.loadConfig();
      } catch (error) {
        this.\$store.app.addToast('保存失败: ' + error.message, 'error');
      } finally { this.isLoading = false; }
    },
    async changePassword() {
      if (!this.newPassword || this.newPassword.length < 6) {
        this.\$store.app.addToast('密码长度至少6位', 'error'); return;
      }
      if (this.newPassword !== this.confirmPassword) {
        this.\$store.app.addToast('两次输入的密码不一致', 'error'); return;
      }
      this.isLoading = true;
      try {
        await configAPI.update({ newPassword: this.newPassword });
        this.newPassword = '';
        this.confirmPassword = '';
        this.\$store.app.addToast('密码已更新');
      } catch (error) {
        this.\$store.app.addToast('更新失败: ' + error.message, 'error');
      } finally { this.isLoading = false; }
    },
    async startIndex() {
      this.isLoading = true;
      try {
        const res = await indexAPI.start();
        this.\$store.app.addToast('索引已启动，共' + res.data.total + '个条目');
        await this.loadIndexStatus();
      } catch (error) {
        this.\$store.app.addToast('启动索引失败: ' + error.message, 'error');
      } finally { this.isLoading = false; }
    },
    async exportData() {
      try {
        const data = await dataAPI.export();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'vn-shelf-export-' + new Date().toISOString().split('T')[0] + '.json';
        a.click();
        URL.revokeObjectURL(url);
        this.\$store.app.addToast('导出成功');
      } catch (error) {
        this.\$store.app.addToast('导出失败: ' + error.message, 'error');
      }
    },
    async importData(event) {
      const file = event.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.entries || !Array.isArray(data.entries)) throw new Error('无效的导入文件格式');
        const mode = confirm('选择导入模式：\\n确定 = 合并（保留现有数据）\\n取消 = 替换（清空现有数据）') ? 'merge' : 'replace';
        await dataAPI.import(data, mode);
        this.\$store.app.addToast('导入成功，共' + data.entries.length + '个条目');
      } catch (error) {
        this.\$store.app.addToast('导入失败: ' + error.message, 'error');
      }
      event.target.value = '';
    },
    async logout() {
      try {
        await authAPI.logout();
        window.location.href = '/login';
      } catch (error) {
        this.\$store.app.addToast('退出失败: ' + error.message, 'error');
      }
    },
    formatStatus(status) {
      const map = { idle: '空闲', running: '运行中', completed: '已完成', failed: '失败' };
      return map[status] || status;
    }
  };
}

function statsPage() {
  return {
    stats: null, isLoading: true,
    async init() { await this.loadStats(); },
    async loadStats() {
      this.isLoading = true;
      try {
        const res = await statsAPI.get();
        this.stats = res.data || res;
      } catch (error) {
        this.\$store.app.addToast('加载统计失败: ' + error.message, 'error');
      } finally { this.isLoading = false; }
    },
    formatMinutes(minutes) {
      if (!minutes) return '0小时';
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return hours + '小时';
      const days = Math.floor(hours / 24);
      const remainHours = hours % 24;
      return days + '天' + remainHours + '小时';
    },
    formatRating(rating) { return rating ? rating.toFixed(2) : '0.00'; }
  };
}

window.vnShelf = vnShelf;
window.loginPage = loginPage;
window.settingsPage = settingsPage;
window.statsPage = statsPage;
window.toggleTheme = toggleTheme;
window.toggleMobileMenu = toggleMobileMenu;
`;

// 主页HTML
export const INDEX_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VN Shelf - 视觉小说书架</title>
  <meta name="description" content="记录我玩过的视觉小说">
  <style>${CSS_CONTENT}</style>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <script>${JS_API}${JS_MARKDOWN}${JS_APP}</script>
</head>
<body x-data="vnShelf()" x-init="init()">
  <!-- Progress Bar -->
  <div class="loading-progress-bar">
    <div class="progress-fill"></div>
  </div>
  
  <!-- Background Overlay -->
  <div class="background-overlay"></div>
  
  <!-- Header -->
  <header class="main-header">
    <div class="banner">
      <a href="/" class="banner-title">VN Shelf</a>
      <div class="header-actions">
        <nav class="banner-nav desktop-only">
          <a href="/" class="active">首页</a>
          <a href="/stats">统计</a>
          <template x-if="$store.app.isAdmin"><a href="/settings">设置</a></template>
          <template x-if="!$store.app.isAdmin"><a href="/login">登录</a></template>
        </nav>
        <button class="theme-toggle-btn" @click="toggleTheme()" aria-label="Toggle Theme">
          <svg class="light-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="5"></circle>
            <line x1="12" y1="1" x2="12" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="23"></line>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
            <line x1="1" y1="12" x2="3" y2="12"></line>
            <line x1="21" y1="12" x2="23" y2="12"></line>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
          </svg>
        </button>
        <div class="mobile-nav mobile-only">
          <button class="more-menu-toggle-btn" @click="toggleMobileMenu()" aria-label="Menu">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>
          <div id="more-menu" class="more-menu">
            <a href="/">首页</a>
            <a href="/stats">统计</a>
            <template x-if="$store.app.isAdmin"><a href="/settings">设置</a></template>
            <template x-if="!$store.app.isAdmin"><a href="/login">登录</a></template>
          </div>
        </div>
      </div>
    </div>
    <div class="controls-bar">
      <div class="search-container">
        <input type="text" class="search-input" placeholder="搜索视觉小说..." x-model="searchQuery" @input="handleSearch()">
      </div>
      <select class="sort-select" x-model="sortBy" @change="handleSortChange()">
        <option value="created_desc">最新录入</option>
        <option value="created_asc">最早录入</option>
        <option value="rating_desc">VNDB评分 ↓</option>
        <option value="rating_asc">VNDB评分 ↑</option>
        <option value="personal_desc">个人评分 ↓</option>
        <option value="personal_asc">个人评分 ↑</option>
      </select>
      <template x-if="$store.app.isAdmin">
        <button class="btn btn-primary" @click="openEdit()">+ 添加</button>
      </template>
    </div>
  </header>
  
  <!-- Main Content -->
  <main class="container">
    <template x-if="isLoading"><div class="loading"><div class="loading-spinner"></div></div></template>
    <template x-if="!isLoading && filteredList.length === 0">
      <div class="empty-state">
        <div class="empty-state-icon">📚</div>
        <div class="empty-state-title">暂无条目</div>
        <p class="text-muted">
          <template x-if="$store.app.isAdmin"><span>点击右上角"添加"按钮添加第一个视觉小说</span></template>
          <template x-if="!$store.app.isAdmin"><span>管理员尚未添加任何视觉小说</span></template>
        </p>
      </div>
    </template>
    <div class="cards-grid" x-show="!isLoading && filteredList.length > 0">
      <template x-for="vn in filteredList" :key="vn.id">
        <div class="vn-card" @click="openDetail(vn)">
           <div class="vn-card-image-wrapper">
             <img :src="vn.image || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 200 200%22%3E%3Crect fill=%22%23334155%22 width=%22200%22 height=%22200%22/%3E%3C/svg%3E'" :alt="vn.title" class="vn-card-image" @error="$event.target.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 200 200%22%3E%3Crect fill=%22%23334155%22 width=%22200%22 height=%22200%22/%3E%3C/svg%3E'">
             <span class="all-age-badge" x-show="vn.allAge" title="全年龄作品">全年龄</span>
           </div>
           <div class="vn-card-content">
             <h3 class="vn-card-title">
               <span x-text="vn.titleCn || vn.titleJa || vn.title"></span>
             </h3>
             <p class="vn-card-subtitle" x-text="vn.titleCn ? (vn.titleJa || vn.title) : ''" x-show="vn.titleCn"></p>
             <p class="vn-card-company" x-text="vn.developers?.[0] || ''" x-show="vn.developers?.[0]"></p>
             <hr class="card-divider">
             <div class="vn-card-meta">
               <div class="vn-card-rating">
                 <div class="stars-container">
                   <template x-for="i in 10" :key="i">
                     <span class="star" :class="{ empty: i > Math.round(vn.user?.personalRating || vn.rating || 0) }">★</span>
                   </template>
                 </div>
                 <span class="rating-value" x-text="(vn.user?.personalRating || vn.rating)?.toFixed(1) || '-'"></span>
               </div>
             </div>
           </div>
         </div>
      </template>
    </div>
  </main>
  
  <!-- Detail Modal -->
  <div class="modal-overlay" :class="{ active: showDetail }" @click.self="closeDetail()">
    <div class="modal" x-show="showDetail" x-transition>
      <template x-if="selectedVN">
        <div>
          <div class="modal-header">
            <h2 class="modal-title" x-text="selectedVN.user?.titleCn || selectedVN.vndb?.titleCn || selectedVN.vndb?.titleJa || selectedVN.vndb?.title || '详情'"></h2>
            <button class="modal-close" @click="closeDetail()">&times;</button>
          </div>
          <div class="modal-body">
            <div class="detail-header">
              <img :src="selectedVN.vndb?.image || ''" :alt="selectedVN.vndb?.title" class="detail-image" @error="$event.target.style.display='none'">
              <div class="detail-info">
                <h1 class="detail-title">
                  <span x-text="selectedVN.user?.titleCn || selectedVN.vndb?.titleCn || selectedVN.vndb?.titleJa || selectedVN.vndb?.title"></span>
                  <span class="all-age-badge" x-show="selectedVN.vndb?.allAge" title="全年龄作品">全年龄</span>
                </h1>
                <p class="detail-subtitle" x-text="(selectedVN.user?.titleCn || selectedVN.vndb?.titleCn) ? (selectedVN.vndb?.titleJa || selectedVN.vndb?.title) : ''" x-show="selectedVN.user?.titleCn || selectedVN.vndb?.titleCn"></p>
                <p class="detail-company" x-text="selectedVN.vndb?.developers?.join(', ') || ''" x-show="selectedVN.vndb?.developers?.length"></p>
                <div class="detail-stars-group" x-show="selectedVN.vndb?.rating">
                  <span class="detail-stars-label">VNDB评分</span>
                  <div class="detail-stars vndb-rating">
                    <div class="stars-container">
                      <template x-for="i in 10" :key="i">
                        <span class="star" :class="{ empty: i > Math.round(selectedVN.vndb?.rating || 0) }">★</span>
                      </template>
                    </div>
                    <span class="detail-rating-score" x-text="selectedVN.vndb?.rating?.toFixed(1) || '-'"></span>
                  </div>
                </div>
                <div class="detail-stars-group" x-show="selectedVN.user?.personalRating > 0">
                  <span class="detail-stars-label">个人评分</span>
                  <div class="detail-stars personal-rating">
                    <div class="stars-container">
                      <template x-for="i in 10" :key="i">
                        <span class="star" :class="{ empty: i > Math.round(selectedVN.user?.personalRating || 0) }">★</span>
                      </template>
                    </div>
                    <span class="detail-rating-score" x-text="selectedVN.user?.personalRating?.toFixed(1) || '-'"></span>
                  </div>
                </div>
                <div class="detail-meta">
                  <div class="detail-meta-item"><span class="detail-meta-label">游戏时长</span><span class="detail-meta-value" x-text="selectedVN.vndb?.length || '未知'"></span></div>
                  <div class="detail-meta-item"><span class="detail-meta-label">我的游玩时长</span><span class="detail-meta-value" x-text="selectedVN.user?.playTime || '未记录'"></span></div>
                </div>
              </div>
            </div>
            <div class="detail-tags" x-show="selectedVN.vndb?.tags?.length">
              <h4 class="detail-tags-title">标签</h4>
              <div class="detail-tags-list">
                <template x-for="tag in selectedVN.vndb?.tags?.slice(0, 10)" :key="tag">
                  <span class="detail-tag" x-text="tag"></span>
                </template>
              </div>
            </div>
            <div class="detail-review" x-show="selectedVN.user?.review">
              <h3 class="detail-review-title">简评</h3>
              <div class="detail-review-content" x-html="renderMarkdown(selectedVN.user?.review || '')"></div>
            </div>
          </div>
          <div class="modal-footer" x-show="$store.app.isAdmin">
            <button class="btn btn-secondary" @click="openEdit(selectedVN)">编辑</button>
            <button class="btn btn-danger" @click="deleteVN()">删除</button>
          </div>
        </div>
      </template>
    </div>
  </div>
  
  <!-- Edit Modal -->
  <div class="modal-overlay" :class="{ active: showEdit }" @click.self="closeEdit()">
    <div class="modal" x-show="showEdit" x-transition>
      <div class="modal-header">
        <h2 class="modal-title" x-text="editForm.isNew ? '添加条目' : '编辑条目'"></h2>
        <button class="modal-close" @click="closeEdit()">&times;</button>
      </div>
      <div class="modal-body">
        <form @submit.prevent="saveEdit()">
          <template x-if="editForm.isNew">
            <div class="form-group">
              <label class="form-label">VNDB ID *</label>
              <input type="text" class="form-input" x-model="editForm.vndbId" placeholder="例如: v17" required>
              <p class="form-hint">在VNDB网站上找到视觉小说的ID，格式为v+数字</p>
            </div>
          </template>
          <div class="form-group"><label class="form-label">中文标题</label><input type="text" class="form-input" x-model="editForm.titleCn" placeholder="游戏的中文译名"></div>
          <div class="form-group"><label class="form-label">个人评分</label><input type="number" class="form-input" x-model="editForm.personalRating" min="0" max="10" step="0.1" placeholder="0-10分"></div>
          <div class="form-group"><label class="form-label">游玩时长</label><input type="text" class="form-input" x-model="editForm.playTime" placeholder="例如: 25小时"></div>
          <div class="form-group"><label class="form-label">简评 (支持Markdown)</label><textarea class="form-input form-textarea" x-model="editForm.review" placeholder="写下你的感想..."></textarea></div>
          <div class="form-group"><label class="form-label">开始日期</label><input type="date" class="form-input" x-model="editForm.startDate"></div>
          <div class="form-group"><label class="form-label">完成日期</label><input type="date" class="form-input" x-model="editForm.finishDate"></div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" @click="closeEdit()">取消</button>
        <button class="btn btn-primary" @click="saveEdit()">保存</button>
      </div>
    </div>
  </div>
  
  <!-- Toast Container -->
  <div class="toast-container">
    <template x-for="toast in $store.app.toasts" :key="toast.id">
      <div class="toast" :class="'toast-' + toast.type"><span x-text="toast.message"></span></div>
    </template>
  </div>
</body>
</html>`;

// 登录页HTML
export const LOGIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>登录 - VN Shelf</title>
  <style>${CSS_CONTENT}</style>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <script>${JS_API}${JS_APP}</script>
</head>
<body x-data="loginPage()" x-init="init()">
  <!-- Progress Bar -->
  <div class="loading-progress-bar">
    <div class="progress-fill"></div>
  </div>
  
  <!-- Background Overlay -->
  <div class="background-overlay"></div>
  
  <div class="login-container">
    <div class="login-box">
      <h1 class="login-title">VN Shelf</h1>
      <template x-if="isInitialized === false">
        <form @submit.prevent="handleSubmit()">
          <div class="form-group">
            <label class="form-label">设置管理员密码 *</label>
            <input type="password" class="form-input" x-model="password" placeholder="至少6位密码" required minlength="6">
          </div>
          <div class="form-group">
            <label class="form-label">VNDB API Token (可选)</label>
            <input type="text" class="form-input" x-model="vndbApiToken" placeholder="可在设置中稍后配置">
            <p class="form-hint">在 <a href="https://vndb.org/u/tokens" target="_blank">VNDB</a> 获取API Token</p>
          </div>
          <p class="form-error" x-text="error" x-show="error"></p>
          <button type="submit" class="btn btn-primary" style="width: 100%" :disabled="isLoading">
            <span x-show="isLoading">初始化中...</span>
            <span x-show="!isLoading">初始化并登录</span>
          </button>
        </form>
      </template>
      <template x-if="isInitialized === true">
        <form @submit.prevent="handleSubmit()">
          <div class="form-group">
            <label class="form-label">管理员密码</label>
            <input type="password" class="form-input" x-model="password" placeholder="请输入密码" required autofocus>
          </div>
          <p class="form-error" x-text="error" x-show="error"></p>
          <button type="submit" class="btn btn-primary" style="width: 100%" :disabled="isLoading">
            <span x-show="isLoading">登录中...</span>
            <span x-show="!isLoading">登录</span>
          </button>
          <p class="text-center text-muted mt-4"><a href="/">返回首页</a></p>
        </form>
      </template>
      <template x-if="isInitialized === null"><div class="loading"><div class="loading-spinner"></div></div></template>
    </div>
  </div>
  <div class="toast-container">
    <template x-for="toast in $store.app?.toasts || []" :key="toast.id">
      <div class="toast" :class="'toast-' + toast.type"><span x-text="toast.message"></span></div>
    </template>
  </div>
</body>
</html>`;

// 设置页HTML
export const SETTINGS_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>设置 - VN Shelf</title>
  <style>${CSS_CONTENT}</style>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <script>${JS_API}${JS_APP}</script>
</head>
<body x-data="settingsPage()" x-init="init()">
  <!-- Progress Bar -->
  <div class="loading-progress-bar">
    <div class="progress-fill"></div>
  </div>
  
  <!-- Background Overlay -->
  <div class="background-overlay"></div>
  
  <!-- Header -->
  <header class="main-header">
    <div class="banner">
      <a href="/" class="banner-title">VN Shelf</a>
      <div class="header-actions">
        <nav class="banner-nav desktop-only">
          <a href="/">首页</a>
          <a href="/stats">统计</a>
          <a href="/settings" class="active">设置</a>
        </nav>
        <button class="theme-toggle-btn" @click="toggleTheme()" aria-label="Toggle Theme">
          <svg class="light-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="5"></circle>
            <line x1="12" y1="1" x2="12" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="23"></line>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
            <line x1="1" y1="12" x2="3" y2="12"></line>
            <line x1="21" y1="12" x2="23" y2="12"></line>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
          </svg>
        </button>
        <div class="mobile-nav mobile-only">
          <button class="more-menu-toggle-btn" @click="toggleMobileMenu()" aria-label="Menu">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>
          <div id="more-menu" class="more-menu">
            <a href="/">首页</a>
            <a href="/stats">统计</a>
            <a href="/settings">设置</a>
          </div>
        </div>
      </div>
    </div>
  </header>
  
  <!-- Main Content -->
  <main class="container">
    <h1 class="page-title">⚙️ 设置</h1>
    <section class="settings-section">
      <h2 class="settings-section-title">🔑 VNDB API</h2>
      <div class="form-group">
        <label class="form-label">API Token</label>
        <div style="display: flex; gap: 12px;">
          <input type="password" class="form-input" x-model="vndbApiToken" placeholder="输入新的API Token" style="flex: 1;">
          <button class="btn btn-primary" @click="saveVndbToken()" :disabled="isLoading">保存</button>
        </div>
        <p class="form-hint">当前状态: <span x-text="config.hasVndbApiToken ? '已配置' : '未配置'"></span> - 在 <a href="https://vndb.org/u/tokens" target="_blank">VNDB</a> 获取Token</p>
      </div>
    </section>
    <section class="settings-section">
      <h2 class="settings-section-title">🔐 管理员密码</h2>
      <div class="form-group"><label class="form-label">新密码</label><input type="password" class="form-input" x-model="newPassword" placeholder="至少6位密码" minlength="6"></div>
      <div class="form-group"><label class="form-label">确认密码</label><input type="password" class="form-input" x-model="confirmPassword" placeholder="再次输入密码"></div>
      <button class="btn btn-primary" @click="changePassword()" :disabled="isLoading">修改密码</button>
    </section>
    <section class="settings-section">
      <h2 class="settings-section-title">🔄 数据索引</h2>
      <template x-if="indexStatus">
        <div class="mb-4">
          <p class="text-muted">状态: <strong x-text="formatStatus(indexStatus.status)"></strong>
            <span x-show="indexStatus.status === 'running'"> - 进度: <span x-text="indexStatus.processed"></span>/<span x-text="indexStatus.total"></span></span>
          </p>
          <p class="text-muted" x-show="indexStatus.failed?.length > 0">失败: <span x-text="indexStatus.failed.join(', ')"></span></p>
        </div>
      </template>
      <div style="display: flex; gap: 12px; flex-wrap: wrap;">
        <button class="btn btn-primary" @click="startIndex()" :disabled="isLoading || indexStatus?.status === 'running'">批量更新索引</button>
        <button class="btn btn-secondary" @click="loadIndexStatus()">刷新状态</button>
      </div>
      <p class="form-hint mt-4">批量索引会从VNDB重新获取所有条目的信息，适用于VNDB数据更新后同步。</p>
    </section>
    <section class="settings-section">
      <h2 class="settings-section-title">💾 数据管理</h2>
      <div style="display: flex; gap: 12px; flex-wrap: wrap;">
        <button class="btn btn-secondary" @click="exportData()">导出数据</button>
        <label class="btn btn-secondary" style="cursor: pointer;">导入数据<input type="file" accept=".json" @change="importData($event)" style="display: none;"></label>
      </div>
      <p class="form-hint mt-4">导出的数据为JSON格式，可用于备份或迁移。导入时选择"合并"会保留现有数据，选择"替换"会清空现有数据。</p>
    </section>
    <section class="settings-section">
      <h2 class="settings-section-title">👤 账户</h2>
      <button class="btn btn-danger" @click="logout()">退出登录</button>
    </section>
  </main>
  <div class="toast-container">
    <template x-for="toast in $store.app?.toasts || []" :key="toast.id">
      <div class="toast" :class="'toast-' + toast.type"><span x-text="toast.message"></span></div>
    </template>
  </div>
</body>
</html>`;

// 统计页HTML
export const STATS_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>统计 - VN Shelf</title>
  <style>${CSS_CONTENT}</style>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <script>${JS_API}${JS_APP}</script>
</head>
<body x-data="statsPage()" x-init="init()">
  <!-- Progress Bar -->
  <div class="loading-progress-bar">
    <div class="progress-fill"></div>
  </div>
  
  <!-- Background Overlay -->
  <div class="background-overlay"></div>
  
  <!-- Header -->
  <header class="main-header">
    <div class="banner">
      <a href="/" class="banner-title">VN Shelf</a>
      <div class="header-actions">
        <nav class="banner-nav desktop-only">
          <a href="/">首页</a>
          <a href="/stats" class="active">统计</a>
          <template x-if="$store.app?.isAdmin"><a href="/settings">设置</a></template>
          <template x-if="!$store.app?.isAdmin"><a href="/login">登录</a></template>
        </nav>
        <button class="theme-toggle-btn" @click="toggleTheme()" aria-label="Toggle Theme">
          <svg class="light-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="5"></circle>
            <line x1="12" y1="1" x2="12" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="23"></line>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
            <line x1="1" y1="12" x2="3" y2="12"></line>
            <line x1="21" y1="12" x2="23" y2="12"></line>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
          </svg>
        </button>
        <div class="mobile-nav mobile-only">
          <button class="more-menu-toggle-btn" @click="toggleMobileMenu()" aria-label="Menu">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>
          <div id="more-menu" class="more-menu">
            <a href="/">首页</a>
            <a href="/stats">统计</a>
            <template x-if="$store.app?.isAdmin"><a href="/settings">设置</a></template>
            <template x-if="!$store.app?.isAdmin"><a href="/login">登录</a></template>
          </div>
        </div>
      </div>
    </div>
  </header>
  
  <!-- Main Content -->
  <main class="container">
    <h1 class="page-title">📊 游玩统计</h1>
    <template x-if="isLoading"><div class="loading"><div class="loading-spinner"></div></div></template>
    <template x-if="!isLoading && stats">
      <div>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value" x-text="stats.total || 0"></div>
            <div class="stat-label">总条目数</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" x-text="formatMinutes(stats.totalPlayTimeMinutes)"></div>
            <div class="stat-label">总游玩时长</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" x-text="formatRating(stats.avgRating)"></div>
            <div class="stat-label">平均VNDB评分</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" x-text="formatRating(stats.avgPersonalRating)"></div>
            <div class="stat-label">平均个人评分</div>
          </div>
        </div>
        <div class="settings-section">
          <h2 class="settings-section-title">关于统计</h2>
          <p class="text-muted">统计数据基于已录入的视觉小说条目计算得出。平均个人评分仅计算已评分的条目。</p>
        </div>
      </div>
    </template>
    <template x-if="!isLoading && !stats">
      <div class="empty-state">
        <div class="empty-state-icon">📊</div>
        <div class="empty-state-title">暂无统计数据</div>
        <p class="text-muted">添加视觉小说条目后即可查看统计</p>
      </div>
    </template>
  </main>
  <div class="toast-container">
    <template x-for="toast in $store.app?.toasts || []" :key="toast.id">
      <div class="toast" :class="'toast-' + toast.type"><span x-text="toast.message"></span></div>
    </template>
  </div>
</body>
</html>`;
