/**
 * Image Optimization Utility
 * Handles lazy loading, responsive images, and error fallbacks
 */

(function(window) {
  'use strict';
  
  const ImageOptimizer = {
    _observer: null,
    _placeholderSvg: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 200'%3E%3Crect fill='%23f8d7da' width='300' height='200'/%3E%3Ctext fill='%23e63946' font-family='sans-serif' font-size='14' x='50%25' y='50%25' text-anchor='middle' dy='.3em'%3ELoading...%3C/text%3E%3C/svg%3E`,
    
    /**
     * Initialize image optimization
     */
    init() {
      this._setupLazyLoading();
      this._setupErrorHandling();
      this._optimizeExistingImages();
      return this;
    },
    
    /**
     * Setup Intersection Observer for lazy loading
     * @private
     */
    _setupLazyLoading() {
      if (!('IntersectionObserver' in window)) {
        // Fallback: load all images immediately
        this._loadAllImages();
        return;
      }
      
      this._observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            this._loadImage(entry.target);
            this._observer.unobserve(entry.target);
          }
        });
      }, {
        rootMargin: '100px 0px', // Start loading 100px before visible
        threshold: 0.01
      });
      
      // Observe all lazy images
      document.querySelectorAll('img[data-src], img[loading="lazy"]').forEach(img => {
        if (img.dataset.src) {
          this._observer.observe(img);
        }
      });
      
      // Watch for dynamically added images
      this._setupMutationObserver();
    },
    
    /**
     * Setup mutation observer for dynamic images
     * @private
     */
    _setupMutationObserver() {
      const mutationObserver = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) {
              // Check if it's an image
              if (node.tagName === 'IMG' && node.dataset.src) {
                this._observer?.observe(node);
              }
              // Check for images inside the added node
              node.querySelectorAll?.('img[data-src]').forEach(img => {
                this._observer?.observe(img);
              });
            }
          });
        });
      });
      
      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    },
    
    /**
     * Load an image
     * @private
     */
    _loadImage(img) {
      const src = img.dataset.src;
      if (!src) return;
      
      // Create a new image to preload
      const tempImg = new Image();
      
      tempImg.onload = () => {
        img.src = src;
        img.removeAttribute('data-src');
        img.classList.add('loaded');
        img.classList.remove('loading');
      };
      
      tempImg.onerror = () => {
        this._handleImageError(img);
      };
      
      img.classList.add('loading');
      tempImg.src = src;
    },
    
    /**
     * Load all images (fallback for browsers without IO)
     * @private
     */
    _loadAllImages() {
      document.querySelectorAll('img[data-src]').forEach(img => {
        this._loadImage(img);
      });
    },
    
    /**
     * Setup global error handling for images
     * @private
     */
    _setupErrorHandling() {
      document.addEventListener('error', (e) => {
        if (e.target.tagName === 'IMG') {
          this._handleImageError(e.target);
        }
      }, true);
    },
    
    /**
     * Handle image load errors
     * @private
     */
    _handleImageError(img) {
      // Avoid infinite loop
      if (img.dataset.errorHandled) return;
      img.dataset.errorHandled = 'true';
      
      // Try fallback image if specified
      if (img.dataset.fallback) {
        img.src = img.dataset.fallback;
        return;
      }
      
      // Use placeholder based on context
      const isAvatar = img.classList.contains('avatar') || 
                       img.alt?.toLowerCase().includes('avatar') ||
                       img.alt?.toLowerCase().includes('profile');
      
      const isThumbnail = img.classList.contains('thumbnail') ||
                         img.alt?.toLowerCase().includes('thumbnail');
      
      if (isAvatar) {
        img.src = this._generateAvatarPlaceholder(img.alt || 'User');
      } else if (isThumbnail) {
        img.src = this._generateThumbnailPlaceholder();
      } else {
        img.src = this._placeholderSvg;
      }
      
      img.classList.add('error');
    },
    
    /**
     * Generate avatar placeholder with initials
     * @private
     */
    _generateAvatarPlaceholder(name) {
      const initials = name.split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2) || '?';
      
      const colors = ['#e63946', '#f0b429', '#10b981', '#6366f1', '#ec4899'];
      const color = colors[name.charCodeAt(0) % colors.length];
      
      return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect fill='${encodeURIComponent(color)}' width='100' height='100' rx='50'/%3E%3Ctext fill='white' font-family='sans-serif' font-size='40' font-weight='bold' x='50' y='50' text-anchor='middle' dy='.35em'%3E${initials}%3C/text%3E%3C/svg%3E`;
    },
    
    /**
     * Generate thumbnail placeholder
     * @private
     */
    _generateThumbnailPlaceholder() {
      return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 200'%3E%3Crect fill='%23f8d7da' width='300' height='200'/%3E%3Crect fill='%23e63946' x='125' y='70' width='50' height='60' rx='4'/%3E%3Ccircle fill='%23e63946' cx='150' cy='55' r='15'/%3E%3C/svg%3E`;
    },
    
    /**
     * Optimize existing images on the page
     * @private
     */
    _optimizeExistingImages() {
      document.querySelectorAll('img').forEach(img => {
        // Add loading="lazy" if not already set
        if (!img.loading && !img.dataset.src) {
          // Don't lazy load images above the fold
          const rect = img.getBoundingClientRect();
          if (rect.top > window.innerHeight) {
            img.loading = 'lazy';
          }
        }
        
        // Add decoding="async" for non-critical images
        if (!img.decoding) {
          img.decoding = 'async';
        }
      });
    },
    
    /**
     * Preload critical images
     * @param {string[]} urls - Array of image URLs to preload
     */
    preload(urls) {
      urls.forEach(url => {
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'image';
        link.href = url;
        document.head.appendChild(link);
      });
    },
    
    /**
     * Create responsive image element
     * @param {Object} options - Image options
     * @returns {HTMLImageElement}
     */
    createResponsiveImage(options) {
      const {
        src,
        alt = '',
        sizes = '100vw',
        srcset = null,
        className = '',
        lazy = true
      } = options;
      
      const img = document.createElement('img');
      img.alt = alt;
      img.className = className;
      img.decoding = 'async';
      
      if (lazy) {
        img.loading = 'lazy';
        img.dataset.src = src;
        img.src = this._placeholderSvg;
        this._observer?.observe(img);
      } else {
        img.src = src;
      }
      
      if (srcset) {
        img.srcset = srcset;
        img.sizes = sizes;
      }
      
      return img;
    },
    
    /**
     * Convert image to WebP format using canvas (client-side)
     * @param {string} src - Image source
     * @param {number} quality - Quality 0-1
     * @returns {Promise<string>} - WebP data URL
     */
    async toWebP(src, quality = 0.8) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          
          try {
            const webpUrl = canvas.toDataURL('image/webp', quality);
            resolve(webpUrl);
          } catch (e) {
            reject(e);
          }
        };
        
        img.onerror = reject;
        img.src = src;
      });
    }
  };
  
  // Auto-initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ImageOptimizer.init());
  } else {
    ImageOptimizer.init();
  }
  
  // Expose globally
  window.ImageOptimizer = ImageOptimizer;
  
})(window);
