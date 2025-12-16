/**
 * ChatSpheres Ad Management System v2.0
 * Handles Monetag integration with subscription-based ad control
 * Updated: 2024-12-15
 * 
 * Plans WITHOUT ads (ad-free):
 * - ad_free_plus
 * - ad_free_premium
 * - host_pro
 * - pro_bundle
 *
 * Plans WITH ads:
 * - free
 * 
 * Ad Formats:
 * - Push Notifications (zone 10329017)
 * - Vignette Banner (zone 10329015)
 * - In-Page Push (zone 10329140)
 */

(function() {
  'use strict';

  // Monetag Configuration
  const MONETAG_PUSH_ZONE_ID = 10329017;
  const MONETAG_VIGNETTE_ZONE_ID = 10329015;
  const MONETAG_INPAGE_PUSH_ZONE_ID = 10329140;
  const MONETAG_DOMAIN = '3nbf4.com';
  
  // Google AdSense - Commented out for potential future use
  // const ADSENSE_PUBLISHER_ID = 'ca-pub-8986841930339200';
  
  // Plans that should NOT see ads
  // NOTE: Keep this aligned with your product promises; this is enforced client-side.
  const AD_FREE_PLANS = ['ad_free_plus', 'ad_free_premium', 'host_pro', 'pro_bundle'];
  
  // State
  let userPlan = 'free';
  let adsEnabled = true;
  let adsInitialized = false;
  let serviceWorkerRegistered = false;

  // ========================================
  // INITIALIZATION
  // ========================================

  /**
   * Initialize the ad system
   * Call this after the page loads and user auth is checked
   */
  async function initAds() {
    if (adsInitialized) return;
    
    console.log('🎯 [ChatSpheres Ads] Starting initialization...');
    
    // Check user's subscription status
    await checkUserSubscription();
    
    // If user has ad-free plan, hide all ads and don't load Monetag
    if (!adsEnabled) {
      console.log('✨ [ChatSpheres Ads] Ad-free plan detected - hiding all ads');
      hideAllAds();
      return;
    }
    
    console.log('📢 [ChatSpheres Ads] User should see ads, loading Monetag...');
    
    // Load Monetag scripts FIRST (don't wait for service worker)
    loadMonetagScripts();
    
    // Register Monetag service worker (for push notifications)
    registerServiceWorker();
    
    adsInitialized = true;
    console.log('✅ [ChatSpheres Ads] Initialization complete!');
  }

  /**
   * Check user's subscription to determine if they should see ads
   */
  async function checkUserSubscription() {
    try {
      // Try to get user from Supabase
      const config = window.__CHATSPHERES_CONFIG__ || {};
      const supabaseConfig = config.supabase || {};
      
      if (!window.supabase || !supabaseConfig.url || !supabaseConfig.anonKey) {
        console.log('📢 [ChatSpheres Ads] No auth available - showing ads (free user)');
        adsEnabled = true;
        return;
      }

      // Check for existing session
      let userId = null;
      
      // Try to get from global supabaseClient if available
      if (window.supabaseClient) {
        try {
          const { data: { session } } = await window.supabaseClient.auth.getSession();
          if (session?.user) {
            userId = session.user.id;
          }
        } catch (e) {
          console.log('Could not get session from supabaseClient');
        }
      }

      // Fallback: use the already-initialized app user (works even when storage is blocked)
      if (!userId) {
        const appUserId = window.currentUserData?.userId;
        if (typeof appUserId === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(appUserId)) {
          userId = appUserId;
        }
      }
      
      // Try localStorage/cookies for user ID
      if (!userId) {
        // Check various storage locations for session data
        const storageKeys = [
          'sb-' + supabaseConfig.url.split('//')[1]?.split('.')[0] + '-auth-token',
          'supabase.auth.token'
        ];
        
        for (const key of storageKeys) {
          try {
            const data = localStorage.getItem(key);
            if (data) {
              const parsed = JSON.parse(data);
              userId = parsed?.user?.id || parsed?.currentSession?.user?.id;
              if (userId) break;
            }
          } catch (e) {}
        }
      }

      if (!userId) {
        console.log('📢 [ChatSpheres Ads] No user logged in - showing ads');
        adsEnabled = true;
        return;
      }

      // Fetch subscription status
      const response = await fetch(`/.netlify/functions/get-subscription?userId=${userId}`);
      const data = await response.json();
      
      if (data.plan) {
        userPlan = data.plan;
        adsEnabled = !AD_FREE_PLANS.includes(userPlan);
        console.log(`👤 User plan: ${userPlan}, Ads enabled: ${adsEnabled}`);
      }
    } catch (error) {
      console.log('Could not check subscription, defaulting to showing ads:', error);
      adsEnabled = true;
    }
  }

  /**
   * Register Monetag service worker
   */
  async function registerServiceWorker() {
    if (serviceWorkerRegistered) return;
    
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/'
        });
        console.log('📱 Monetag Service Worker registered:', registration.scope);
        serviceWorkerRegistered = true;
      } catch (error) {
        console.warn('Monetag Service Worker registration failed:', error);
      }
    } else {
      console.warn('Service Workers not supported in this browser');
    }
  }

  /**
   * Inject aggressive CSS to override Monetag inline styles
   */
  function injectProtectionCSS() {
    if (document.getElementById('chatspheres-ad-protection')) return;
    
    const style = document.createElement('style');
    style.id = 'chatspheres-ad-protection';
    style.textContent = `
      /* NUCLEAR OPTION: Force ALL fixed elements in top-right to bottom */
      /* This uses very high specificity to override inline styles */
      
      body > div:not(#video-interface):not(#video-mobile-nav):not(#auth-modal):not(#landing-page):not(#feedback-widget):not(#feedback-modal):not(#nav-menu):not(#nav-overlay):not([id*="nav"]):not([id*="menu"]):not([id*="modal"]):not([class*="nav"]):not([class*="menu"]):not([class*="modal"]):not([class*="header"]) {
        /* If this element ends up being fixed in the top area, move it */
      }
      
      /* Menu buttons - ALWAYS on top */
      #video-menu-toggle,
      #menu-toggle,
      .menu-toggle,
      button[aria-label="Toggle menu"],
      button[aria-label*="menu" i] {
        z-index: 999999 !important;
        position: relative !important;
        pointer-events: auto !important;
        isolation: isolate !important;
      }
      
      /* Headers - very high z-index */
      header,
      .header,
      .video-header,
      .site-header,
      nav.main-nav {
        z-index: 500000 !important;
        position: relative !important;
        isolation: isolate !important;
      }
      
      /* Navigation overlays - highest z-index when open */
      #video-mobile-nav,
      #nav-overlay,
      #nav-menu,
      .mobile-nav,
      .nav-overlay {
        z-index: 1000000 !important;
      }
      
      /* Any element marked as repositioned by our JS */
      [data-repositioned="true"] {
        top: auto !important;
        bottom: 100px !important;
        left: auto !important;
        right: 20px !important;
        max-width: 320px !important;
        max-height: 120px !important;
        z-index: 9999 !important;
      }
    `;
    document.head.appendChild(style);
    console.log('🛡️ [ChatSpheres Ads] Protection CSS injected');
  }

  /**
   * Detect browser for compatibility logging
   */
  function detectBrowser() {
    const ua = navigator.userAgent;
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari';
    if (ua.includes('Edg')) return 'Edge';
    if (ua.includes('Chrome')) return 'Chrome';
    return 'Unknown';
  }

  /**
   * Load a script with retry logic for cross-browser compatibility
   */
  function loadScript(src, attributes, onSuccess, onError, retries = 2) {
    const script = document.createElement('script');
    
    // Set attributes
    Object.keys(attributes).forEach(key => {
      if (key === 'data') {
        Object.keys(attributes.data).forEach(dataKey => {
          script.dataset[dataKey] = attributes.data[dataKey];
        });
      } else {
        script.setAttribute(key, attributes[key]);
      }
    });
    
    // Cross-browser compatibility settings
    script.async = true;
    script.defer = false;
    // Note: Do NOT set crossOrigin - Monetag scripts don't support CORS preflight
    script.src = src;
    
    script.onload = function() {
      if (onSuccess) onSuccess();
    };
    
    script.onerror = function(e) {
      // Only log on final failure to reduce console noise
      if (retries > 0) {
        setTimeout(() => {
          loadScript(src, attributes, onSuccess, onError, retries - 1);
        }, 1000);
      } else {
        // Final failure - check if it's a known browser blocking issue
        const browser = detectBrowser();
        if (browser === 'Firefox' || browser === 'Safari') {
          console.info(`ℹ️ [ChatSpheres Ads] Ad script blocked by ${browser} privacy protections (expected)`);
        }
        if (onError) onError(e);
      }
    };
    
    // Insert into head for best compatibility (Monetag recommendation)
    if (document.head) {
      document.head.appendChild(script);
    } else if (document.documentElement) {
      document.documentElement.appendChild(script);
    } else {
      document.body.appendChild(script);
    }
    
    return script;
  }

  /**
   * Load Monetag ad scripts with cross-browser compatibility
   * Follows Monetag best practices for Firefox, Safari, Chrome, Edge
   */
  function loadMonetagScripts() {
    const browser = detectBrowser();
    console.log(`📦 [ChatSpheres Ads] Loading Monetag scripts... (Browser: ${browser})`);
    
    // First inject our protection CSS
    injectProtectionCSS();
    
    // Small delay to ensure DOM is fully ready (helps Safari)
    setTimeout(() => {
      
      // Load Push Notifications script
      if (!document.querySelector('script[data-monetag-push]')) {
        loadScript(
          'https://3nbf4.com/act/files/tag.min.js?z=' + MONETAG_PUSH_ZONE_ID,
          { 
            'data-monetag-push': 'true',
            'data-cfasync': 'false'
          },
          () => console.log('📱 [ChatSpheres Ads] Push Notifications loaded'),
          () => {} // Silent - already logged by loadScript
        );
      }

      // Load Vignette Banner script (slight delay for sequencing)
      setTimeout(() => {
        if (!document.querySelector('script[data-monetag-vignette]')) {
          loadScript(
            'https://gizokraijaw.net/vignette.min.js?z=' + MONETAG_VIGNETTE_ZONE_ID,
            { 
              'data-monetag-vignette': 'true',
              'data': { zone: MONETAG_VIGNETTE_ZONE_ID.toString() }
            },
            () => console.log('🎨 [ChatSpheres Ads] Vignette Banner loaded'),
            () => {} // Silent - already logged by loadScript
          );
        }
      }, 100);

      // Load In-Page Push script (slight delay for sequencing)
      setTimeout(() => {
        if (!document.querySelector('script[data-monetag-inpage]')) {
          loadScript(
            'https://nap5k.com/tag.min.js?z=' + MONETAG_INPAGE_PUSH_ZONE_ID,
            { 
              'data-monetag-inpage': 'true',
              'data': { zone: MONETAG_INPAGE_PUSH_ZONE_ID.toString() }
            },
            () => console.log('💬 [ChatSpheres Ads] In-Page Push loaded'),
            () => {} // Silent - already logged by loadScript
          );
        }
      }, 200);
      
    }, 50); // Initial delay for DOM readiness
    
    console.log('✅ [ChatSpheres Ads] Ad scripts queued for loading');
    
    // Start monitoring for ad elements and reposition them
    setTimeout(startAdRepositioning, 500);
  }

  /**
   * Monitor for Monetag ad elements and reposition them away from navigation
   * This is ULTRA AGGRESSIVE - we want menu to ALWAYS be accessible
   */
  function startAdRepositioning() {
    // Known safe element IDs and classes - never move these
    const SAFE_IDS = ['video-interface', 'video-mobile-nav', 'auth-modal', 'landing-page', 
                      'feedback-widget', 'feedback-modal', 'nav-menu', 'nav-overlay',
                      'rating-modal', 'tip-modal', 'spectator-container',
                      'tip-animation-overlay', 'tip-particles-container', 'tip-gif-display',
                      'tip-announcement', 'tip-announcement-amount', 'tip-announcement-sender', 'tip-announcement-message',
                      'waiting-overlay', 'loading-overlay', 'video-container',
                      'local-video', 'remote-video', 'chat-container', 'controls',
                      'participant', 'spectator', 'room-info', 'timer'];
    const SAFE_CLASSES = ['navigation', 'nav-container', 'header', 'video-header', 
                          'modal', 'feedback', 'tooltip', 'dropdown',
                          'bg-circles', 'bg-pattern', 'bg-',
                          'overlay', 'loading', 'waiting', 'video', 'container',
                          'participant', 'spectator', 'controls', 'chat'];
    
    // Create a protective overlay for the menu button area
    function protectMenuArea() {
      // Protect all menu buttons
      const menuButtons = document.querySelectorAll('#video-menu-toggle, #menu-toggle, .menu-toggle, .hamburger, [aria-label*="menu"]');
      menuButtons.forEach(btn => {
        btn.style.setProperty('z-index', '999999', 'important');
        btn.style.setProperty('position', 'relative', 'important');
        btn.style.setProperty('pointer-events', 'auto', 'important');
      });
      
      // Protect all headers
      const headers = document.querySelectorAll('.video-header, header, .header, .site-header');
      headers.forEach(header => {
        header.style.setProperty('z-index', '500000', 'important');
        header.style.setProperty('position', 'relative', 'important');
      });
    }
    
    // Check if element is safe (not an ad)
    function isSafeElement(el) {
      if (!el) return true; // If no element, don't touch it
      
      const id = el.id || '';
      const className = el.className?.toString?.() || el.className || '';
      const style = el.getAttribute('style') || '';
      
      // Check against safe lists
      if (SAFE_IDS.some(safeId => id === safeId || id.includes(safeId))) return true;
      if (SAFE_CLASSES.some(safeCls => className.includes(safeCls))) return true;
      
      // Additional safe patterns
      if (id.includes('nav') || id.includes('menu') || id.includes('modal') || id.includes('header')) return true;
      if (className.includes('nav') || className.includes('menu') || className.includes('modal') || className.includes('header')) return true;
      
      // Fullscreen elements (modals) have top:0 and bottom:0 - NEVER touch these
      if (style.includes('top:0') && style.includes('bottom:0')) return true;
      if (style.includes('top: 0') && style.includes('bottom: 0')) return true;
      
      return false;
    }
    
    // Force move an element to bottom-right
    function moveToBottom(el, reason) {
      el.style.setProperty('top', 'auto', 'important');
      el.style.setProperty('bottom', '100px', 'important');
      el.style.setProperty('left', 'auto', 'important');
      el.style.setProperty('right', '20px', 'important');
      el.style.setProperty('max-width', '320px', 'important');
      el.style.setProperty('max-height', '120px', 'important');
      el.style.setProperty('z-index', '9999', 'important');
      el.style.setProperty('overflow', 'hidden', 'important');
      el.dataset.repositioned = 'true';
      console.log('📍 [ChatSpheres Ads] Moved to bottom:', reason, el.id || el.className?.toString?.()?.slice(0,50) || 'anon');
    }
    
    // Main repositioning function
    function repositionAds() {
      protectMenuArea();
      
      // Strategy 1: Find ALL fixed elements and check if they're in the danger zone
      document.querySelectorAll('body > *').forEach(el => {
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') return;
        if (el.dataset.repositioned === 'true') return;
        if (isSafeElement(el)) return;
        
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        
        const isFixed = style.position === 'fixed';
        const isAbsolute = style.position === 'absolute';
        const zIndex = parseInt(style.zIndex) || 0;
        
        // Danger zone: top 100px, especially top-right
        const inTopZone = rect.top >= -10 && rect.top < 100;
        const inRightZone = rect.right > window.innerWidth - 350;
        const coversTopRight = inTopZone && inRightZone;
        const hasHighZ = zIndex > 10000;
        
        // If fixed/absolute in danger zone with suspicious z-index
        if ((isFixed || isAbsolute) && (coversTopRight || (inTopZone && hasHighZ))) {
          // Make sure it's not empty
          if (el.offsetWidth > 10 && el.offsetHeight > 10) {
            moveToBottom(el, 'top-zone');
          }
        }
        
        // Also catch elements with very high z-index that might cover menu
        if ((isFixed || isAbsolute) && hasHighZ && rect.top < 150) {
          if (el.offsetWidth > 10 && el.offsetHeight > 10) {
            moveToBottom(el, 'high-z');
          }
        }
      });
      
      // Strategy 2: Target iframes specifically (ads often use iframes)
      document.querySelectorAll('iframe').forEach(iframe => {
        if (iframe.dataset.repositioned === 'true') return;
        
        const rect = iframe.getBoundingClientRect();
        const style = window.getComputedStyle(iframe);
        const isFixed = style.position === 'fixed';
        
        // Check parent too
        const parent = iframe.parentElement;
        const parentStyle = parent ? window.getComputedStyle(parent) : null;
        const parentFixed = parentStyle?.position === 'fixed';
        
        if ((isFixed || parentFixed) && rect.top < 100 && rect.right > window.innerWidth - 350) {
          if (parentFixed && parent && !isSafeElement(parent)) {
            moveToBottom(parent, 'iframe-parent');
          } else if (isFixed) {
            moveToBottom(iframe, 'iframe');
          }
        }
        
        // Also check for Monetag-specific iframe sources
        const src = iframe.src || '';
        if (src.includes('monetag') || src.includes('3nbf4') || src.includes('nap5k') || src.includes('gizokraijaw')) {
          const container = iframe.closest('div[style*="fixed"]') || iframe.parentElement;
          if (container && !isSafeElement(container)) {
            moveToBottom(container, 'monetag-iframe');
          }
        }
      });
      
      // Strategy 3: Look for dynamically added divs with inline fixed positioning
      document.querySelectorAll('div[style*="position: fixed"], div[style*="position:fixed"]').forEach(div => {
        if (div.dataset.repositioned === 'true') return;
        if (isSafeElement(div)) return;
        
        const rect = div.getBoundingClientRect();
        if (rect.top < 100 && rect.width > 50 && rect.height > 30) {
          moveToBottom(div, 'inline-fixed');
        }
      });
      
      // Strategy 4: Elements with onclick or data attributes suggesting ads
      document.querySelectorAll('[data-zone], [onclick*="click"], [onclick*="track"]').forEach(el => {
        if (el.dataset.repositioned === 'true') return;
        if (isSafeElement(el)) return;
        
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        
        if ((style.position === 'fixed' || style.position === 'absolute') && rect.top < 100) {
          moveToBottom(el, 'data-zone');
        }
      });
    }
    
    // Run immediately
    repositionAds();
    
    // Run every 200ms for first 30 seconds (very aggressive)
    let fastCheckCount = 0;
    const fastInterval = setInterval(() => {
      repositionAds();
      fastCheckCount++;
      if (fastCheckCount >= 150) { // 150 * 200ms = 30 seconds
        clearInterval(fastInterval);
        console.log('📍 [ChatSpheres Ads] Completed fast repositioning phase');
      }
    }, 200);
    
    // Then every 2 seconds indefinitely
    setInterval(repositionAds, 2000);
    
    // MutationObserver for immediate response to new elements
    const observer = new MutationObserver((mutations) => {
      let shouldCheck = false;
      mutations.forEach(mutation => {
        if (mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1 && node.tagName !== 'SCRIPT') {
              shouldCheck = true;
            }
          });
        }
        // Also watch for style changes
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
          shouldCheck = true;
        }
      });
      
      if (shouldCheck) {
        repositionAds();
        setTimeout(repositionAds, 50);
        setTimeout(repositionAds, 200);
        setTimeout(repositionAds, 500);
      }
    });
    
    observer.observe(document.body, { 
      childList: true, 
      subtree: true,
      attributes: true,
      attributeFilter: ['style']
    });
    
    observer.observe(document.documentElement, { childList: true, subtree: false });
    
    console.log('🛡️ [ChatSpheres Ads] Menu protection active');
  }

  // ========================================
  // AD SLOT MANAGEMENT
  // ========================================

  /**
   * Initialize all ad slots on the page
   * For Monetag, most ad types are handled automatically via the service worker
   */
  function initializeAdSlots() {
    // Monetag handles ad placement automatically through the service worker
    // and the tag script. Banner ads can still be placed manually if needed.
    const adSlots = document.querySelectorAll('.chatspheres-ad');
    adSlots.forEach(slot => {
      if (!slot.dataset.adInitialized) {
        slot.dataset.adInitialized = 'true';
        // Monetag ads are primarily push-based, but we can add banner containers
      }
    });
  }

  /**
   * Hide all ad containers on the page
   */
  function hideAllAds() {
    // Hide ad containers
    const adContainers = document.querySelectorAll('.chatspheres-ad-container, .chatspheres-ad, .ad-container');
    adContainers.forEach(container => {
      container.style.display = 'none';
      container.setAttribute('aria-hidden', 'true');
    });

    // Add class to body for CSS-based hiding
    document.body.classList.add('ads-hidden');
    document.body.classList.remove('ads-visible');
    
    // Unregister service worker for ad-free users
    if ('serviceWorker' in navigator && serviceWorkerRegistered) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(registration => {
          if (registration.active?.scriptURL?.includes('sw.js')) {
            registration.unregister();
            console.log('📱 Monetag Service Worker unregistered for ad-free user');
          }
        });
      });
    }
  }

  /**
   * Show all ad containers (for users with ads)
   */
  function showAllAds() {
    const adContainers = document.querySelectorAll('.chatspheres-ad-container, .chatspheres-ad, .ad-container');
    adContainers.forEach(container => {
      container.style.display = '';
      container.removeAttribute('aria-hidden');
    });

    document.body.classList.add('ads-visible');
    document.body.classList.remove('ads-hidden');
  }

  // ========================================
  // AD CREATION HELPERS
  // ========================================

  /**
   * Create a banner ad container for Monetag
   * @param {string} position - 'header', 'footer', 'sidebar', 'inline'
   * @returns {HTMLElement} The ad container element
   */
  function createAdBanner(position = 'inline') {
    const container = document.createElement('div');
    container.className = `chatspheres-ad-container chatspheres-ad-${position}`;
    
    if (!adsEnabled) {
      container.style.display = 'none';
      return container;
    }

    // For Monetag, most ads are handled via the service worker (push notifications)
    // Banner ads require additional zone configuration from Monetag dashboard
    const adDiv = document.createElement('div');
    adDiv.className = 'chatspheres-ad monetag-ad';
    adDiv.style.display = 'block';
    adDiv.style.width = '100%';
    
    container.appendChild(adDiv);
    return container;
  }

  /**
   * Insert a banner ad at a specific location
   * @param {string} selector - CSS selector for the target element
   * @param {string} position - 'before', 'after', 'prepend', 'append'
   * @param {string} adPosition - 'header', 'footer', 'sidebar', 'inline'
   */
  function insertAd(selector, position = 'after', adPosition = 'inline') {
    if (!adsEnabled) return null;

    const target = document.querySelector(selector);
    if (!target) {
      console.warn(`Ad target not found: ${selector}`);
      return null;
    }

    const adContainer = createAdBanner(adPosition);
    
    switch (position) {
      case 'before':
        target.parentNode.insertBefore(adContainer, target);
        break;
      case 'after':
        target.parentNode.insertBefore(adContainer, target.nextSibling);
        break;
      case 'prepend':
        target.insertBefore(adContainer, target.firstChild);
        break;
      case 'append':
        target.appendChild(adContainer);
        break;
    }

    return adContainer;
  }

  // ========================================
  // PUBLIC API
  // ========================================

  // Expose functions globally
  window.ChatSpheresAds = {
    init: initAds,
    isAdFree: () => !adsEnabled,
    getUserPlan: () => userPlan,
    hideAllAds: hideAllAds,
    showAllAds: showAllAds,
    createAdBanner: createAdBanner,
    insertAd: insertAd,
    refresh: () => {
      // Monetag handles ad refresh automatically
      console.log('Monetag ads refresh automatically');
    },
    // Monetag-specific
    getZoneId: () => ({
      push: MONETAG_PUSH_ZONE_ID,
      vignette: MONETAG_VIGNETTE_ZONE_ID,
      inpage: MONETAG_INPAGE_PUSH_ZONE_ID
    }),
    isServiceWorkerRegistered: () => serviceWorkerRegistered
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // Delay to allow auth to initialize first
      setTimeout(initAds, 500);
    });
  } else {
    setTimeout(initAds, 500);
  }

})();
