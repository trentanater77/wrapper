/**
 * ChatSpheres Ad Management System v2.0
 * Handles Monetag integration with subscription-based ad control
 * Updated: 2024-12-15
 * 
 * Plans WITHOUT ads (ad-free):
 * - ad_free_plus
 * - ad_free_premium  
 * - pro_bundle
 * 
 * Plans WITH ads:
 * - free
 * - host_pro
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
  const AD_FREE_PLANS = ['ad_free_plus', 'ad_free_premium', 'pro_bundle'];
  
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
   * Load Monetag ad scripts
   */
  function loadMonetagScripts() {
    console.log('📦 [ChatSpheres Ads] Loading Monetag scripts...');
    
    // Load Push Notifications script (exact format from Monetag)
    if (!document.querySelector('script[data-monetag-push]')) {
      try {
        const pushScript = document.createElement('script');
        pushScript.setAttribute('data-monetag-push', 'true');
        pushScript.setAttribute('data-cfasync', 'false');
        pushScript.async = true;
        pushScript.src = 'https://3nbf4.com/act/files/tag.min.js?z=10329017';
        pushScript.onload = () => console.log('📱 [ChatSpheres Ads] Push Notifications loaded');
        pushScript.onerror = () => console.warn('⚠️ Push script blocked or failed');
        document.head.appendChild(pushScript);
      } catch (e) {
        console.error('Push script error:', e);
      }
    }

    // Load Vignette Banner script (exact format from Monetag)
    if (!document.querySelector('script[data-monetag-vignette]')) {
      try {
        (function(s) {
          s.setAttribute('data-monetag-vignette', 'true');
          s.dataset.zone = '10329015';
          s.src = 'https://gizokraijaw.net/vignette.min.js';
          s.onload = function() { console.log('🎨 [ChatSpheres Ads] Vignette Banner loaded'); };
          s.onerror = function() { console.warn('⚠️ Vignette script blocked or failed'); };
        })([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')));
      } catch (e) {
        console.error('Vignette script error:', e);
      }
    }

    // Load In-Page Push script (exact format from Monetag)
    if (!document.querySelector('script[data-monetag-inpage]')) {
      try {
        (function(s) {
          s.setAttribute('data-monetag-inpage', 'true');
          s.dataset.zone = '10329140';
          s.src = 'https://nap5k.com/tag.min.js';
          s.onload = function() { console.log('💬 [ChatSpheres Ads] In-Page Push loaded'); };
          s.onerror = function() { console.warn('⚠️ In-Page Push script blocked or failed'); };
        })([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')));
      } catch (e) {
        console.error('In-Page Push script error:', e);
      }
    }
    
    console.log('✅ [ChatSpheres Ads] All ad scripts injected');
    
    // Start monitoring for ad elements and reposition them
    startAdRepositioning();
  }

  /**
   * Monitor for Monetag ad elements and reposition them away from navigation
   * This is AGGRESSIVE - we want menu to ALWAYS be accessible
   */
  function startAdRepositioning() {
    // Create a protective overlay for the menu button area
    function protectMenuArea() {
      const menuBtn = document.getElementById('video-menu-toggle');
      if (menuBtn) {
        // Ensure menu button has highest z-index
        menuBtn.style.setProperty('z-index', '999999', 'important');
        menuBtn.style.setProperty('position', 'relative', 'important');
        menuBtn.style.setProperty('pointer-events', 'auto', 'important');
      }
      
      // Protect the header area
      const header = document.querySelector('.video-header, header, .header');
      if (header) {
        header.style.setProperty('z-index', '500000', 'important');
        header.style.setProperty('position', 'relative', 'important');
      }
    }
    
    // Reposition any ads that appear in the top area (especially top-right menu area)
    function repositionAds() {
      protectMenuArea();
      
      // Find ALL fixed/absolute position elements that might be ads
      const allElements = document.querySelectorAll('body > div, body > iframe');
      
      allElements.forEach(el => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        
        // Skip known good elements
        const skipIds = ['video-interface', 'video-mobile-nav', 'auth-modal', 'landing-page', 'feedback-widget', 'feedback-modal'];
        const skipClasses = ['navigation', 'nav-container', 'header', 'video-header', 'modal', 'feedback'];
        
        if (skipIds.some(id => el.id === id || el.id?.includes(id))) return;
        if (skipClasses.some(cls => el.classList?.contains(cls) || el.className?.includes?.(cls))) return;
        if (el.id?.includes('nav') || el.id?.includes('menu') || el.id?.includes('modal')) return;
        if (el.className?.includes?.('nav') || el.className?.includes?.('menu') || el.className?.includes?.('modal')) return;
        
        // Check if element is positioned in a problematic area
        const isFixed = style.position === 'fixed';
        const isAbsolute = style.position === 'absolute';
        const isInTopArea = rect.top < 120; // Top 120px is navigation zone
        const isInRightArea = rect.right > window.innerWidth - 300; // Right 300px includes menu
        const hasHighZIndex = parseInt(style.zIndex) > 10000;
        
        // If it's fixed/absolute in the top-right corner with high z-index, it's likely an ad
        if ((isFixed || isAbsolute) && isInTopArea && (isInRightArea || hasHighZIndex)) {
          // Check if it looks like an ad (has iframes, images, or specific ad attributes)
          const hasAdContent = el.querySelector('iframe') || 
                              el.querySelector('img') || 
                              el.hasAttribute('data-zone') ||
                              el.innerHTML?.length > 100;
          
          if (hasAdContent || hasHighZIndex) {
            // FORCE move to bottom-right corner
            el.style.setProperty('top', 'auto', 'important');
            el.style.setProperty('bottom', '80px', 'important');
            el.style.setProperty('left', 'auto', 'important');
            el.style.setProperty('right', '20px', 'important');
            el.style.setProperty('max-width', '320px', 'important');
            el.style.setProperty('max-height', '150px', 'important');
            el.style.setProperty('z-index', '9999', 'important');
            el.style.setProperty('overflow', 'hidden', 'important');
            console.log('📍 [ChatSpheres Ads] Repositioned element to bottom:', el.id || el.className || 'anonymous');
          }
        }
        
        // Also check for iframes that might be covering the menu
        if (el.tagName === 'IFRAME') {
          const iframeRect = el.getBoundingClientRect();
          if (iframeRect.top < 100 && iframeRect.right > window.innerWidth - 300) {
            el.style.setProperty('top', 'auto', 'important');
            el.style.setProperty('bottom', '80px', 'important');
            el.style.setProperty('max-width', '320px', 'important');
            el.style.setProperty('z-index', '9999', 'important');
            console.log('📍 [ChatSpheres Ads] Repositioned iframe to bottom');
          }
        }
      });
      
      // Extra: Look for Monetag-specific elements by their script sources
      document.querySelectorAll('iframe[src*="monetag"], iframe[src*="3nbf4"], iframe[src*="nap5k"]').forEach(iframe => {
        iframe.style.setProperty('top', 'auto', 'important');
        iframe.style.setProperty('bottom', '80px', 'important');
        iframe.style.setProperty('left', 'auto', 'important');
        iframe.style.setProperty('right', '20px', 'important');
        iframe.style.setProperty('z-index', '9999', 'important');
      });
    }
    
    // Run immediately
    repositionAds();
    
    // Run every 500ms for the first 60 seconds (more aggressive)
    let checkCount = 0;
    const interval = setInterval(() => {
      repositionAds();
      checkCount++;
      if (checkCount >= 120) { // Stop after 60 seconds (120 * 500ms)
        clearInterval(interval);
        console.log('📍 [ChatSpheres Ads] Stopped frequent ad repositioning, switching to observer only');
      }
    }, 500);
    
    // Also run every 5 seconds indefinitely to catch lazy-loaded ads
    setInterval(repositionAds, 5000);
    
    // MutationObserver to catch new ads as they're added
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        if (mutation.addedNodes.length > 0) {
          // Run immediately and after a short delay (some ads take time to position)
          repositionAds();
          setTimeout(repositionAds, 100);
          setTimeout(repositionAds, 500);
        }
      });
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    
    // Also observe the document element for any changes
    observer.observe(document.documentElement, { childList: true, subtree: false });
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
    getZoneId: () => MONETAG_ZONE_ID,
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
