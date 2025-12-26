/**
 * ChatSpheres Semantic Matchmaking
 * Frontend logic for AI-powered topic matching
 * Uses client-side Firebase (like the main app) for queue management
 */

(function() {
  'use strict';

  // ========== CONFIGURATION ==========
  const CONFIG = {
    POLL_INTERVAL: 3000,       // Poll for matches every 3 seconds
    MAX_POLL_TIME: 180000,     // Max 3 minutes of searching
    REDIRECT_DELAY: 1500,      // Delay before redirecting after match
    VIDEO_CHAT_URL: '/index.html',
    MATCH_THRESHOLD: 0.65,     // Minimum similarity for a match
    FALLBACK_THRESHOLD: 0.40,  // Lower threshold after 30s
    FALLBACK_TIME: 30000,      // Time before using fallback threshold
  };

  // ========== STATE ==========
  let state = {
    userId: null,
    topicText: '',
    topicVector: null,
    mode: 'casual',
    isSearching: false,
    pollInterval: null,
    searchStartTime: null,
    matchData: null,
    firebaseReady: false,
  };

  // Firebase references
  let db = null;
  let queueRef = null;

  // ========== DOM ELEMENTS ==========
  const elements = {};

  // ========== INITIALIZATION ==========
  async function init() {
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

    // Initialize Firebase
    await initFirebase();

    // Set up event listeners
    setupEventListeners();

    // Check for returning from a chat (show rating modal)
    checkForRating();

    console.log('🚀 Matchmaking initialized', { userId: state.userId, firebaseReady: state.firebaseReady });
  }

  // ========== FIREBASE INITIALIZATION ==========
  async function initFirebase() {
    // Wait for config to load
    let attempts = 0;
    while (!window.__CHATSPHERES_CONFIG__?.firebaseMain?.databaseURL && attempts < 20) {
      await sleep(100);
      attempts++;
    }

    const config = window.__CHATSPHERES_CONFIG__?.firebaseMain;
    
    if (!config || !config.databaseURL) {
      console.error('❌ Firebase config not found. Make sure client-config loads first.');
      showToast('Configuration error. Please refresh the page.');
      return;
    }

    try {
      // Check if Firebase is already initialized
      if (firebase.apps.length === 0) {
        firebase.initializeApp(config);
      }
      
      db = firebase.database();
      queueRef = db.ref('matchmaking_queue');
      
      // Sign in anonymously
      await firebase.auth().signInAnonymously();
      
      state.firebaseReady = true;
      console.log('✅ Firebase initialized for matchmaking');
    } catch (error) {
      console.error('❌ Firebase init error:', error);
      showToast('Connection error. Please refresh.');
    }
  }

  // ========== USER ID MANAGEMENT ==========
  function getUserId() {
    // Generate a UNIQUE ID for each page load / tab
    // This ensures each matchmaking session is independent
    // Using timestamp + random to guarantee uniqueness across tabs
    const uniqueId = 'mm_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
    console.log('🆔 Generated matchmaking ID:', uniqueId);
    return uniqueId;
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

    if (!state.firebaseReady) {
      showToast('Still connecting... please wait');
      return;
    }

    state.topicText = topic;
    state.isSearching = true;
    state.searchStartTime = Date.now();

    // Show scanning screen
    showScreen('scanning');
    updateUserTopicDisplay(topic);

    try {
      // Step 1: Get embedding vector from OpenAI
      updateQueueStatus('Analyzing your topic...');
      const vector = await getTopicEmbedding(topic);
      state.topicVector = vector;

      // Step 2: Join the queue (client-side Firebase)
      updateQueueStatus('Joining matchmaking queue...');
      await joinQueue();

      // Step 3: Start polling for matches
      updateQueueStatus('Searching for your match...');
      startPolling();

    } catch (error) {
      console.error('❌ Error starting matchmaking:', error);
      showToast('Something went wrong: ' + error.message);
      showScreen('input');
      state.isSearching = false;
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
      const errorText = await response.text();
      console.error('Embedding error:', errorText);
      throw new Error('Failed to analyze topic');
    }

    const data = await response.json();
    return data.vector;
  }

  // ========== FIREBASE QUEUE OPERATIONS ==========
  async function joinQueue() {
    if (!queueRef) throw new Error('Firebase not ready');

    const queueEntry = {
      topic_text: state.topicText.slice(0, 500),
      topic_vector: state.topicVector,
      mode: state.mode,
      timestamp: firebase.database.ServerValue.TIMESTAMP,
      status: 'waiting',
      matched_with: null,
      room_id: null,
    };

    await queueRef.child(state.userId).set(queueEntry);
    console.log('✅ Joined queue:', state.topicText);
  }

  async function leaveQueue() {
    if (!queueRef) return;
    try {
      await queueRef.child(state.userId).remove();
      console.log('🗑️ Left queue');
    } catch (e) {
      console.warn('Could not leave queue:', e);
    }
  }

  async function findMatch() {
    if (!queueRef) return { match: false };

    // First check if we're already matched
    const mySnapshot = await queueRef.child(state.userId).once('value');
    const myData = mySnapshot.val();

    if (!myData) {
      console.log('❌ Not in queue anymore');
      return { match: false, error: 'Not in queue' };
    }

    if (myData.status === 'matched' && myData.room_id) {
      console.log('🎉 Already matched!', myData.room_id);
      return {
        match: true,
        room_id: myData.room_id,
        matched_with: myData.matched_with,
        your_topic: myData.topic_text,
        their_topic: myData.matched_topic || 'Unknown topic',
        similarity: myData.similarity || 80,
      };
    }

    // Get all waiting users
    const snapshot = await queueRef.orderByChild('status').equalTo('waiting').once('value');
    const allUsers = snapshot.val() || {};

    console.log('📋 All users in queue:', Object.keys(allUsers));
    console.log('👤 My ID:', state.userId);

    // Filter out ourselves
    const otherUsers = Object.entries(allUsers).filter(([id]) => id !== state.userId);

    console.log('👥 Other waiting users:', otherUsers.length);

    if (otherUsers.length === 0) {
      return { match: false, waiting: true, message: 'Waiting for others to join...' };
    }

    // Calculate time in queue for threshold adjustment
    const timeInQueue = Date.now() - state.searchStartTime;
    const threshold = timeInQueue > CONFIG.FALLBACK_TIME ? CONFIG.FALLBACK_THRESHOLD : CONFIG.MATCH_THRESHOLD;

    // Find best match using cosine similarity
    let bestMatch = null;
    let bestSimilarity = 0;

    for (const [otherId, otherUser] of otherUsers) {
      if (!otherUser.topic_vector) continue;

      // Optional: filter by mode
      if (state.mode && otherUser.mode && state.mode !== otherUser.mode) continue;

      const similarity = cosineSimilarity(state.topicVector, otherUser.topic_vector);

      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = { id: otherId, user: otherUser, similarity };
      }
    }

    // Check if we found a good enough match
    if (bestMatch && bestSimilarity >= threshold) {
      // Create match!
      const roomId = generateRoomId();
      const similarityPercent = Math.round(bestSimilarity * 100);

      console.log(`🎉 Match found! ${state.userId} <-> ${bestMatch.id} (${similarityPercent}%)`);

      // Update both users atomically
      const updates = {};
      updates[`${state.userId}/status`] = 'matched';
      updates[`${state.userId}/matched_with`] = bestMatch.id;
      updates[`${state.userId}/room_id`] = roomId;
      updates[`${state.userId}/matched_topic`] = bestMatch.user.topic_text;
      updates[`${state.userId}/similarity`] = similarityPercent;
      updates[`${state.userId}/matched_at`] = firebase.database.ServerValue.TIMESTAMP;

      updates[`${bestMatch.id}/status`] = 'matched';
      updates[`${bestMatch.id}/matched_with`] = state.userId;
      updates[`${bestMatch.id}/room_id`] = roomId;
      updates[`${bestMatch.id}/matched_topic`] = state.topicText;
      updates[`${bestMatch.id}/similarity`] = similarityPercent;
      updates[`${bestMatch.id}/matched_at`] = firebase.database.ServerValue.TIMESTAMP;

      await queueRef.update(updates);

      return {
        match: true,
        room_id: roomId,
        matched_with: bestMatch.id,
        your_topic: state.topicText,
        their_topic: bestMatch.user.topic_text,
        similarity: similarityPercent,
      };
    }

    return {
      match: false,
      waiting: true,
      message: timeInQueue > CONFIG.FALLBACK_TIME 
        ? 'Still searching...' 
        : 'Looking for the perfect match...',
      queue_size: otherUsers.length,
    };
  }

  // ========== MATH UTILITIES ==========
  function cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (normA * normB);
  }

  function generateRoomId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 8);
    return `match-${timestamp}-${random}`;
  }

  // ========== POLLING ==========
  function startPolling() {
    state.pollInterval = setInterval(async () => {
      const timeSearching = Date.now() - state.searchStartTime;

      // Check for timeout
      if (timeSearching >= CONFIG.MAX_POLL_TIME) {
        stopPolling();
        showToast('No matches found. Try a different topic!');
        await leaveQueue();
        showScreen('input');
        return;
      }

      try {
        const result = await findMatch();

        if (result.match) {
          stopPolling();
          state.matchData = result;
          showMatchFound(result);
        } else {
          const seconds = Math.round(timeSearching / 1000);
          const queueInfo = result.queue_size ? ` (${result.queue_size} others online)` : '';
          updateQueueStatus(`${result.message} ${seconds}s${queueInfo}`);
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
    elements.inputScreen.style.display = screen === 'input' ? 'block' : 'none';
    elements.scanningScreen.style.display = screen === 'scanning' ? 'block' : 'none';
    elements.matchScreen.style.display = screen === 'match' ? 'block' : 'none';

    if (screen === 'input') {
      elements.inputScreen?.classList.add('active');
    } else if (screen === 'scanning') {
      elements.scanningScreen?.classList.add('active');
    } else if (screen === 'match') {
      elements.matchScreen?.classList.add('active');
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
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.style.cssText = `
        position: fixed;
        bottom: 2rem;
        left: 50%;
        transform: translateX(-50%);
        background: #22223B;
        color: white;
        padding: 1rem 2rem;
        border-radius: 12px;
        font-weight: 600;
        z-index: 9999;
        opacity: 0;
        transition: opacity 0.3s ease;
        font-family: 'Nunito', sans-serif;
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
  async function cancelSearch() {
    stopPolling();
    await leaveQueue();
    showScreen('input');
  }

  function joinRoom() {
    if (!state.matchData?.room_id) {
      showToast('Error: No room to join');
      return;
    }

    const roomId = state.matchData.room_id;
    const baseUrl = window.location.origin;
    
    // Build redirect URL with room ID (not full URL to avoid Firebase path issues)
    // Pass topic info so the video chat can display it
    const yourTopic = encodeURIComponent(state.matchData.your_topic || 'Chat');
    const theirTopic = encodeURIComponent(state.matchData.their_topic || 'Chat');
    const similarity = state.matchData.similarity || 80;
    
    // Daily room URL (unused; kept for debugging)
    const roomUrl = `https://tivoq.daily.co/${roomId}`;
    
    const redirectUrl = `${baseUrl}${CONFIG.VIDEO_CHAT_URL}?room=${roomId}&mode=participant&matched=true&topic=${yourTopic}&matchedTopic=${theirTopic}&similarity=${similarity}`;
    
    console.log('🚀 Redirecting to room:', redirectUrl);
    window.location.href = redirectUrl;
  }

  // ========== RATING ==========
  // Uses the shared localStorage system from moderation.js
  const PENDING_RATING_STORAGE_KEY = 'chatspheres_pending_rating';
  
  function checkForRating() {
    const urlParams = new URLSearchParams(window.location.search);
    const showRating = urlParams.get('rate');
    
    if (showRating === 'true') {
      showRatingModal();
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }
    
    // ALSO check localStorage for pending ratings (from video chat)
    // The moderation.js script handles this, but add a fallback check here too
    setTimeout(() => {
      checkLocalStorageRating();
    }, 1000);
  }
  
  // Check localStorage for pending ratings (shared with index.html)
  function checkLocalStorageRating() {
    try {
      const data = localStorage.getItem(PENDING_RATING_STORAGE_KEY);
      if (!data) return;
      
      const parsed = JSON.parse(data);
      const twentyFourHours = 24 * 60 * 60 * 1000;
      
      // Only show if not expired and not yet rated
      if (parsed.ratedId && !parsed.rated && (Date.now() - parsed.timestamp) < twentyFourHours) {
        console.log('📊 Found pending rating in localStorage on matchmaking page');
        
        // Use the moderation.js showRatingModal if available, otherwise use our own
        if (window.showRatingModal && typeof window.showRatingModal === 'function') {
          // Let moderation.js handle it - it will show the proper modal
          // It already checks on load, so just trigger it again
          if (window.checkPendingRating) {
            window.checkPendingRating();
          }
        } else {
          // Fallback to matchmaking's own rating modal
          showRatingModalWithData(parsed.ratedId, parsed.otherUserName);
        }
      }
    } catch (e) {
      console.warn('Could not check localStorage rating:', e);
    }
  }
  
  // Show rating modal with data from localStorage
  function showRatingModalWithData(otherUserId, otherUserName) {
    // Store for submit
    localStorage.setItem('last_matched_with', otherUserId);
    
    // Update the matchmaking modal if it exists, or let moderation.js handle it
    if (elements.ratingModal) {
      elements.ratingModal.classList.add('active');
      elements.ratingModal.style.display = 'flex';
    }
  }

  function showRatingModal() {
    if (elements.ratingModal) {
      elements.ratingModal.classList.add('active');
      elements.ratingModal.style.display = 'flex';
    }
  }

  function closeRatingModal() {
    if (elements.ratingModal) {
      elements.ratingModal.classList.remove('active');
      elements.ratingModal.style.display = 'none';
    }
    localStorage.removeItem('last_matched_with');
    localStorage.removeItem('last_room_id');
  }

  async function submitRating(rating) {
    const matchedWith = localStorage.getItem('last_matched_with');
    
    if (matchedWith && db) {
      try {
        const karmaRef = db.ref(`user_karma/${matchedWith}`);
        const karmaChange = rating >= 4 ? 1 : (rating <= 2 ? -1 : 0);
        
        await karmaRef.transaction((current) => {
          if (!current) {
            return { score: karmaChange, matches_count: 1 };
          }
          return {
            score: (current.score || 0) + karmaChange,
            matches_count: (current.matches_count || 0) + 1,
          };
        });
        
        console.log(`⭐ Rated user ${matchedWith}: ${rating}/5`);
        
        // Clear the shared localStorage key after successful rating
        try {
          localStorage.removeItem(PENDING_RATING_STORAGE_KEY);
          console.log('🗑️ Cleared pending rating from localStorage');
        } catch (e) {
          console.warn('Could not clear pending rating:', e);
        }
      } catch (error) {
        console.warn('Rating failed:', error);
      }
    }

    closeRatingModal();
    showToast(rating >= 4 ? '✨ Thanks for the feedback!' : 'Thanks for letting us know');
  }

  // ========== UTILITIES ==========
  function truncate(str, length) {
    if (!str) return '';
    if (str.length <= length) return str;
    return str.slice(0, length) + '...';
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ========== CLEANUP ON PAGE UNLOAD ==========
  window.addEventListener('beforeunload', () => {
    if (state.isSearching) {
      leaveQueue();
    }
  });

  // ========== START ==========
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
