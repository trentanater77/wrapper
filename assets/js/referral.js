/**
 * ChatSpheres Cross-Domain Referral Tracking
 * Stores referral codes in cookies that work across all subdomains
 */

(function() {
  'use strict';

  const REFERRAL_COOKIE_NAME = 'chatspheres_ref';
  const COOKIE_DOMAIN = '.chatspheres.com';
  const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

  /**
   * Set a cookie that works across all chatspheres.com subdomains
   */
  function setCrossDomainCookie(name, value, maxAge) {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    
    let cookieString = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
    
    // Only set domain for non-localhost
    if (!isLocalhost) {
      cookieString += `; domain=${COOKIE_DOMAIN}`;
    }
    
    // Add Secure flag for HTTPS
    if (window.location.protocol === 'https:') {
      cookieString += '; Secure';
    }
    
    document.cookie = cookieString;
    console.log('🍪 Set cross-domain cookie:', name, '=', value);
  }

  /**
   * Get a cookie value by name
   */
  function getCookie(name) {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [cookieName, cookieValue] = cookie.trim().split('=');
      if (cookieName === name) {
        return decodeURIComponent(cookieValue);
      }
    }
    return null;
  }

  /**
   * Delete a cookie
   */
  function deleteCookie(name) {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    
    let cookieString = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    
    if (!isLocalhost) {
      cookieString += `; domain=${COOKIE_DOMAIN}`;
    }
    
    document.cookie = cookieString;
    console.log('🗑️ Deleted cookie:', name);
  }

  /**
   * Save referral code (to both cookie and sessionStorage for redundancy)
   */
  function saveReferralCode(refCode) {
    if (!refCode) return;
    
    // Save to cross-domain cookie (PRIMARY)
    setCrossDomainCookie(REFERRAL_COOKIE_NAME, refCode, COOKIE_MAX_AGE);
    
    // Also save to sessionStorage as backup
    try {
      sessionStorage.setItem('chatspheres_referral_code', refCode);
    } catch (e) {
      console.log('SessionStorage not available');
    }
    
    console.log('📎 Referral code saved:', refCode);
  }

  /**
   * Get stored referral code (checks cookie first, then sessionStorage)
   */
  function getReferralCode() {
    // Check cookie first (cross-domain)
    let refCode = getCookie(REFERRAL_COOKIE_NAME);
    
    // Fallback to sessionStorage
    if (!refCode) {
      try {
        refCode = sessionStorage.getItem('chatspheres_referral_code');
      } catch (e) {}
    }
    
    return refCode;
  }

  /**
   * Clear referral code after successful signup
   */
  function clearReferralCode() {
    deleteCookie(REFERRAL_COOKIE_NAME);
    try {
      sessionStorage.removeItem('chatspheres_referral_code');
    } catch (e) {}
    console.log('🗑️ Referral code cleared');
  }

  /**
   * Track referral click
   */
  function trackReferralClick(refCode) {
    fetch('/.netlify/functions/track-referral', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'click', referralCode: refCode })
    }).catch(err => console.log('Referral click tracking:', err.message));
  }

  /**
   * Track referral signup
   */
  function trackReferralSignup(userId) {
    const refCode = getReferralCode();
    if (!refCode || !userId) return Promise.resolve();
    
    console.log('🔗 Tracking referral signup for code:', refCode);
    
    return fetch('/.netlify/functions/track-referral', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'signup',
        referralCode: refCode,
        referredUserId: userId
      })
    }).then(() => {
      clearReferralCode();
    }).catch(err => {
      console.log('Referral signup tracking failed:', err);
    });
  }

  /**
   * Get signup URL with referral code appended
   */
  function getSignupUrl(baseUrl) {
    const refCode = getReferralCode();
    if (!refCode) return baseUrl;
    
    const url = new URL(baseUrl, window.location.origin);
    url.searchParams.set('ref', refCode);
    return url.toString();
  }

  /**
   * Update all signup links on the page to include referral code
   */
  function updateSignupLinks() {
    const refCode = getReferralCode();
    if (!refCode) return;
    
    // Find all links to the signup page (including new /signup.html path)
    const signupLinks = document.querySelectorAll('a[href*="chatspheres.com/sign-up"], a[href*="/sign-up"], a[href*="/signup.html"], a[href*="/login.html"]');
    
    signupLinks.forEach(link => {
      const currentHref = link.getAttribute('href');
      if (currentHref && !currentHref.includes('ref=')) {
        try {
          const url = new URL(currentHref, window.location.origin);
          url.searchParams.set('ref', refCode);
          link.setAttribute('href', url.toString());
          console.log('📝 Updated signup link with ref code:', url.toString());
        } catch (e) {
          // If URL parsing fails, append manually
          const separator = currentHref.includes('?') ? '&' : '?';
          link.setAttribute('href', `${currentHref}${separator}ref=${encodeURIComponent(refCode)}`);
        }
      }
    });
  }

  /**
   * Initialize referral tracking
   */
  function init() {
    // Check for referral code in URL
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref');
    
    if (refCode) {
      // Save the referral code
      saveReferralCode(refCode);
      
      // Track the click
      trackReferralClick(refCode);
    }
    
    // Update signup links to include referral code
    updateSignupLinks();
    
    // Also update links after any DOM changes (for dynamically added content)
    const observer = new MutationObserver(() => {
      updateSignupLinks();
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Expose functions globally
  window.ChatSpheresReferral = {
    saveReferralCode,
    getReferralCode,
    clearReferralCode,
    trackReferralSignup,
    getSignupUrl,
    updateSignupLinks
  };

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
