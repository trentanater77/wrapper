/**
 * Loading States JavaScript Utility
 * Provides functions for managing loading states across the app
 */

(function(window) {
  'use strict';
  
  const Loading = {
    // Toast notification system
    _toastContainer: null,
    
    /**
     * Show page loader
     */
    showPageLoader() {
      let loader = document.getElementById('page-loader');
      if (!loader) {
        loader = document.createElement('div');
        loader.id = 'page-loader';
        loader.className = 'page-loader';
        loader.innerHTML = `
          <div class="page-loader-content">
            <svg class="page-loader-logo" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
              <circle cx="24" cy="32" r="18" stroke="#e63946" stroke-width="4" fill="none"/>
              <circle cx="40" cy="32" r="18" stroke="#e63946" stroke-width="4" fill="none"/>
            </svg>
            <div class="spinner"></div>
            <p class="page-loader-text">Loading...</p>
          </div>
        `;
        document.body.appendChild(loader);
      }
      loader.classList.remove('hidden');
    },
    
    /**
     * Hide page loader
     */
    hidePageLoader() {
      const loader = document.getElementById('page-loader');
      if (loader) {
        loader.classList.add('hidden');
      }
    },
    
    /**
     * Show loading state for a button
     * @param {HTMLElement} btn - The button element
     * @param {string} loadingText - Optional text to show while loading
     */
    buttonLoading(btn, loadingText = '') {
      if (!btn) return;
      btn._originalText = btn.textContent;
      btn._originalHTML = btn.innerHTML;
      btn.classList.add('btn-loading');
      btn.disabled = true;
      if (loadingText) {
        btn.textContent = loadingText;
      }
    },
    
    /**
     * Remove loading state from a button
     * @param {HTMLElement} btn - The button element
     */
    buttonReset(btn) {
      if (!btn) return;
      btn.classList.remove('btn-loading');
      btn.disabled = false;
      if (btn._originalHTML) {
        btn.innerHTML = btn._originalHTML;
      } else if (btn._originalText) {
        btn.textContent = btn._originalText;
      }
    },
    
    /**
     * Show inline content loader
     * @param {HTMLElement} container - Container to show loader in
     * @param {string} message - Loading message
     */
    showContentLoader(container, message = 'Loading...') {
      if (!container) return;
      container.innerHTML = `
        <div class="content-loader">
          <div class="spinner"></div>
          <p class="content-loader-text">${this._escapeHtml(message)}</p>
        </div>
      `;
    },
    
    /**
     * Show empty state
     * @param {HTMLElement} container - Container to show state in
     * @param {Object} options - title, text, icon
     */
    showEmptyState(container, options = {}) {
      if (!container) return;
      const { title = 'Nothing here yet', text = '', icon = '' } = options;
      container.innerHTML = `
        <div class="empty-state">
          ${icon ? `<div class="empty-state-icon">${icon}</div>` : ''}
          <h3 class="empty-state-title">${this._escapeHtml(title)}</h3>
          ${text ? `<p class="empty-state-text">${this._escapeHtml(text)}</p>` : ''}
        </div>
      `;
    },
    
    /**
     * Show error state
     * @param {HTMLElement} container - Container to show state in
     * @param {Object} options - title, text, onRetry
     */
    showErrorState(container, options = {}) {
      if (!container) return;
      const { title = 'Something went wrong', text = '', onRetry = null } = options;
      const retryId = 'retry-' + Date.now();
      container.innerHTML = `
        <div class="error-state">
          <svg class="error-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <h3 class="error-state-title">${this._escapeHtml(title)}</h3>
          ${text ? `<p>${this._escapeHtml(text)}</p>` : ''}
          ${onRetry ? `<button class="error-state-retry" id="${retryId}">Try Again</button>` : ''}
        </div>
      `;
      if (onRetry) {
        document.getElementById(retryId)?.addEventListener('click', onRetry);
      }
    },
    
    /**
     * Create skeleton loader HTML
     * @param {string} type - 'card', 'forum', 'room', 'text', 'list'
     * @param {number} count - Number of skeletons
     */
    skeleton(type = 'card', count = 1) {
      let html = '';
      for (let i = 0; i < count; i++) {
        switch (type) {
          case 'forum':
            html += `
              <div class="skeleton-forum-card">
                <div class="skeleton skeleton-avatar"></div>
                <div class="skeleton-forum-content">
                  <div class="skeleton skeleton-title"></div>
                  <div class="skeleton skeleton-text"></div>
                  <div class="skeleton skeleton-text"></div>
                </div>
              </div>
            `;
            break;
          case 'room':
            html += `
              <div class="skeleton-room-card">
                <div class="skeleton skeleton-title"></div>
                <div class="skeleton skeleton-text"></div>
                <div style="display:flex;gap:0.5rem;margin-top:1rem;">
                  <div class="skeleton skeleton-button"></div>
                  <div class="skeleton skeleton-button"></div>
                </div>
              </div>
            `;
            break;
          case 'text':
            html += `
              <div class="skeleton skeleton-text"></div>
              <div class="skeleton skeleton-text"></div>
              <div class="skeleton skeleton-text" style="width:70%"></div>
            `;
            break;
          case 'list':
            html += `
              <div style="display:flex;gap:1rem;padding:0.75rem 0;border-bottom:1px solid var(--rose,#f8d7da);">
                <div class="skeleton skeleton-avatar" style="width:40px;height:40px;"></div>
                <div style="flex:1;">
                  <div class="skeleton skeleton-text" style="width:40%;"></div>
                  <div class="skeleton skeleton-text" style="width:60%;"></div>
                </div>
              </div>
            `;
            break;
          default:
            html += `
              <div class="skeleton-card">
                <div class="skeleton skeleton-image"></div>
                <div class="skeleton skeleton-title"></div>
                <div class="skeleton skeleton-text"></div>
                <div class="skeleton skeleton-text"></div>
              </div>
            `;
        }
      }
      return html;
    },
    
    /**
     * Show toast notification
     * @param {string} message - Message to display
     * @param {string} type - 'success', 'error', 'warning', 'info'
     * @param {number} duration - Duration in ms
     */
    toast(message, type = 'info', duration = 3000) {
      if (!this._toastContainer) {
        this._toastContainer = document.createElement('div');
        this._toastContainer.className = 'toast-container';
        document.body.appendChild(this._toastContainer);
      }
      
      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      
      // Add icon based on type
      let icon = '';
      switch (type) {
        case 'success':
          icon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
          break;
        case 'error':
          icon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
          break;
        case 'warning':
          icon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
          break;
        default:
          icon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
      }
      
      toast.innerHTML = icon + this._escapeHtml(message);
      this._toastContainer.appendChild(toast);
      
      // Auto remove
      setTimeout(() => {
        toast.classList.add('hide');
        setTimeout(() => toast.remove(), 300);
      }, duration);
    },
    
    /**
     * Show progress bar
     * @param {HTMLElement} container - Container element
     * @param {number} progress - Progress percentage (0-100), or -1 for indeterminate
     */
    showProgress(container, progress = -1) {
      if (!container) return;
      const isIndeterminate = progress < 0;
      container.innerHTML = `
        <div class="progress-bar ${isIndeterminate ? 'progress-bar-indeterminate' : ''}">
          <div class="progress-bar-fill" style="width: ${isIndeterminate ? '30' : progress}%"></div>
        </div>
      `;
    },
    
    /**
     * Update progress bar
     * @param {HTMLElement} container - Container element
     * @param {number} progress - Progress percentage (0-100)
     */
    updateProgress(container, progress) {
      const fill = container?.querySelector('.progress-bar-fill');
      if (fill) {
        fill.style.width = `${progress}%`;
      }
    },
    
    /**
     * Escape HTML to prevent XSS
     * @private
     */
    _escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  };
  
  // Expose globally
  window.Loading = Loading;
  
})(window);
