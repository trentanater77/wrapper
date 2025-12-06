/**
 * ChatSpheres Ad Management System
 * Handles Google AdSense integration with subscription-based ad control
 * 
 * Plans WITHOUT ads (ad-free):
 * - ad_free_plus
 * - ad_free_premium  
 * - pro_bundle
 * 
 * Plans WITH ads:
 * - free
 * - host_pro
 */

(function() {
  'use strict';

  // Configuration
  const ADSENSE_PUBLISHER_ID = 'ca-pub-8986841930339200';
  
  // Plans that should NOT see ads
  const AD_FREE_PLANS = ['ad_free_plus', 'ad_free_premium', 'pro_bundle'];
  
  // State
  let userPlan = 'free';
  let adsEnabled = true;
  let adsInitialized = false;

  // ========================================
  // INITIALIZATION
  // ========================================

  /**
   * Initialize the ad system
   * Call this after the page loads and user auth is checked
   */
  async function initAds() {
    if (adsInitialized) return;
    
    console.log('🎯 Initializing ChatSpheres Ad System...');
    
    // Check user's subscription status
    await checkUserSubscription();
    
    // If user has ad-free plan, hide all ads and don't load AdSense
    if (!adsEnabled) {
      console.log('✨ Ad-free plan detected - hiding all ads');
      hideAllAds();
      return;
    }
    
    // Load AdSense script dynamically
    loadAdSenseScript();
    
    // Initialize ad slots
    initializeAdSlots();
    
    adsInitialized = true;
    console.log('✅ Ad system initialized');
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
   * Load the Google AdSense script
   */
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

  // ========================================
  // AD SLOT MANAGEMENT
  // ========================================

  /**
   * Initialize all ad slots on the page
   */
  function initializeAdSlots() {
    // Wait for AdSense to be ready
    setTimeout(() => {
      const adSlots = document.querySelectorAll('.chatspheres-ad');
      adSlots.forEach(slot => {
        if (!slot.dataset.adInitialized) {
          try {
            (window.adsbygoogle = window.adsbygoogle || []).push({});
            slot.dataset.adInitialized = 'true';
          } catch (e) {
            console.warn('Could not initialize ad slot:', e);
          }
        }
      });
    }, 1000);
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
   * Create a banner ad container
   * @param {string} position - 'header', 'footer', 'sidebar', 'inline'
   * @param {string} slotId - Optional specific ad slot ID from AdSense
   * @returns {HTMLElement} The ad container element
   */
  function createAdBanner(position = 'inline', slotId = null) {
    const container = document.createElement('div');
    container.className = `chatspheres-ad-container chatspheres-ad-${position}`;
    
    if (!adsEnabled) {
      container.style.display = 'none';
      return container;
    }

    // Create the AdSense ins element
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle chatspheres-ad';
    ins.style.display = 'block';
    
    // Set ad format based on position
    switch (position) {
      case 'header':
      case 'footer':
        ins.setAttribute('data-ad-format', 'horizontal');
        ins.setAttribute('data-full-width-responsive', 'true');
        break;
      case 'sidebar':
        ins.setAttribute('data-ad-format', 'vertical');
        break;
      case 'inline':
      default:
        ins.setAttribute('data-ad-format', 'auto');
        ins.setAttribute('data-full-width-responsive', 'true');
        break;
    }

    ins.setAttribute('data-ad-client', ADSENSE_PUBLISHER_ID);
    
    if (slotId) {
      ins.setAttribute('data-ad-slot', slotId);
    }

    container.appendChild(ins);
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

    // Initialize the ad
    setTimeout(() => {
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (e) {
        console.warn('Could not push ad:', e);
      }
    }, 100);

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
      if (adsEnabled && window.adsbygoogle) {
        try {
          (window.adsbygoogle = window.adsbygoogle || []).push({});
        } catch (e) {}
      }
    }
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
