/**
 * ChatSpheres Semantic Matchmaking
 * Frontend logic for AI-powered topic matching
 */

(function() {
  'use strict';

  // ========== CONFIGURATION ==========
  const CONFIG = {
    POLL_INTERVAL: 3000,       // Poll for matches every 3 seconds
    MAX_POLL_ATTEMPTS: 60,     // Max 3 minutes of polling
    REDIRECT_DELAY: 2000,      // Delay before redirecting after match
    VIDEO_CHAT_URL: '/index.html',
  };

  // ========== STATE ==========
  let state = {
    userId: null,
    topicText: '',
    topicVector: null,
    mode: 'casual',
    isSearching: false,
    pollInterval: null,
    pollAttempts: 0,
    matchData: null,
  };

  // ========== DOM ELEMENTS ==========
  const elements = {
    inputScreen: null,
    scanningScreen: null,
    matchScreen: null,
    ratingModal: null,
    topicInput: null,
    submitBtn: null,
    userTopicDisplay: null,
    queueStatus: null,
    matchYourTopic: null,
    matchTheirTopic: null,
    similarityBadge: null,
  };

  // ========== INITIALIZATION ==========
  function init() {
    // Cache DOM elements
    elements.inputScreen = document.getElementById('input-screen');
    elements.scanningScreen = document.getElementById('scanning-screen');
    elements.matchScreen = document.getElementById('match-screen');
    elements.ratingModal = document.getElementById('rating-modal');
    elements.topicInput = document.getElementById('topic-input');
    elements.submitBtn = document.getElementById('submit-btn');
    elements.userTopicDisplay = document.getElementById('user-topic-display');
    elements.queueStatus = document.getElementById('queue-status');
    elements.matchYourTopic = document.getElementById('match-your-topic');
    elements.matchTheirTopic = document.getElementById('match-their-topic');
    elements.similarityBadge = document.getElementById('similarity-badge');

    // Generate or retrieve user ID
    state.userId = getUserId();

    // Set up event listeners
    setupEventListeners();

    // Check for returning from a chat (show rating modal)
    checkForRating();

    console.log('🚀 Matchmaking initialized', { userId: state.userId });
  }

  // ========== USER ID MANAGEMENT ==========
  function getUserId() {
    let userId = localStorage.getItem('chatspheres_user_id');
    if (!userId) {
      userId = 'user_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('chatspheres_user_id', userId);
    }
    return userId;
  }

  // ========== EVENT LISTENERS ==========
  function setupEventListeners() {
    // Submit button
    elements.submitBtn?.addEventListener('click', handleSubmit);

    // Enter key on input
    elements.topicInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleSubmit();
      }
    });

    // Trending chips
    document.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const topic = chip.dataset.topic;
        if (elements.topicInput && topic) {
          elements.topicInput.value = topic;
          elements.topicInput.focus();
        }
      });
    });

    // Mode buttons
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.mode = btn.dataset.mode;
      });
    });

    // Cancel button
    document.getElementById('cancel-btn')?.addEventListener('click', cancelSearch);

    // Join room button
    document.getElementById('join-room-btn')?.addEventListener('click', joinRoom);

    // Rating buttons
    document.getElementById('rate-positive')?.addEventListener('click', () => submitRating(5));
    document.getElementById('rate-negative')?.addEventListener('click', () => submitRating(1));
    document.getElementById('skip-rating')?.addEventListener('click', () => closeRatingModal());
  }

  // ========== MAIN FLOW ==========
  async function handleSubmit() {
    const topic = elements.topicInput?.value.trim();
    
    if (!topic) {
      shakeInput();
      return;
    }

    if (topic.length < 3) {
      showToast('Please enter at least 3 characters');
      return;
    }

    state.topicText = topic;
    state.isSearching = true;

    // Show scanning screen
    showScreen('scanning');
    updateUserTopicDisplay(topic);

    try {
      // Step 1: Get embedding vector from OpenAI
      updateQueueStatus('Analyzing your topic...');
      const vector = await getTopicEmbedding(topic);
      state.topicVector = vector;

      // Step 2: Join the queue
      updateQueueStatus('Joining matchmaking queue...');
      await joinQueue();

      // Step 3: Start polling for matches
      updateQueueStatus('Searching for your match...');
      startPolling();

    } catch (error) {
      console.error('❌ Error starting matchmaking:', error);
      showToast('Something went wrong. Please try again.');
      showScreen('input');
    }
  }

  // ========== API CALLS ==========
  async function getTopicEmbedding(text) {
    const response = await fetch('/.netlify/functions/embed-topic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error('Failed to generate topic embedding');
    }

    const data = await response.json();
    return data.vector;
  }

  async function joinQueue() {
    const response = await fetch('/.netlify/functions/join-queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: state.userId,
        topicText: state.topicText,
        topicVector: state.topicVector,
        mode: state.mode,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to join queue');
    }

    return response.json();
  }

  async function checkForMatch() {
    const response = await fetch('/.netlify/functions/find-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: state.userId }),
    });

    if (!response.ok) {
      throw new Error('Failed to check for match');
    }

    return response.json();
  }

  async function submitRatingToServer(rating) {
    const matchedWith = localStorage.getItem('last_matched_with');
    const roomId = localStorage.getItem('last_room_id');

    if (!matchedWith) return;

    try {
      await fetch('/.netlify/functions/rate-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raterId: state.userId,
          ratedUserId: matchedWith,
          rating: rating,
          roomId: roomId,
        }),
      });
    } catch (error) {
      console.error('Failed to submit rating:', error);
    }
  }

  // ========== POLLING ==========
  function startPolling() {
    state.pollAttempts = 0;
    
    state.pollInterval = setInterval(async () => {
      state.pollAttempts++;

      try {
        const result = await checkForMatch();

        if (result.match) {
          // Match found!
          stopPolling();
          state.matchData = result;
          showMatchFound(result);
        } else {
          // Update status
          const timeWaiting = result.time_waiting || state.pollAttempts * 3;
          updateQueueStatus(`Searching... ${timeWaiting}s`);

          // Check for timeout
          if (state.pollAttempts >= CONFIG.MAX_POLL_ATTEMPTS) {
            stopPolling();
            showToast('No matches found. Try a different topic!');
            showScreen('input');
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, CONFIG.POLL_INTERVAL);
  }

  function stopPolling() {
    if (state.pollInterval) {
      clearInterval(state.pollInterval);
      state.pollInterval = null;
    }
    state.isSearching = false;
  }

  // ========== UI UPDATES ==========
  function showScreen(screen) {
    elements.inputScreen?.classList.remove('active');
    elements.scanningScreen?.classList.remove('active');
    elements.matchScreen?.classList.remove('active');

    if (screen === 'input') {
      elements.inputScreen?.classList.add('active');
      elements.inputScreen.style.display = 'block';
      elements.scanningScreen.style.display = 'none';
      elements.matchScreen.style.display = 'none';
    } else if (screen === 'scanning') {
      elements.scanningScreen?.classList.add('active');
      elements.inputScreen.style.display = 'none';
      elements.scanningScreen.style.display = 'block';
      elements.matchScreen.style.display = 'none';
    } else if (screen === 'match') {
      elements.matchScreen?.classList.add('active');
      elements.inputScreen.style.display = 'none';
      elements.scanningScreen.style.display = 'none';
      elements.matchScreen.style.display = 'block';
    }
  }

  function updateUserTopicDisplay(topic) {
    if (elements.userTopicDisplay) {
      elements.userTopicDisplay.textContent = `"${topic}"`;
    }
  }

  function updateQueueStatus(text) {
    if (elements.queueStatus) {
      elements.queueStatus.textContent = text;
    }
  }

  function showMatchFound(data) {
    showScreen('match');

    if (elements.matchYourTopic) {
      elements.matchYourTopic.textContent = truncate(data.your_topic, 50);
    }
    if (elements.matchTheirTopic) {
      elements.matchTheirTopic.textContent = truncate(data.their_topic, 50);
    }
    if (elements.similarityBadge) {
      elements.similarityBadge.textContent = `${data.similarity}% Match`;
    }

    // Store match data for rating later
    localStorage.setItem('last_matched_with', data.matched_with);
    localStorage.setItem('last_room_id', data.room_id);
  }

  function shakeInput() {
    elements.topicInput?.classList.add('shake');
    setTimeout(() => {
      elements.topicInput?.classList.remove('shake');
    }, 500);
  }

  function showToast(message) {
    // Create toast element if it doesn't exist
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.style.cssText = `
        position: fixed;
        bottom: 2rem;
        left: 50%;
        transform: translateX(-50%);
        background: var(--charcoal);
        color: white;
        padding: 1rem 2rem;
        border-radius: 12px;
        font-weight: 600;
        z-index: 9999;
        opacity: 0;
        transition: opacity 0.3s ease;
      `;
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.opacity = '1';

    setTimeout(() => {
      toast.style.opacity = '0';
    }, 3000);
  }

  // ========== ACTIONS ==========
  function cancelSearch() {
    stopPolling();
    showScreen('input');
    
    // Clean up queue entry (fire and forget)
    fetch('/.netlify/functions/join-queue', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: state.userId }),
    }).catch(() => {});
  }

  function joinRoom() {
    if (!state.matchData?.room_id) {
      showToast('Error: No room to join');
      return;
    }

    const roomId = state.matchData.room_id;
    const redirectUrl = `${CONFIG.VIDEO_CHAT_URL}?room=${encodeURIComponent(roomId)}&mode=participant&matched=true`;
    
    console.log('🚀 Redirecting to room:', redirectUrl);
    window.location.href = redirectUrl;
  }

  // ========== RATING ==========
  function checkForRating() {
    const urlParams = new URLSearchParams(window.location.search);
    const showRating = urlParams.get('rate');
    
    if (showRating === 'true') {
      showRatingModal();
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }

  function showRatingModal() {
    elements.ratingModal?.classList.add('active');
  }

  function closeRatingModal() {
    elements.ratingModal?.classList.remove('active');
    localStorage.removeItem('last_matched_with');
    localStorage.removeItem('last_room_id');
  }

  async function submitRating(rating) {
    await submitRatingToServer(rating);
    closeRatingModal();
    showToast(rating >= 4 ? '✨ Thanks for the feedback!' : 'Thanks for letting us know');
  }

  // ========== UTILITIES ==========
  function truncate(str, length) {
    if (!str) return '';
    if (str.length <= length) return str;
    return str.slice(0, length) + '...';
  }

  // ========== START ==========
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
