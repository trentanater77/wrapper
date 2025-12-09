/**
 * Structured Data (JSON-LD) Generator
 * Adds schema.org structured data for better SEO
 */

(function(window) {
  'use strict';
  
  const StructuredData = {
    /**
     * Add structured data to the page
     * @param {Object} data - Schema.org structured data object
     */
    add(data) {
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.textContent = JSON.stringify(data);
      document.head.appendChild(script);
    },
    
    /**
     * Generate Organization schema
     */
    organization() {
      return {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'ChatSpheres',
        url: 'https://chatspheres.com',
        logo: 'https://chatspheres.com/assets/images/logo.png',
        description: 'Live video chat platform for meaningful conversations, debates, and forums.',
        sameAs: [
          // Add social media links here when available
        ],
        contactPoint: {
          '@type': 'ContactPoint',
          email: 'support@chatspheres.com',
          contactType: 'customer service'
        }
      };
    },
    
    /**
     * Generate WebSite schema with search
     */
    website() {
      return {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'ChatSpheres',
        url: 'https://chatspheres.com',
        description: 'Find your conversation match. AI-powered semantic matchmaking for meaningful video conversations.',
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: 'https://chatspheres.com/explore.html?q={search_term_string}'
          },
          'query-input': 'required name=search_term_string'
        }
      };
    },
    
    /**
     * Generate WebApplication schema
     */
    webApplication() {
      return {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: 'ChatSpheres',
        applicationCategory: 'CommunicationApplication',
        operatingSystem: 'Any',
        browserRequirements: 'Requires JavaScript. Requires WebRTC support.',
        description: 'Live video chat platform with AI-powered matchmaking for debates, conversations, and community forums.',
        url: 'https://chatspheres.com',
        offers: {
          '@type': 'AggregateOffer',
          priceCurrency: 'USD',
          lowPrice: '0',
          highPrice: '19.99',
          offerCount: '4'
        },
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: '4.5',
          ratingCount: '100'
        }
      };
    },
    
    /**
     * Generate FAQPage schema
     * @param {Array} faqs - Array of { question, answer } objects
     */
    faqPage(faqs) {
      return {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqs.map(faq => ({
          '@type': 'Question',
          name: faq.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: faq.answer
          }
        }))
      };
    },
    
    /**
     * Generate Product schema for subscription plans
     * @param {Object} plan - Plan details
     */
    product(plan) {
      return {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: plan.name,
        description: plan.description,
        brand: {
          '@type': 'Brand',
          name: 'ChatSpheres'
        },
        offers: {
          '@type': 'Offer',
          price: plan.price,
          priceCurrency: 'USD',
          priceValidUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          availability: 'https://schema.org/InStock',
          url: 'https://chatspheres.com/pricing.html'
        }
      };
    },
    
    /**
     * Generate BreadcrumbList schema
     * @param {Array} items - Array of { name, url } objects
     */
    breadcrumbs(items) {
      return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: items.map((item, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: item.name,
          item: item.url
        }))
      };
    },
    
    /**
     * Generate Event schema for live rooms
     * @param {Object} room - Room details
     */
    liveEvent(room) {
      return {
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: room.title || 'Live Video Chat',
        description: room.description || 'Join this live video conversation',
        startDate: room.startedAt || new Date().toISOString(),
        eventStatus: 'https://schema.org/EventScheduled',
        eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
        location: {
          '@type': 'VirtualLocation',
          url: `https://chatspheres.com/live.html?room=${room.id}`
        },
        organizer: {
          '@type': 'Person',
          name: room.hostName || 'ChatSpheres Host'
        },
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
          validFrom: room.startedAt || new Date().toISOString()
        }
      };
    },
    
    /**
     * Generate VideoObject schema
     * @param {Object} video - Video/room details
     */
    videoObject(video) {
      return {
        '@context': 'https://schema.org',
        '@type': 'VideoObject',
        name: video.title,
        description: video.description,
        thumbnailUrl: video.thumbnailUrl || 'https://chatspheres.com/assets/images/video-thumbnail.png',
        uploadDate: video.createdAt || new Date().toISOString(),
        duration: video.duration || 'PT0M',
        interactionStatistic: {
          '@type': 'InteractionCounter',
          interactionType: { '@type': 'WatchAction' },
          userInteractionCount: video.viewCount || 0
        }
      };
    },
    
    /**
     * Generate DiscussionForumPosting schema
     * @param {Object} forum - Forum details
     */
    forum(forum) {
      return {
        '@context': 'https://schema.org',
        '@type': 'DiscussionForumPosting',
        headline: forum.name,
        articleBody: forum.description,
        datePublished: forum.createdAt,
        author: {
          '@type': 'Person',
          name: forum.ownerName || 'Forum Creator'
        },
        interactionStatistic: {
          '@type': 'InteractionCounter',
          interactionType: { '@type': 'JoinAction' },
          userInteractionCount: forum.memberCount || 0
        }
      };
    },
    
    /**
     * Auto-detect and add appropriate structured data based on page
     */
    autoDetect() {
      const path = window.location.pathname;
      
      // Always add organization and website
      this.add(this.organization());
      this.add(this.website());
      
      // Add page-specific schemas
      if (path === '/' || path === '/index.html') {
        this.add(this.webApplication());
      }
      
      if (path === '/pricing.html') {
        // Add product schemas for each plan
        const plans = [
          { name: 'Free', description: 'Basic chat features', price: '0' },
          { name: 'Host Pro', description: 'Advanced hosting features', price: '9.99' },
          { name: 'Viewer Pro', description: 'Premium viewing experience', price: '4.99' },
          { name: 'Pro Bundle', description: 'All premium features', price: '12.99' }
        ];
        plans.forEach(plan => this.add(this.product(plan)));
      }
      
      // Add breadcrumbs for non-home pages
      if (path !== '/' && path !== '/index.html') {
        const pageName = path.replace(/\//g, '').replace('.html', '').replace(/-/g, ' ');
        const breadcrumbs = [
          { name: 'Home', url: 'https://chatspheres.com/' },
          { name: pageName.charAt(0).toUpperCase() + pageName.slice(1), url: `https://chatspheres.com${path}` }
        ];
        this.add(this.breadcrumbs(breadcrumbs));
      }
    }
  };
  
  // Auto-initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => StructuredData.autoDetect());
  } else {
    StructuredData.autoDetect();
  }
  
  // Expose globally
  window.StructuredData = StructuredData;
  
})(window);
