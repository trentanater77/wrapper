/**
 * ChatSpheres Ad Management System v2.1
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
 * Ad Formats (Monetag Zones):
 * - Push Notifications (zone 10329017) - HTTPS required
 * - Vignette Banner (zone 10329015) - interstitial on page enter/exit
 * - In-Page Push (zone 10329140) - notification-style banners
 * - OnClick/Popunder (zone 10329543) - triggered on user click
 */

(function() {
  'use strict';

  // Monetag Configuration - All 4 zones
  const MONETAG_CONFIG = {
    pushNotifications: {
      zoneId: 10329017,
      domain: '3nbf4.com',
      scriptUrl: 'https://3nbf4.com/act/files/tag.min.js?z=10329017'
    },
    vignetteBanner: {
      zoneId: 10329015,
      scriptUrl: 'https://gizokraijaw.net/vignette.min.js'
    },
    inPagePush: {
      zoneId: 10329140,
      scriptUrl: 'https://nap5k.com/tag.min.js'
    },
    onClickPopunder: {
      zoneId: 10329543,
      scriptUrl: 'https://3nbf4.com/act/files/tag.min.js?z=10329543'
    }
  };
  
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
    
    // Load all Monetag scripts
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
   * Register Monetag service worker for Push Notifications
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
   * Load all Monetag ad scripts
   */
  function loadMonetagScripts() {
    console.log('📦 [ChatSpheres Ads] Loading Monetag scripts...');
    
    // 1. Push Notifications (zone 10329017) - requires HTTPS and service worker
    loadPushNotifications();
    
    // 2. Vignette Banner (zone 10329015) - interstitial ads
    loadVignetteBanner();
    
    // 3. In-Page Push (zone 10329140) - notification-style banners
    loadInPagePush();
    
    // 4. OnClick/Popunder (zone 10329543) - triggered on user clicks
    loadOnClickPopunder();
    
    console.log('✅ [ChatSpheres Ads] All ad scripts injected');
  }

  /**
   * Load Push Notifications script
   */
  function loadPushNotifications() {
    if (document.querySelector('script[data-monetag-push]')) return;
    
    try {
      const script = document.createElement('script');
      script.setAttribute('data-monetag-push', 'true');
      script.setAttribute('data-cfasync', 'false');
      script.async = true;
      script.src = MONETAG_CONFIG.pushNotifications.scriptUrl;
      script.onload = () => console.log('📱 [ChatSpheres Ads] Push Notifications loaded');
      script.onerror = () => console.warn('⚠️ Push Notifications script blocked or failed');
      document.head.appendChild(script);
    } catch (e) {
      console.error('Push Notifications script error:', e);
    }
  }

  /**
   * Load Vignette Banner script (interstitial)
   * Uses exact Monetag format for proper impression tracking
   */
  function loadVignetteBanner() {
    if (document.querySelector('script[data-monetag-vignette]')) return;
    
    try {
      // Use Monetag's exact script injection format
      (function(s) {
        s.setAttribute('data-monetag-vignette', 'true');
        s.dataset.zone = String(MONETAG_CONFIG.vignetteBanner.zoneId);
        s.src = MONETAG_CONFIG.vignetteBanner.scriptUrl;
        s.onload = function() { console.log('🎨 [ChatSpheres Ads] Vignette Banner loaded'); };
        s.onerror = function() { console.warn('⚠️ Vignette Banner script blocked or failed'); };
      })([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')));
    } catch (e) {
      console.error('Vignette Banner script error:', e);
    }
  }

  /**
   * Load In-Page Push script (notification-style banners)
   * Uses exact Monetag format for proper impression tracking
   */
  function loadInPagePush() {
    if (document.querySelector('script[data-monetag-inpage]')) return;
    
    try {
      // Use Monetag's exact script injection format
      (function(s) {
        s.setAttribute('data-monetag-inpage', 'true');
        s.dataset.zone = String(MONETAG_CONFIG.inPagePush.zoneId);
        s.src = MONETAG_CONFIG.inPagePush.scriptUrl;
        s.onload = function() { console.log('💬 [ChatSpheres Ads] In-Page Push loaded'); };
        s.onerror = function() { console.warn('⚠️ In-Page Push script blocked or failed'); };
      })([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')));
    } catch (e) {
      console.error('In-Page Push script error:', e);
    }
  }

  /**
   * Load OnClick/Popunder script
   */
  function loadOnClickPopunder() {
    if (document.querySelector('script[data-monetag-onclick]')) return;
    
    try {
      const script = document.createElement('script');
      script.setAttribute('data-monetag-onclick', 'true');
      script.setAttribute('data-cfasync', 'false');
      script.async = true;
      script.src = MONETAG_CONFIG.onClickPopunder.scriptUrl;
      script.onload = () => console.log('👆 [ChatSpheres Ads] OnClick/Popunder loaded');
      script.onerror = () => console.warn('⚠️ OnClick/Popunder script blocked or failed');
      document.head.appendChild(script);
    } catch (e) {
      console.error('OnClick/Popunder script error:', e);
    }
  }

  // ========================================
  // AD SLOT MANAGEMENT
  // ========================================

  /**
   * Initialize all ad slots on the page
   * For Monetag, most ad types are handled automatically via the service worker
   */
  function initializeAdSlots() {
    const adSlots = document.querySelectorAll('.chatspheres-ad');
    adSlots.forEach(slot => {
      if (!slot.dataset.adInitialized) {
        slot.dataset.adInitialized = 'true';
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
    getConfig: () => MONETAG_CONFIG,
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
