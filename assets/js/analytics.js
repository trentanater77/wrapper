/**
 * Simple Free Analytics
 * Tracks page views and events without external services
 */

(function(window) {
  'use strict';
  
  const Analytics = {
    _sessionId: null,
    _userId: null,
    _queue: [],
    _initialized: false,
    
    /**
     * Initialize analytics
     */
    init() {
      if (this._initialized) return this;
      this._initialized = true;
      
      // Generate or get session ID
      this._sessionId = this._getSessionId();
      
      // Track page view
      this.pageView();
      
      // Setup SPA navigation tracking
      this._setupNavigationTracking();
      
      // Flush queue on page unload
      window.addEventListener('beforeunload', () => {
        this._flush(true);
      });
      
      // Process queue periodically
      setInterval(() => this._flush(), 5000);
      
      return this;
    },
    
    /**
     * Set user ID for tracking
     * @param {string} userId
     */
    setUser(userId) {
      this._userId = userId;
    },
    
    /**
     * Track a page view
     * @param {string} page - Optional page override
     */
    pageView(page = null) {
      this.track('page_view', {
        page: page || window.location.pathname,
        referrer: document.referrer || null,
        title: document.title
      });
    },
    
    /**
     * Track a custom event
     * @param {string} eventType - Event type name
     * @param {Object} data - Event data
     */
    track(eventType, data = {}) {
      this._queue.push({
        eventType,
        page: window.location.pathname,
        referrer: document.referrer || null,
        userId: this._userId,
        sessionId: this._sessionId,
        data: {
          ...data,
          timestamp: Date.now(),
          url: window.location.href
        }
      });
      
      // Flush if queue is getting large
      if (this._queue.length >= 10) {
        this._flush();
      }
    },
    
    /**
     * Track button/link clicks
     * @param {string} label - Button label
     * @param {Object} data - Additional data
     */
    click(label, data = {}) {
      this.track('click', { label, ...data });
    },
    
    /**
     * Track form submissions
     * @param {string} formName - Form name
     * @param {Object} data - Additional data
     */
    formSubmit(formName, data = {}) {
      this.track('form_submit', { form: formName, ...data });
    },
    
    /**
     * Track errors
     * @param {string} message - Error message
     * @param {Object} data - Additional data
     */
    error(message, data = {}) {
      this.track('error', { message, ...data });
    },
    
    /**
     * Track conversions (signup, purchase, etc.)
     * @param {string} type - Conversion type
     * @param {Object} data - Conversion data
     */
    conversion(type, data = {}) {
      this.track('conversion', { type, ...data });
    },
    
    /**
     * Track timing (performance)
     * @param {string} label - What was timed
     * @param {number} duration - Duration in ms
     */
    timing(label, duration) {
      this.track('timing', { label, duration });
    },
    
    /**
     * Get or create session ID
     * @private
     */
    _getSessionId() {
      const key = 'cs_session_id';
      let sessionId = sessionStorage.getItem(key);
      
      if (!sessionId) {
        sessionId = 'ses_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
        sessionStorage.setItem(key, sessionId);
      }
      
      return sessionId;
    },
    
    /**
     * Setup SPA navigation tracking
     * @private
     */
    _setupNavigationTracking() {
      // Track pushState/replaceState
      const originalPushState = history.pushState;
      const originalReplaceState = history.replaceState;
      
      history.pushState = (...args) => {
        originalPushState.apply(history, args);
        this.pageView();
      };
      
      history.replaceState = (...args) => {
        originalReplaceState.apply(history, args);
        this.pageView();
      };
      
      // Track popstate (back/forward)
      window.addEventListener('popstate', () => {
        this.pageView();
      });
    },
    
    /**
     * Flush event queue to server
     * @private
     */
    async _flush(sync = false) {
      if (this._queue.length === 0) return;
      
      const events = [...this._queue];
      this._queue = [];
      
      // Send each event (could batch in future)
      for (const event of events) {
        try {
          const method = sync ? 'sendBeacon' : 'fetch';
          
          if (sync && navigator.sendBeacon) {
            navigator.sendBeacon(
              '/.netlify/functions/track-event',
              JSON.stringify(event)
            );
          } else {
            fetch('/.netlify/functions/track-event', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(event),
              keepalive: true
            }).catch(() => {}); // Ignore errors
          }
        } catch (e) {
          // Analytics should never break the app
        }
      }
    }
  };
  
  // Auto-initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Analytics.init());
  } else {
    Analytics.init();
  }
  
  // Expose globally
  window.Analytics = Analytics;
  
})(window);
