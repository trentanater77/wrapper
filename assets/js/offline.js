/**
 * Offline Handling Utility
 * Provides graceful offline experience
 */

(function(window) {
  'use strict';
  
  const Offline = {
    _isOnline: navigator.onLine,
    _listeners: [],
    _offlineBanner: null,
    
    /**
     * Initialize offline handling
     */
    init() {
      // Listen for online/offline events
      window.addEventListener('online', () => this._handleOnline());
      window.addEventListener('offline', () => this._handleOffline());
      
      // Initial check
      if (!navigator.onLine) {
        this._handleOffline();
      }
      
      return this;
    },
    
    /**
     * Check if currently online
     */
    isOnline() {
      return this._isOnline;
    },
    
    /**
     * Register a callback for connectivity changes
     * @param {Function} callback - Called with { isOnline: boolean }
     */
    onChange(callback) {
      if (typeof callback === 'function') {
        this._listeners.push(callback);
      }
      return this;
    },
    
    /**
     * Handle coming online
     * @private
     */
    _handleOnline() {
      this._isOnline = true;
      this._hideOfflineBanner();
      this._notifyListeners();
      
      // Show toast notification
      if (window.Loading?.toast) {
        window.Loading.toast('You\'re back online!', 'success');
      }
    },
    
    /**
     * Handle going offline
     * @private
     */
    _handleOffline() {
      this._isOnline = false;
      this._showOfflineBanner();
      this._notifyListeners();
    },
    
    /**
     * Notify registered listeners
     * @private
     */
    _notifyListeners() {
      this._listeners.forEach(callback => {
        try {
          callback({ isOnline: this._isOnline });
        } catch (e) {
          console.error('Offline listener error:', e);
        }
      });
    },
    
    /**
     * Show offline banner
     * @private
     */
    _showOfflineBanner() {
      if (this._offlineBanner) return;
      
      this._offlineBanner = document.createElement('div');
      this._offlineBanner.className = 'offline-banner';
      this._offlineBanner.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="1" y1="1" x2="23" y2="23"/>
          <path d="M16.72 11.06A10.94 10.94 0 0119 12.55"/>
          <path d="M5 12.55a10.94 10.94 0 015.17-2.39"/>
          <path d="M10.71 5.05A16 16 0 0122.58 9"/>
          <path d="M1.42 9a15.91 15.91 0 014.7-2.88"/>
          <path d="M8.53 16.11a6 6 0 016.95 0"/>
          <line x1="12" y1="20" x2="12.01" y2="20"/>
        </svg>
        <span>You're offline. Some features may be unavailable.</span>
      `;
      
      // Add styles if not already present
      if (!document.getElementById('offline-styles')) {
        const style = document.createElement('style');
        style.id = 'offline-styles';
        style.textContent = `
          .offline-banner {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
            color: white;
            padding: 0.75rem 1rem;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            font-size: 0.9rem;
            font-weight: 600;
            z-index: 10001;
            animation: slide-down 0.3s ease-out;
          }
          @keyframes slide-down {
            from { transform: translateY(-100%); }
            to { transform: translateY(0); }
          }
          .offline-banner.hide {
            animation: slide-up 0.3s ease-in forwards;
          }
          @keyframes slide-up {
            from { transform: translateY(0); }
            to { transform: translateY(-100%); }
          }
          /* Adjust body padding when banner is shown */
          body.has-offline-banner {
            padding-top: 48px;
          }
          /* Offline mode for interactive elements */
          .offline-disabled {
            pointer-events: none !important;
            opacity: 0.5 !important;
            cursor: not-allowed !important;
          }
          .offline-disabled::after {
            content: 'Offline';
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            font-size: 0.75rem;
          }
        `;
        document.head.appendChild(style);
      }
      
      document.body.appendChild(this._offlineBanner);
      document.body.classList.add('has-offline-banner');
    },
    
    /**
     * Hide offline banner
     * @private
     */
    _hideOfflineBanner() {
      if (!this._offlineBanner) return;
      
      this._offlineBanner.classList.add('hide');
      setTimeout(() => {
        this._offlineBanner?.remove();
        this._offlineBanner = null;
        document.body.classList.remove('has-offline-banner');
      }, 300);
    },
    
    /**
     * Wrap a fetch call with offline handling
     * @param {Promise} fetchPromise - The fetch promise
     * @param {Object} options - offline message, fallback data
     */
    async fetch(fetchPromise, options = {}) {
      const { offlineMessage = 'You\'re offline', fallbackData = null } = options;
      
      if (!this._isOnline) {
        if (window.Loading?.toast) {
          window.Loading.toast(offlineMessage, 'warning');
        }
        if (fallbackData !== null) {
          return fallbackData;
        }
        throw new Error('Offline');
      }
      
      try {
        return await fetchPromise;
      } catch (error) {
        if (!navigator.onLine) {
          this._handleOffline();
          if (window.Loading?.toast) {
            window.Loading.toast('Connection lost. Please try again.', 'error');
          }
        }
        throw error;
      }
    },
    
    /**
     * Disable interactive elements when offline
     * @param {string} selector - CSS selector for elements to disable
     */
    disableWhenOffline(selector) {
      const elements = document.querySelectorAll(selector);
      
      const updateElements = () => {
        elements.forEach(el => {
          if (this._isOnline) {
            el.classList.remove('offline-disabled');
          } else {
            el.classList.add('offline-disabled');
          }
        });
      };
      
      updateElements();
      this.onChange(updateElements);
      
      return this;
    },
    
    /**
     * Cache data locally for offline access
     * @param {string} key - Storage key
     * @param {any} data - Data to cache
     */
    cache(key, data) {
      try {
        localStorage.setItem(`offline_cache_${key}`, JSON.stringify({
          data,
          timestamp: Date.now()
        }));
      } catch (e) {
        console.warn('Failed to cache data:', e);
      }
    },
    
    /**
     * Get cached data
     * @param {string} key - Storage key
     * @param {number} maxAge - Max age in ms (default 1 hour)
     */
    getCached(key, maxAge = 3600000) {
      try {
        const cached = localStorage.getItem(`offline_cache_${key}`);
        if (!cached) return null;
        
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp > maxAge) {
          localStorage.removeItem(`offline_cache_${key}`);
          return null;
        }
        
        return data;
      } catch (e) {
        return null;
      }
    },
    
    /**
     * Clear all offline cache
     */
    clearCache() {
      Object.keys(localStorage)
        .filter(key => key.startsWith('offline_cache_'))
        .forEach(key => localStorage.removeItem(key));
    }
  };
  
  // Auto-initialize and expose globally
  window.Offline = Offline.init();
  
})(window);
