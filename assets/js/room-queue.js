/**
 * ChatSpheres Room Queue System
 * 
 * Handles the queue UI for creator rooms:
 * - Spectators can join queue to become participant 2
 * - Shows queue position
 * - Host can "Next" to cycle through challengers
 */

(function() {
  'use strict';

  // State
  let currentRoomId = null;
  let currentUserId = null;
  let currentUserName = null;
  let isHost = false;
  let isInQueue = false;
  let queuePosition = null;
  let pollingInterval = null;

  // API base
  const API_BASE = '/.netlify/functions';

  /**
   * Initialize the queue system
   */
  window.initRoomQueue = function(options = {}) {
    currentRoomId = options.roomId;
    currentUserId = options.userId;
    currentUserName = options.userName || 'Anonymous';
    isHost = options.isHost || false;

    console.log('🎤 Room Queue initialized', { roomId: currentRoomId, isHost });

    // Create UI elements
    createQueueUI();

    // Start polling for queue updates
    startPolling();

    // Initial fetch
    fetchQueue();
  };

  /**
   * Create the queue UI elements
   */
  function createQueueUI() {
    // Check if UI already exists
    if (document.getElementById('queue-panel')) return;

    // Create queue panel
    const panel = document.createElement('div');
    panel.id = 'queue-panel';
    panel.innerHTML = `
      <style>
        #queue-panel {
          position: fixed;
          bottom: 100px;
          right: 20px;
          background: white;
          border-radius: 16px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15);
          padding: 16px;
          min-width: 280px;
          max-width: 320px;
          z-index: 1000;
          font-family: 'Nunito', sans-serif;
          border: 3px solid #FFB6B9;
        }
        
        #queue-panel.hidden {
          display: none;
        }
        
        .queue-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
          padding-bottom: 12px;
          border-bottom: 2px solid #FCE2E5;
        }
        
        .queue-title {
          font-weight: 800;
          font-size: 1.1rem;
          color: #22223B;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .queue-count {
          background: #e63946;
          color: white;
          padding: 2px 10px;
          border-radius: 100px;
          font-size: 0.85rem;
          font-weight: 700;
        }
        
        .queue-minimize {
          background: none;
          border: none;
          font-size: 1.2rem;
          cursor: pointer;
          opacity: 0.5;
        }
        
        .queue-minimize:hover {
          opacity: 1;
        }
        
        .queue-list {
          max-height: 200px;
          overflow-y: auto;
          margin-bottom: 12px;
        }
        
        .queue-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px;
          border-radius: 8px;
          margin-bottom: 4px;
        }
        
        .queue-item:hover {
          background: #FCE2E5;
        }
        
        .queue-item.current {
          background: #FFD166;
        }
        
        .queue-item.you {
          background: #d4edda;
          border: 2px solid #28a745;
        }
        
        .queue-position {
          width: 28px;
          height: 28px;
          background: #e63946;
          color: white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 0.85rem;
          flex-shrink: 0;
        }
        
        .queue-item.current .queue-position {
          background: #22223B;
        }
        
        .queue-name {
          flex: 1;
          font-weight: 600;
          color: #22223B;
          font-size: 0.95rem;
        }
        
        .queue-empty {
          text-align: center;
          padding: 20px;
          color: #666;
          font-size: 0.9rem;
        }
        
        .queue-actions {
          display: flex;
          gap: 8px;
        }
        
        .queue-btn {
          flex: 1;
          padding: 10px 16px;
          border: none;
          border-radius: 100px;
          font-weight: 700;
          font-family: 'Nunito', sans-serif;
          cursor: pointer;
          transition: all 0.2s;
          font-size: 0.9rem;
        }
        
        .queue-btn-primary {
          background: #e63946;
          color: white;
        }
        
        .queue-btn-primary:hover {
          background: #c92a35;
          transform: scale(1.02);
        }
        
        .queue-btn-secondary {
          background: #FFD166;
          color: #22223B;
        }
        
        .queue-btn-secondary:hover {
          background: #e6bc5a;
        }
        
        .queue-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
        }
        
        .queue-status {
          text-align: center;
          padding: 12px;
          background: #d4edda;
          border-radius: 8px;
          margin-bottom: 12px;
          font-weight: 600;
          color: #155724;
        }
        
        .queue-status.waiting {
          background: #FCE2E5;
          color: #22223B;
        }
        
        .queue-status.your-turn {
          background: #FFD166;
          color: #22223B;
          animation: pulse 1s infinite;
        }
        
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        
        /* Host controls */
        .host-controls {
          border-top: 2px solid #FCE2E5;
          padding-top: 12px;
          margin-top: 12px;
        }
        
        .host-controls-title {
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #666;
          margin-bottom: 8px;
        }
        
        .next-btn {
          width: 100%;
          padding: 12px;
          background: linear-gradient(135deg, #e63946, #FFD166);
          color: white;
          border: none;
          border-radius: 100px;
          font-weight: 800;
          font-size: 1rem;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .next-btn:hover:not(:disabled) {
          transform: scale(1.02);
          box-shadow: 0 4px 15px rgba(230, 57, 70, 0.4);
        }
        
        .next-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      </style>
      
      <div class="queue-header">
        <div class="queue-title">
          🎤 Queue <span id="queue-count-badge" class="queue-count">0</span>
        </div>
        <button class="queue-minimize" onclick="toggleQueuePanel()">−</button>
      </div>
      
      <div id="queue-content">
        <!-- User's status (if in queue) -->
        <div id="queue-user-status" class="queue-status" style="display: none;"></div>
        
        <!-- Queue list -->
        <div id="queue-list" class="queue-list">
          <div class="queue-empty">No one in queue yet</div>
        </div>
        
        <!-- Actions -->
        <div id="queue-actions" class="queue-actions"></div>
        
        <!-- Host controls -->
        <div id="host-controls" class="host-controls" style="display: none;">
          <div class="host-controls-title">Host Controls</div>
          <button id="next-btn" class="next-btn" onclick="callNextPerson()">
            ⏭️ Next Challenger
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    // Show host controls if host
    if (isHost) {
      document.getElementById('host-controls').style.display = 'block';
    }

    // Show join button if not host
    updateActionButtons();
  }

  /**
   * Fetch current queue
   */
  async function fetchQueue() {
    if (!currentRoomId) return;

    try {
      const url = `${API_BASE}/room-queue?roomId=${currentRoomId}${currentUserId ? `&userId=${currentUserId}` : ''}`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.queue) {
        updateQueueDisplay(data.queue);
        queuePosition = data.userPosition;
        isInQueue = queuePosition !== null;
        updateActionButtons();
        updateUserStatus();
      }
    } catch (error) {
      console.error('Error fetching queue:', error);
    }
  }

  /**
   * Update the queue display
   */
  function updateQueueDisplay(queue) {
    const listEl = document.getElementById('queue-list');
    const countEl = document.getElementById('queue-count-badge');

    if (!listEl) return;

    countEl.textContent = queue.length;

    if (queue.length === 0) {
      listEl.innerHTML = '<div class="queue-empty">No one in queue yet</div>';
      return;
    }

    listEl.innerHTML = queue.map((item, index) => {
      const isYou = item.user_id === currentUserId;
      const isCurrent = item.status === 'called';
      
      return `
        <div class="queue-item ${isYou ? 'you' : ''} ${isCurrent ? 'current' : ''}">
          <div class="queue-position">${index + 1}</div>
          <div class="queue-name">
            ${item.user_name || 'Anonymous'}
            ${isYou ? ' (You)' : ''}
            ${isCurrent ? ' 🎤' : ''}
          </div>
          ${isHost && !isCurrent ? `<button onclick="skipPerson('${item.user_id}')" style="background:none;border:none;cursor:pointer;opacity:0.5;">⏭️</button>` : ''}
        </div>
      `;
    }).join('');
  }

  /**
   * Update user's status display
   */
  function updateUserStatus() {
    const statusEl = document.getElementById('queue-user-status');
    if (!statusEl) return;

    if (!isInQueue) {
      statusEl.style.display = 'none';
      return;
    }

    statusEl.style.display = 'block';
    
    if (queuePosition === 1) {
      statusEl.className = 'queue-status your-turn';
      statusEl.innerHTML = '🎤 Your turn! Get ready to join!';
    } else {
      statusEl.className = 'queue-status waiting';
      statusEl.innerHTML = `⏳ You're #${queuePosition} in queue`;
    }
  }

  /**
   * Update action buttons based on state
   */
  function updateActionButtons() {
    const actionsEl = document.getElementById('queue-actions');
    if (!actionsEl || isHost) {
      if (actionsEl) actionsEl.innerHTML = '';
      return;
    }

    if (isInQueue) {
      actionsEl.innerHTML = `
        <button class="queue-btn queue-btn-secondary" onclick="leaveQueue()">
          Leave Queue
        </button>
      `;
    } else {
      actionsEl.innerHTML = `
        <button class="queue-btn queue-btn-primary" onclick="joinQueue()">
          🎤 Join Queue
        </button>
      `;
    }
  }

  /**
   * Join the queue
   */
  window.joinQueue = async function() {
    if (!currentRoomId || !currentUserId) {
      alert('Please sign in to join the queue');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/room-queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'join',
          roomId: currentRoomId,
          userId: currentUserId,
          userName: currentUserName,
        }),
      });

      const data = await response.json();

      if (data.success) {
        isInQueue = true;
        queuePosition = data.position;
        fetchQueue();
        console.log('✅ Joined queue at position', data.position);
      } else {
        alert(data.error || 'Failed to join queue');
      }
    } catch (error) {
      console.error('Error joining queue:', error);
      alert('Failed to join queue');
    }
  };

  /**
   * Leave the queue
   */
  window.leaveQueue = async function() {
    if (!currentRoomId || !currentUserId) return;

    try {
      const response = await fetch(`${API_BASE}/room-queue`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: currentRoomId,
          userId: currentUserId,
        }),
      });

      const data = await response.json();

      if (data.success) {
        isInQueue = false;
        queuePosition = null;
        fetchQueue();
        console.log('✅ Left queue');
      }
    } catch (error) {
      console.error('Error leaving queue:', error);
    }
  };

  /**
   * Host calls next person
   */
  window.callNextPerson = async function() {
    if (!currentRoomId || !currentUserId || !isHost) return;

    const btn = document.getElementById('next-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Calling next...';
    }

    try {
      const response = await fetch(`${API_BASE}/room-queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'next',
          roomId: currentRoomId,
          hostId: currentUserId,
        }),
      });

      const data = await response.json();

      if (data.success) {
        if (data.queueEmpty) {
          alert('Queue is empty! Waiting for more challengers...');
        } else {
          console.log('📢 Next person:', data.nextPerson);
          // The room will handle connecting the next person
          if (window.onNextChallenger) {
            window.onNextChallenger(data.nextPerson);
          }
        }
        fetchQueue();
      }
    } catch (error) {
      console.error('Error calling next:', error);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '⏭️ Next Challenger';
      }
    }
  };

  /**
   * Host skips someone
   */
  window.skipPerson = async function(userId) {
    if (!currentRoomId || !currentUserId || !isHost) return;

    try {
      const response = await fetch(`${API_BASE}/room-queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'skip',
          roomId: currentRoomId,
          hostId: currentUserId,
          skipUserId: userId,
        }),
      });

      const data = await response.json();
      if (data.success) {
        fetchQueue();
      }
    } catch (error) {
      console.error('Error skipping:', error);
    }
  };

  /**
   * Toggle queue panel visibility
   */
  window.toggleQueuePanel = function() {
    const content = document.getElementById('queue-content');
    const btn = document.querySelector('.queue-minimize');
    
    if (content.style.display === 'none') {
      content.style.display = 'block';
      btn.textContent = '−';
    } else {
      content.style.display = 'none';
      btn.textContent = '+';
    }
  };

  /**
   * Start polling for queue updates
   */
  function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(fetchQueue, 5000); // Poll every 5 seconds
  }

  /**
   * Stop polling
   */
  window.stopQueuePolling = function() {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  };

  /**
   * Cleanup when leaving room
   */
  window.cleanupRoomQueue = function() {
    stopQueuePolling();
    const panel = document.getElementById('queue-panel');
    if (panel) panel.remove();
  };

})();
