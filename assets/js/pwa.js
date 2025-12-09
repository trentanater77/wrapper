/**
 * PWA (Progressive Web App) Utilities
 * Handles service worker registration and install prompts
 */

(function(window) {
  'use strict';
  
  const PWA = {
    _deferredPrompt: null,
    _isInstalled: false,
    _swRegistration: null,
    
    /**
     * Initialize PWA features
     */
    init() {
      this._checkInstallState();
      this._registerServiceWorker();
      this._setupInstallPrompt();
      this._setupUpdateHandler();
      return this;
    },
    
    /**
     * Check if app is already installed
     * @private
     */
    _checkInstallState() {
      // Check if running in standalone mode (installed)
      if (window.matchMedia('(display-mode: standalone)').matches) {
        this._isInstalled = true;
        console.log('[PWA] Running as installed app');
      }
      
      // iOS Safari check
      if (navigator.standalone === true) {
        this._isInstalled = true;
        console.log('[PWA] Running as installed app (iOS)');
      }
    },
    
    /**
     * Register service worker
     * @private
     */
    async _registerServiceWorker() {
      if (!('serviceWorker' in navigator)) {
        console.log('[PWA] Service workers not supported');
        return;
      }
      
      try {
        this._swRegistration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/'
        });
        
        console.log('[PWA] Service worker registered:', this._swRegistration.scope);
        
        // Check for updates periodically
        setInterval(() => {
          this._swRegistration?.update();
        }, 60 * 60 * 1000); // Every hour
        
      } catch (error) {
        console.error('[PWA] Service worker registration failed:', error);
      }
    },
    
    /**
     * Setup install prompt handling
     * @private
     */
    _setupInstallPrompt() {
      // Capture the install prompt
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        this._deferredPrompt = e;
        console.log('[PWA] Install prompt captured');
        
        // Show install UI
        this._showInstallButton();
        
        // Dispatch custom event
        window.dispatchEvent(new CustomEvent('pwa-install-available'));
      });
      
      // Track successful installation
      window.addEventListener('appinstalled', () => {
        this._isInstalled = true;
        this._deferredPrompt = null;
        console.log('[PWA] App installed successfully');
        
        // Hide install UI
        this._hideInstallButton();
        
        // Show toast
        if (window.Loading?.toast) {
          window.Loading.toast('App installed! Find it on your home screen.', 'success');
        }
        
        // Dispatch custom event
        window.dispatchEvent(new CustomEvent('pwa-installed'));
      });
    },
    
    /**
     * Setup update handler
     * @private
     */
    _setupUpdateHandler() {
      if (!('serviceWorker' in navigator)) return;
      
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // New service worker has taken control
        console.log('[PWA] New service worker active');
        
        // Optionally reload for updates
        // window.location.reload();
      });
    },
    
    /**
     * Show install button in UI
     * @private
     */
    _showInstallButton() {
      // Check if install banner already exists
      if (document.getElementById('pwa-install-banner')) return;
      
      const banner = document.createElement('div');
      banner.id = 'pwa-install-banner';
      banner.innerHTML = `
        <div class="pwa-install-content">
          <div class="pwa-install-text">
            <strong>Install ChatSpheres</strong>
            <span>Add to home screen for the best experience</span>
          </div>
          <div class="pwa-install-actions">
            <button id="pwa-install-btn" class="pwa-install-accept">Install</button>
            <button id="pwa-install-dismiss" class="pwa-install-dismiss">Not now</button>
          </div>
        </div>
      `;
      
      // Add styles
      if (!document.getElementById('pwa-install-styles')) {
        const style = document.createElement('style');
        style.id = 'pwa-install-styles';
        style.textContent = `
          #pwa-install-banner {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: white;
            box-shadow: 0 -4px 20px rgba(0,0,0,0.15);
            z-index: 10000;
            animation: slide-up 0.3s ease-out;
            border-top: 3px solid var(--main-red, #e63946);
          }
          @keyframes slide-up {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
          }
          .pwa-install-content {
            max-width: 600px;
            margin: 0 auto;
            padding: 1rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 1rem;
          }
          .pwa-install-text {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
          }
          .pwa-install-text strong {
            font-weight: 700;
            color: var(--charcoal, #333);
          }
          .pwa-install-text span {
            font-size: 0.875rem;
            opacity: 0.7;
          }
          .pwa-install-actions {
            display: flex;
            gap: 0.5rem;
          }
          .pwa-install-accept {
            padding: 0.5rem 1rem;
            background: var(--main-red, #e63946);
            color: white;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
          }
          .pwa-install-accept:hover {
            background: #c62c3a;
          }
          .pwa-install-dismiss {
            padding: 0.5rem 1rem;
            background: transparent;
            color: var(--charcoal, #333);
            border: 1px solid var(--rose, #f8d7da);
            border-radius: 8px;
            font-weight: 500;
            cursor: pointer;
          }
          .pwa-install-dismiss:hover {
            background: var(--rose, #f8d7da);
          }
          @media (max-width: 480px) {
            .pwa-install-content {
              flex-direction: column;
              text-align: center;
            }
          }
        `;
        document.head.appendChild(style);
      }
      
      document.body.appendChild(banner);
      
      // Setup button handlers
      document.getElementById('pwa-install-btn')?.addEventListener('click', () => {
        this.promptInstall();
      });
      
      document.getElementById('pwa-install-dismiss')?.addEventListener('click', () => {
        this._hideInstallButton();
        // Don't show again for this session
        sessionStorage.setItem('pwa-install-dismissed', 'true');
      });
    },
    
    /**
     * Hide install button
     * @private
     */
    _hideInstallButton() {
      const banner = document.getElementById('pwa-install-banner');
      if (banner) {
        banner.style.animation = 'slide-up 0.3s ease-out reverse';
        setTimeout(() => banner.remove(), 300);
      }
    },
    
    /**
     * Check if app can be installed
     * @returns {boolean}
     */
    canInstall() {
      return !!this._deferredPrompt && !this._isInstalled;
    },
    
    /**
     * Check if app is installed
     * @returns {boolean}
     */
    isInstalled() {
      return this._isInstalled;
    },
    
    /**
     * Prompt user to install the app
     */
    async promptInstall() {
      if (!this._deferredPrompt) {
        console.log('[PWA] No install prompt available');
        return false;
      }
      
      // Show the prompt
      this._deferredPrompt.prompt();
      
      // Wait for user choice
      const { outcome } = await this._deferredPrompt.userChoice;
      console.log('[PWA] Install prompt outcome:', outcome);
      
      // Clear the prompt
      this._deferredPrompt = null;
      this._hideInstallButton();
      
      return outcome === 'accepted';
    },
    
    /**
     * Check for app updates
     */
    async checkForUpdates() {
      if (!this._swRegistration) return false;
      
      try {
        await this._swRegistration.update();
        return true;
      } catch (error) {
        console.error('[PWA] Update check failed:', error);
        return false;
      }
    },
    
    /**
     * Get service worker registration
     */
    getRegistration() {
      return this._swRegistration;
    },
    
    /**
     * Unregister service worker (for debugging)
     */
    async unregister() {
      if (this._swRegistration) {
        const success = await this._swRegistration.unregister();
        console.log('[PWA] Service worker unregistered:', success);
        return success;
      }
      return false;
    },
    
    /**
     * Request notification permission
     */
    async requestNotificationPermission() {
      if (!('Notification' in window)) {
        console.log('[PWA] Notifications not supported');
        return 'unsupported';
      }
      
      if (Notification.permission === 'granted') {
        return 'granted';
      }
      
      const permission = await Notification.requestPermission();
      console.log('[PWA] Notification permission:', permission);
      return permission;
    },
    
    /**
     * Send a local notification
     * @param {string} title - Notification title
     * @param {Object} options - Notification options
     */
    async notify(title, options = {}) {
      if (Notification.permission !== 'granted') {
        const permission = await this.requestNotificationPermission();
        if (permission !== 'granted') return null;
      }
      
      const defaultOptions = {
        icon: '/assets/icons/icon-192x192.png',
        badge: '/assets/icons/badge-72x72.png',
        vibrate: [100, 50, 100]
      };
      
      return new Notification(title, { ...defaultOptions, ...options });
    }
  };
  
  // Auto-initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => PWA.init());
  } else {
    PWA.init();
  }
  
  // Expose globally
  window.PWA = PWA;
  
})(window);
