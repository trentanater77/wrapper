/**
 * ChatSpheres Ad Management System
 * Handles Monetag integration with subscription-based ad control
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
 * Note: Google AdSense code commented out for potential future use
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
    
    console.log('🎯 Initializing ChatSpheres Ad System (Monetag)...');
    
    // Check user's subscription status
    await checkUserSubscription();
    
    // If user has ad-free plan, hide all ads and don't load Monetag
    if (!adsEnabled) {
      console.log('✨ Ad-free plan detected - hiding all ads');
      hideAllAds();
      return;
    }
    
    // Register Monetag service worker
    await registerServiceWorker();
    
    // Load Monetag scripts
    loadMonetagScripts();
    
    adsInitialized = true;
    console.log('✅ Ad system initialized (Monetag)');
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
        console.log('📢 No auth available - showing ads (free user)');
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
        console.log('📢 No user logged in - showing ads');
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
    // Load Push Notifications script
    if (!document.querySelector('script[data-monetag-push]')) {
      const pushScript = document.createElement('script');
      pushScript.async = true;
      pushScript.setAttribute('data-monetag-push', 'true');
      pushScript.setAttribute('data-cfasync', 'false');
      pushScript.src = `https://${MONETAG_DOMAIN}/act/files/tag.min.js?z=${MONETAG_PUSH_ZONE_ID}`;
      pushScript.onerror = () => {
        console.warn('Monetag Push script failed to load (might be blocked by ad blocker)');
      };
      document.head.appendChild(pushScript);
      console.log('📱 Monetag Push Notifications script loaded');
    }

    // Load Vignette Banner script
    if (!document.querySelector('script[data-monetag-vignette]')) {
      const vignetteScript = document.createElement('script');
      vignetteScript.setAttribute('data-monetag-vignette', 'true');
      vignetteScript.dataset.zone = MONETAG_VIGNETTE_ZONE_ID;
      vignetteScript.src = 'https://gizokraijaw.net/vignette.min.js';
      vignetteScript.onerror = () => {
        console.warn('Monetag Vignette script failed to load (might be blocked by ad blocker)');
      };
      document.body.appendChild(vignetteScript);
      console.log('🎨 Monetag Vignette Banner script loaded');
    }

    // Load In-Page Push script (notification-style banner)
    if (!document.querySelector('script[data-monetag-inpage]')) {
      const inpageScript = document.createElement('script');
      inpageScript.setAttribute('data-monetag-inpage', 'true');
      inpageScript.dataset.zone = MONETAG_INPAGE_PUSH_ZONE_ID;
      inpageScript.src = 'https://nap5k.com/tag.min.js';
      inpageScript.onerror = () => {
        console.warn('Monetag In-Page Push script failed to load (might be blocked by ad blocker)');
      };
      document.body.appendChild(inpageScript);
      console.log('💬 Monetag In-Page Push script loaded');
    }
  }

  /* Google AdSense - Commented out for potential future use
  function loadAdSenseScript() {
    if (document.querySelector('script[src*="adsbygoogle"]')) {
      console.log('AdSense script already loaded');
      return;
    }

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_PUBLISHER_ID}`;
    script.crossOrigin = 'anonymous';
    script.onerror = () => {
      console.warn('AdSense script failed to load (might be blocked by ad blocker)');
      hideAllAds();
    };
    document.head.appendChild(script);
  }
  */

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
