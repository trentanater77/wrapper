/**
 * ChatSpheres Navigation
 * Handles the hamburger menu, scroll effects, and navigation state
 */

(function() {
  'use strict';

  // DOM Elements
  let menuToggle = null;
  let navMenu = null;
  let navOverlay = null;
  let navClose = null;
  let header = null;

  // State
  let isMenuOpen = false;
  let lastScrollY = 0;

  /**
   * Initialize navigation
   */
  function init() {
    // Cache DOM elements
    menuToggle = document.getElementById('menu-toggle');
    navMenu = document.getElementById('nav-menu');
    navOverlay = document.getElementById('nav-overlay');
    navClose = document.getElementById('nav-close');
    header = document.querySelector('.site-header');

    if (!menuToggle || !navMenu) {
      console.warn('Navigation elements not found');
      return;
    }

    // Set up event listeners
    setupEventListeners();
    
    // Mark current page as active
    markActiveNavLink();
    
    // Initialize scroll effects
    initScrollEffects();

    console.log('✅ Navigation initialized');
  }

  /**
   * Set up event listeners
   */
  function setupEventListeners() {
    // Toggle menu button
    menuToggle.addEventListener('click', toggleMenu);

    // Close menu when clicking overlay
    if (navOverlay) {
      navOverlay.addEventListener('click', closeMenu);
    }

    // Close menu when clicking close button
    if (navClose) {
      navClose.addEventListener('click', closeMenu);
    }

    // Close menu on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isMenuOpen) {
        closeMenu();
      }
    });

    // Close menu when clicking a nav link
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
      link.addEventListener('click', () => {
        // Small delay to allow navigation
        setTimeout(closeMenu, 100);
      });
    });

    // Handle window resize
    window.addEventListener('resize', handleResize);
  }

  /**
   * Toggle menu open/close
   */
  function toggleMenu() {
    if (isMenuOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  /**
   * Open the menu
   */
  function openMenu() {
    isMenuOpen = true;
    menuToggle.classList.add('active');
    navMenu.classList.add('active');
    if (navOverlay) navOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    // Focus trap for accessibility
    const firstFocusable = navMenu.querySelector('a, button');
    if (firstFocusable) firstFocusable.focus();
  }

  /**
   * Close the menu
   */
  function closeMenu() {
    isMenuOpen = false;
    menuToggle.classList.remove('active');
    navMenu.classList.remove('active');
    if (navOverlay) navOverlay.classList.remove('active');
    document.body.style.overflow = '';
    
    // Return focus to menu toggle
    menuToggle.focus();
  }

  /**
   * Handle window resize
   */
  function handleResize() {
    // Could add logic here if needed for different breakpoints
  }

  /**
   * Mark current page link as active
   */
  function markActiveNavLink() {
    const currentPath = window.location.pathname;
    const navLinks = document.querySelectorAll('.nav-link');

    navLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (!href) return;

      // Normalize paths for comparison
      const linkPath = href.replace(/^\//, '').replace(/\.html$/, '');
      const pagePath = currentPath.replace(/^\//, '').replace(/\.html$/, '');

      // Check for match
      let isMatch = 
        linkPath === pagePath ||
        (linkPath === '' && (pagePath === '' || pagePath === 'index')) ||
        (linkPath === 'index' && pagePath === '');
      
      // Handle forum pages - /f/* and /forums, /create-forum should highlight Forums nav
      if (linkPath === 'forums' && (
        pagePath.startsWith('f/') || 
        pagePath === 'forum' || 
        pagePath === 'create-forum'
      )) {
        isMatch = true;
      }

      if (isMatch) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }

  /**
   * Initialize scroll effects
   */
  function initScrollEffects() {
    if (!header) return;

    window.addEventListener('scroll', () => {
      const scrollY = window.scrollY;

      // Add shadow when scrolled
      if (scrollY > 10) {
        header.classList.add('scrolled');
      } else {
        header.classList.remove('scrolled');
      }

      lastScrollY = scrollY;
    }, { passive: true });
  }

  /**
   * Update user info in navigation
   * @param {Object} user - User object with name, email, gems
   */
  window.updateNavUser = function(user) {
    const userSection = document.getElementById('nav-user-section');
    const guestLinks = document.getElementById('nav-guest-links');
    const userInfo = document.getElementById('nav-user-info');
    const userName = document.getElementById('nav-user-name');
    const userGems = document.getElementById('nav-user-gems');
    const headerGemBadge = document.getElementById('header-gem-badge');

    if (!user) {
      // Show guest state
      if (userSection) userSection.style.display = 'none';
      if (guestLinks) guestLinks.style.display = 'flex';
      if (headerGemBadge) headerGemBadge.style.display = 'none';
      return;
    }

    // Show logged in state
    if (userSection) userSection.style.display = 'block';
    if (guestLinks) guestLinks.style.display = 'none';

    // Update user name
    const displayName = user.name || user.email?.split('@')[0] || 'User';
    if (userName) userName.textContent = displayName;

    // Update gems
    const gems = user.gems || 0;
    if (userGems) userGems.textContent = gems.toLocaleString();
    if (headerGemBadge) {
      headerGemBadge.style.display = 'flex';
      const gemCount = headerGemBadge.querySelector('.gem-count');
      if (gemCount) gemCount.textContent = gems.toLocaleString();
    }
  };

  /**
   * Show toast notification
   * @param {string} message - Message to display
   * @param {string} type - 'success', 'error', or default
   */
  window.showToast = function(message, type = '') {
    let toast = document.getElementById('site-toast');
    
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'site-toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }

    // Reset classes
    toast.className = 'toast';
    if (type === 'success') toast.classList.add('toast-success');
    if (type === 'error') toast.classList.add('toast-error');

    toast.textContent = message;
    
    // Show toast
    requestAnimationFrame(() => {
      toast.classList.add('active');
    });

    // Hide after delay
    setTimeout(() => {
      toast.classList.remove('active');
    }, 3000);
  };

  /**
   * Load feedback component
   * Adds the floating feedback button site-wide
   */
  function loadFeedbackComponent() {
    // Don't load on pages that have their own feedback (index.html video chat)
    if (window.location.pathname === '/index.html' && window.location.search.includes('room=')) {
      return;
    }
    
    // Check if already loaded
    if (document.getElementById('cs-feedback-script')) return;
    
    const script = document.createElement('script');
    script.id = 'cs-feedback-script';
    script.src = '/assets/js/feedback.js';
    script.async = true;
    document.body.appendChild(script);
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init();
      loadFeedbackComponent();
    });
  } else {
    init();
    loadFeedbackComponent();
  }
})();
