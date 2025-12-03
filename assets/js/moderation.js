/**
 * ChatSpheres Moderation - Shared Script
 * Handles pending ratings and suspension checks across all pages
 */

(function() {
  'use strict';
  
  // State
  let pendingRatingData = null;
  
  // Create rating modal if it doesn't exist
  function createRatingModal() {
    if (document.getElementById('rating-modal')) return;
    
    const modalHtml = `
      <div id="rating-modal" class="hidden fixed inset-0 z-[9999] flex items-center justify-center p-4" style="background: rgba(34, 34, 59, 0.95); backdrop-filter: blur(8px);">
        <div class="bg-light-rose rounded-3xl p-6 max-w-sm w-full shadow-2xl border-4 border-gold relative" style="background: var(--light-rose, #FCE2E5);">
          <button onclick="window.skipRating()" class="absolute top-4 right-4 text-charcoal hover:text-main-red transition-colors" style="color: var(--charcoal, #22223B);">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
          
          <div class="text-center mb-6">
            <div class="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style="background: var(--gold, #FFD166);">
              <span class="text-3xl">⭐</span>
            </div>
            <h2 class="text-xl font-bold mb-2" style="color: var(--charcoal, #22223B);">You have a pending rating!</h2>
            <p class="opacity-70 text-sm" style="color: var(--charcoal, #22223B);">How was your chat with <strong id="rating-other-user-name">User</strong>?</p>
            <p class="opacity-60 text-xs mt-2" style="color: var(--charcoal, #22223B);">Your feedback keeps ChatSpheres safe.</p>
          </div>
          
          <div class="flex justify-center gap-6 mb-6">
            <button onclick="window.submitRating('good')" class="flex flex-col items-center p-4 rounded-2xl border-2 transition-all hover:scale-105" style="border-color: var(--rose, #FFB6B9); background: var(--bg-main, #FFE7DD);">
              <span class="text-4xl mb-2">👍</span>
              <span class="font-semibold" style="color: var(--charcoal, #22223B);">Good</span>
            </button>
            <button onclick="window.submitRating('bad')" class="flex flex-col items-center p-4 rounded-2xl border-2 transition-all hover:scale-105" style="border-color: var(--rose, #FFB6B9); background: var(--bg-main, #FFE7DD);">
              <span class="text-4xl mb-2">👎</span>
              <span class="font-semibold" style="color: var(--charcoal, #22223B);">Bad</span>
            </button>
          </div>
          
          <div class="mb-4">
            <label class="block text-sm font-semibold mb-2" style="color: var(--charcoal, #22223B);">Feedback (optional)</label>
            <textarea 
              id="rating-feedback" 
              placeholder="Tell us more about your experience..."
              maxlength="500"
              rows="2"
              class="w-full px-4 py-3 rounded-xl border-2 focus:outline-none resize-none"
              style="border-color: var(--rose, #FFB6B9); background: var(--bg-main, #FFE7DD); color: var(--charcoal, #22223B);"
            ></textarea>
          </div>
          
          <p class="text-center">
            <button onclick="window.skipRating()" class="opacity-60 hover:opacity-100 text-sm underline" style="color: var(--charcoal, #22223B);">Skip for now</button>
          </p>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
  }
  
  // Show rating modal
  function showRatingModal(otherUserId, otherUserName, roomId, userId) {
    createRatingModal();
    
    pendingRatingData = {
      raterId: userId,
      ratedId: otherUserId,
      roomId: roomId,
    };
    
    document.getElementById('rating-other-user-name').textContent = otherUserName || 'your previous chat partner';
    document.getElementById('rating-modal').classList.remove('hidden');
    
    const feedbackEl = document.getElementById('rating-feedback');
    if (feedbackEl) feedbackEl.value = '';
  }
  
  // Submit rating
  async function submitRating(rating) {
    if (!pendingRatingData) {
      console.error('No pending rating data');
      return;
    }
    
    const feedback = document.getElementById('rating-feedback')?.value?.trim() || '';
    
    try {
      const response = await fetch('/.netlify/functions/submit-rating', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...pendingRatingData,
          rating: rating,
          feedback: feedback || null,
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        console.log(`✅ Rating submitted: ${rating}`);
      } else {
        console.error('Rating submission failed:', data.error);
      }
    } catch (error) {
      console.error('Error submitting rating:', error);
    }
    
    closeRatingModal();
  }
  
  // Skip rating
  function skipRating() {
    closeRatingModal();
  }
  
  // Close rating modal
  function closeRatingModal() {
    const modal = document.getElementById('rating-modal');
    if (modal) modal.classList.add('hidden');
    pendingRatingData = null;
  }
  
  // Check for pending rating
  async function checkPendingRating() {
    // Get current user ID from various sources
    let userId = null;
    
    // Try window.currentUserData
    if (window.currentUserData?.userId) {
      userId = window.currentUserData.userId;
    }
    
    // Try Supabase session
    if (!userId && window.supabaseClient) {
      try {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (session?.user?.id) {
          userId = session.user.id;
        }
      } catch (e) {
        console.log('Could not get Supabase session for pending rating check');
      }
    }
    
    if (!userId) {
      console.log('No user ID for pending rating check');
      return;
    }
    
    try {
      const response = await fetch(`/.netlify/functions/get-pending-rating?userId=${userId}`);
      const data = await response.json();
      
      if (data.hasPending && data.pendingRating) {
        // Show rating modal for previous call
        setTimeout(() => {
          showRatingModal(
            data.pendingRating.otherUserId,
            data.pendingRating.otherUserName,
            data.pendingRating.roomId,
            userId
          );
        }, 1000);
      }
    } catch (error) {
      console.log('Could not check pending rating:', error);
    }
  }
  
  // Check if user is suspended
  async function checkUserSuspension() {
    let userId = null;
    
    if (window.currentUserData?.userId) {
      userId = window.currentUserData.userId;
    }
    
    if (!userId && window.supabaseClient) {
      try {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (session?.user?.id) {
          userId = session.user.id;
        }
      } catch (e) {
        return false;
      }
    }
    
    if (!userId) return false;
    
    try {
      const response = await fetch(`/.netlify/functions/check-suspension?userId=${userId}`);
      const data = await response.json();
      
      if (data.isSuspended) {
        alert(`Your account has been suspended.\n\nReason: ${data.suspension.reason}\n\nIf you believe this is a mistake, please contact support.`);
        window.location.href = '/contact.html';
        return true;
      }
    } catch (error) {
      console.log('Could not check suspension:', error);
    }
    
    return false;
  }
  
  // Expose functions globally
  window.showRatingModal = showRatingModal;
  window.submitRating = submitRating;
  window.skipRating = skipRating;
  window.closeRatingModal = closeRatingModal;
  window.checkPendingRating = checkPendingRating;
  window.checkUserSuspension = checkUserSuspension;
  
  // Auto-check on load (with delay to allow auth to initialize)
  document.addEventListener('DOMContentLoaded', () => {
    // Don't run on index.html (has its own implementation)
    if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
      return;
    }
    
    setTimeout(() => {
      checkPendingRating();
    }, 2000);
  });
})();
