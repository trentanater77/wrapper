/**
 * Accessibility (a11y) JavaScript Utilities
 * Provides keyboard navigation, focus management, and screen reader announcements
 */

(function(window) {
  'use strict';
  
  const A11y = {
    /**
     * Initialize accessibility features
     */
    init() {
      this._addSkipLink();
      this._enhanceKeyboardNav();
      this._setupFocusManagement();
      this._setupLiveRegion();
      return this;
    },
    
    /**
     * Add skip link for keyboard users
     * @private
     */
    _addSkipLink() {
      // Check if skip link already exists
      if (document.querySelector('.skip-link')) return;
      
      const mainContent = document.querySelector('main, [role="main"], #main-content');
      if (!mainContent) return;
      
      // Ensure main has an ID
      if (!mainContent.id) {
        mainContent.id = 'main-content';
      }
      
      const skipLink = document.createElement('a');
      skipLink.href = `#${mainContent.id}`;
      skipLink.className = 'skip-link';
      skipLink.textContent = 'Skip to main content';
      document.body.insertBefore(skipLink, document.body.firstChild);
    },
    
    /**
     * Enhance keyboard navigation
     * @private
     */
    _enhanceKeyboardNav() {
      // Handle Escape key for modals/dialogs
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this._handleEscape();
        }
      });
      
      // Arrow key navigation for lists and menus
      document.addEventListener('keydown', (e) => {
        const target = e.target;
        const parent = target.closest('[role="listbox"], [role="menu"], [role="tablist"]');
        
        if (!parent) return;
        
        const items = Array.from(parent.querySelectorAll(
          '[role="option"], [role="menuitem"], [role="tab"]'
        ));
        const currentIndex = items.indexOf(target);
        
        if (currentIndex === -1) return;
        
        let newIndex;
        switch (e.key) {
          case 'ArrowDown':
          case 'ArrowRight':
            e.preventDefault();
            newIndex = (currentIndex + 1) % items.length;
            break;
          case 'ArrowUp':
          case 'ArrowLeft':
            e.preventDefault();
            newIndex = (currentIndex - 1 + items.length) % items.length;
            break;
          case 'Home':
            e.preventDefault();
            newIndex = 0;
            break;
          case 'End':
            e.preventDefault();
            newIndex = items.length - 1;
            break;
          default:
            return;
        }
        
        if (newIndex !== undefined) {
          items[newIndex].focus();
          if (parent.getAttribute('role') === 'tablist') {
            items[newIndex].click();
          }
        }
      });
    },
    
    /**
     * Handle Escape key presses
     * @private
     */
    _handleEscape() {
      // Close modals
      const openModal = document.querySelector('.modal.show, [role="dialog"][aria-hidden="false"]');
      if (openModal) {
        const closeBtn = openModal.querySelector('[data-dismiss="modal"], .modal-close, .close-btn');
        if (closeBtn) closeBtn.click();
        return;
      }
      
      // Close dropdowns
      const openDropdown = document.querySelector('.dropdown.show, [aria-expanded="true"]');
      if (openDropdown) {
        openDropdown.setAttribute('aria-expanded', 'false');
        openDropdown.focus();
      }
    },
    
    /**
     * Setup focus management
     * @private
     */
    _setupFocusManagement() {
      // Track last focused element before modal opens
      document.addEventListener('click', (e) => {
        const modalTrigger = e.target.closest('[data-toggle="modal"], [data-modal-target]');
        if (modalTrigger) {
          this._lastFocusedElement = document.activeElement;
        }
      });
    },
    
    /**
     * Create live region for announcements
     * @private
     */
    _setupLiveRegion() {
      if (document.getElementById('a11y-announcer')) return;
      
      const announcer = document.createElement('div');
      announcer.id = 'a11y-announcer';
      announcer.setAttribute('role', 'status');
      announcer.setAttribute('aria-live', 'polite');
      announcer.setAttribute('aria-atomic', 'true');
      announcer.className = 'sr-only';
      document.body.appendChild(announcer);
    },
    
    /**
     * Announce a message to screen readers
     * @param {string} message - Message to announce
     * @param {string} priority - 'polite' or 'assertive'
     */
    announce(message, priority = 'polite') {
      const announcer = document.getElementById('a11y-announcer');
      if (!announcer) return;
      
      announcer.setAttribute('aria-live', priority);
      announcer.textContent = '';
      
      // Small delay to ensure announcement
      setTimeout(() => {
        announcer.textContent = message;
      }, 100);
    },
    
    /**
     * Trap focus within an element (for modals)
     * @param {HTMLElement} container - Container element
     * @returns {Function} - Call to release trap
     */
    trapFocus(container) {
      if (!container) return () => {};
      
      const focusableSelectors = [
        'button:not([disabled])',
        'a[href]',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
      ];
      
      const focusable = container.querySelectorAll(focusableSelectors.join(', '));
      const firstFocusable = focusable[0];
      const lastFocusable = focusable[focusable.length - 1];
      
      // Store original active element
      const originalFocus = document.activeElement;
      
      // Focus first element
      if (firstFocusable) {
        firstFocusable.focus();
      }
      
      const handleKeydown = (e) => {
        if (e.key !== 'Tab') return;
        
        if (e.shiftKey) {
          // Shift+Tab
          if (document.activeElement === firstFocusable) {
            e.preventDefault();
            lastFocusable?.focus();
          }
        } else {
          // Tab
          if (document.activeElement === lastFocusable) {
            e.preventDefault();
            firstFocusable?.focus();
          }
        }
      };
      
      container.addEventListener('keydown', handleKeydown);
      container.setAttribute('data-focus-trap', 'true');
      
      // Return function to release trap
      return () => {
        container.removeEventListener('keydown', handleKeydown);
        container.removeAttribute('data-focus-trap');
        originalFocus?.focus();
      };
    },
    
    /**
     * Setup tab panel behavior
     * @param {HTMLElement} tablist - The tablist element
     */
    setupTabs(tablist) {
      if (!tablist) return;
      
      const tabs = tablist.querySelectorAll('[role="tab"]');
      
      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          // Deselect all tabs
          tabs.forEach(t => {
            t.setAttribute('aria-selected', 'false');
            t.setAttribute('tabindex', '-1');
          });
          
          // Select clicked tab
          tab.setAttribute('aria-selected', 'true');
          tab.setAttribute('tabindex', '0');
          
          // Show associated panel
          const panelId = tab.getAttribute('aria-controls');
          if (panelId) {
            const panels = tablist.closest('.tabs')?.querySelectorAll('[role="tabpanel"]') || 
                          document.querySelectorAll('[role="tabpanel"]');
            panels.forEach(panel => {
              panel.hidden = panel.id !== panelId;
            });
          }
          
          // Announce change
          this.announce(`${tab.textContent} tab selected`);
        });
      });
      
      // Setup initial state
      const selectedTab = tablist.querySelector('[aria-selected="true"]') || tabs[0];
      if (selectedTab) {
        selectedTab.setAttribute('tabindex', '0');
        const panelId = selectedTab.getAttribute('aria-controls');
        if (panelId) {
          document.querySelectorAll('[role="tabpanel"]').forEach(panel => {
            panel.hidden = panel.id !== panelId;
          });
        }
      }
    },
    
    /**
     * Make a button accessible
     * @param {HTMLElement} element - Element to enhance
     * @param {Object} options - label, expanded, pressed, etc.
     */
    enhanceButton(element, options = {}) {
      if (!element) return;
      
      const { label, expanded, pressed, controls, describedBy } = options;
      
      if (label) {
        element.setAttribute('aria-label', label);
      }
      
      if (expanded !== undefined) {
        element.setAttribute('aria-expanded', String(expanded));
      }
      
      if (pressed !== undefined) {
        element.setAttribute('aria-pressed', String(pressed));
      }
      
      if (controls) {
        element.setAttribute('aria-controls', controls);
      }
      
      if (describedBy) {
        element.setAttribute('aria-describedby', describedBy);
      }
      
      // Add role if not a button element
      if (element.tagName !== 'BUTTON') {
        element.setAttribute('role', 'button');
        element.setAttribute('tabindex', '0');
        
        // Handle keyboard activation
        element.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            element.click();
          }
        });
      }
    },
    
    /**
     * Add aria-describedby to form inputs
     * @param {HTMLElement} input - Input element
     * @param {string} description - Description text
     */
    describeInput(input, description) {
      if (!input || !description) return;
      
      let descId = input.getAttribute('aria-describedby');
      
      if (!descId) {
        descId = `desc-${input.id || Math.random().toString(36).substr(2, 9)}`;
        
        const descElement = document.createElement('span');
        descElement.id = descId;
        descElement.className = 'sr-only';
        descElement.textContent = description;
        
        input.parentNode?.insertBefore(descElement, input.nextSibling);
        input.setAttribute('aria-describedby', descId);
      }
    },
    
    /**
     * Mark an input as invalid with error message
     * @param {HTMLElement} input - Input element
     * @param {string} errorMessage - Error message
     */
    setInputError(input, errorMessage) {
      if (!input) return;
      
      input.setAttribute('aria-invalid', 'true');
      
      let errorId = `error-${input.id || Math.random().toString(36).substr(2, 9)}`;
      let errorEl = document.getElementById(errorId);
      
      if (!errorEl) {
        errorEl = document.createElement('div');
        errorEl.id = errorId;
        errorEl.className = 'error-message';
        errorEl.setAttribute('role', 'alert');
        input.parentNode?.insertBefore(errorEl, input.nextSibling);
        input.setAttribute('aria-describedby', errorId);
      }
      
      errorEl.textContent = errorMessage;
      this.announce(errorMessage, 'assertive');
    },
    
    /**
     * Clear input error
     * @param {HTMLElement} input - Input element
     */
    clearInputError(input) {
      if (!input) return;
      
      input.setAttribute('aria-invalid', 'false');
      input.removeAttribute('aria-invalid');
      
      const errorId = input.getAttribute('aria-describedby');
      if (errorId) {
        const errorEl = document.getElementById(errorId);
        if (errorEl?.classList.contains('error-message')) {
          errorEl.remove();
          input.removeAttribute('aria-describedby');
        }
      }
    },
    
    /**
     * Get preferred reduced motion setting
     * @returns {boolean}
     */
    prefersReducedMotion() {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    },
    
    /**
     * Get preferred color scheme
     * @returns {'light' | 'dark'}
     */
    prefersColorScheme() {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
  };
  
  // Auto-initialize and expose globally
  window.A11y = A11y.init();
  
})(window);
