/**
 * Forum-Single.js - Individual Forum View
 */

let currentUser = null;
let forumData = null;
let userData = null;
let supabaseClient = null;

// Get forum slug from URL
function getForumSlug() {
  const path = window.location.pathname;
  const match = path.match(/^\/f\/([^\/]+)/);
  return match ? match[1] : null;
}

// Initialize
async function init() {
  const config = window.__CHATSPHERES_CONFIG__ || {};
  if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
    console.error('Config not loaded');
    setTimeout(init, 500);
    return;
  }
  
  supabaseClient = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  
  // Check auth
  const { data: { user } } = await supabaseClient.auth.getUser();
  currentUser = user;
  
  // Get forum slug
  const slug = getForumSlug();
  if (!slug) {
    showError('Forum not found', 'No forum specified.');
    return;
  }
  
  // Load forum
  loadForum(slug);
  
  // Setup modal
  setupInviteModal();
}

async function loadForum(slug) {
  try {
    const params = new URLSearchParams({ slug });
    if (currentUser) params.append('userId', currentUser.id);
    
    // Check for invite code in URL
    const urlParams = new URLSearchParams(window.location.search);
    const inviteCode = urlParams.get('invite');
    
    const res = await fetch(`/.netlify/functions/get-forum?${params}`);
    const data = await res.json();
    
    if (!res.ok) {
      if (data.requiresInvite && inviteCode) {
        // Try to join with invite code
        await joinWithInvite(slug, inviteCode);
        return;
      }
      if (data.requiresInvite) {
        showInviteRequired(slug);
        return;
      }
      if (data.requiresAuth) {
        showError('Private Forum', 'Sign in to access this forum.');
        return;
      }
      throw new Error(data.error || 'Forum not found');
    }
    
    forumData = data.forum;
    userData = data.user;
    
    // Check if banned
    if (userData?.isBanned) {
      showBanned();
      return;
    }
    
    renderForum(data);
    
    // Update page title
    document.title = `${forumData.name} - Tivoq`;
  } catch (err) {
    console.error('Error loading forum:', err);
    showError('Error', err.message);
  }
}

function renderForum(data) {
  const { forum, user, moderators, announcements, activeRooms } = data;
  
  const categoryIcons = {
    gaming: '🎮', technology: '💻', music: '🎵', entertainment: '🎬',
    business: '💼', education: '📚', fitness: '💪', creative: '🎨',
    just_chatting: '💬', other: '📁'
  };
  
  const icon = forum.iconUrl ? `<img src="${forum.iconUrl}" alt="">` : (categoryIcons[forum.category] || '💬');
  
  const main = document.getElementById('forumMain');
  main.innerHTML = `
    <!-- Banner -->
    <div class="forum-banner" ${forum.primaryColor ? `style="background: linear-gradient(135deg, ${forum.primaryColor} 0%, var(--gold) 100%)"` : ''}>
      ${forum.bannerUrl ? `<img src="${forum.bannerUrl}" alt="">` : ''}
    </div>
    
    <!-- Header -->
    <div class="forum-header">
      <div class="forum-icon">${icon}</div>
      
      <div class="forum-info">
        <div class="forum-meta">
          <h1 class="forum-name">
            ${escapeHtml(forum.name)}
            ${forum.isNsfw ? '<span class="badge nsfw-badge">NSFW</span>' : ''}
            ${forum.forumType === 'private' ? '<span class="badge private-badge">Private</span>' : ''}
          </h1>
          <div class="forum-slug">f/${forum.slug}</div>
          
          <div class="forum-stats">
            <div class="forum-stat">
              <div class="forum-stat-value">${formatNumber(forum.memberCount || 0)}</div>
              <div class="forum-stat-label">Members</div>
            </div>
            <div class="forum-stat">
              <div class="forum-stat-value">${forum.activeRoomCount || 0}</div>
              <div class="forum-stat-label">Live Now</div>
            </div>
            <div class="forum-stat">
              <div class="forum-stat-value">${forum.roomCount || 0}</div>
              <div class="forum-stat-label">Total Rooms</div>
            </div>
          </div>
        </div>
        
        <div class="forum-actions">
          ${renderActionButtons(user, forum)}
        </div>
      </div>
    </div>
    
    <!-- Content -->
    <div class="forum-content">
      <!-- Main Area -->
      <div class="forum-main-area">
        ${announcements && announcements.length > 0 ? `
          <div class="rooms-section" style="margin-bottom: var(--space-lg);">
            <h2 class="rooms-section-title">📌 Announcements</h2>
            ${announcements.map(a => `
              <div class="announcement">
                <div class="announcement-title">${escapeHtml(a.title)}</div>
                ${a.content ? `<div class="announcement-content">${escapeHtml(a.content)}</div>` : ''}
              </div>
            `).join('')}
          </div>
        ` : ''}
        
        <div class="rooms-section">
          <h2 class="rooms-section-title">
            ${activeRooms && activeRooms.length > 0 ? '🔴 Live Rooms' : '📺 Rooms'}
          </h2>
          <div class="rooms-grid" id="roomsGrid">
            ${renderRooms(activeRooms)}
          </div>
        </div>
      </div>
      
      <!-- Sidebar -->
      <aside class="forum-sidebar">
        ${forum.description ? `
          <div class="sidebar-card">
            <h3 class="sidebar-card-title">About</h3>
            <div class="forum-description">${escapeHtml(forum.description)}</div>
          </div>
        ` : ''}
        
        ${forum.rules ? `
          <div class="sidebar-card">
            <h3 class="sidebar-card-title">Rules</h3>
            <div class="forum-rules">${escapeHtml(forum.rules)}</div>
          </div>
        ` : ''}
        
        ${moderators && moderators.length > 0 ? `
          <div class="sidebar-card">
            <h3 class="sidebar-card-title">Moderators (${moderators.length})</h3>
            <div class="moderators-list">
              ${moderators.slice(0, 10).map(m => `
                <span class="mod-badge">🛡️ ${m.substring(0, 8)}...</span>
              `).join('')}
            </div>
          </div>
        ` : ''}
        
        <div class="sidebar-card">
          <h3 class="sidebar-card-title">Category</h3>
          <span style="font-size: 1.2rem;">${categoryIcons[forum.category] || '📁'}</span>
          <span style="text-transform: capitalize;">${forum.category?.replace('_', ' ') || 'Other'}</span>
        </div>
      </aside>
    </div>
  `;
}

function renderActionButtons(user, forum) {
  if (!currentUser) {
    return `<a href="/" class="forum-btn forum-btn-primary">Sign in to Join</a>`;
  }
  
  let buttons = [];
  
  if (user?.isMember) {
    buttons.push(`<button class="forum-btn forum-btn-joined" disabled>✓ Joined</button>`);
    
    if (user.role !== 'owner') {
      buttons.push(`<button class="forum-btn forum-btn-secondary" onclick="leaveForum()">Leave</button>`);
    }
    
    // Start room button for members
    buttons.push(`<a href="/?createRoom=true&forum=${forum.id}" class="forum-btn forum-btn-primary">▶️ Start Room</a>`);
    
    if (user.canModerate) {
      buttons.push(`<button class="forum-btn forum-btn-secondary" onclick="openSettings()">⚙️ Settings</button>`);
    }
  } else {
    buttons.push(`<button class="forum-btn forum-btn-primary" onclick="joinForum()">Join Forum</button>`);
  }
  
  return buttons.join('');
}

function renderRooms(rooms) {
  if (!rooms || rooms.length === 0) {
    return `
      <div class="empty-state">
        <p>No active rooms right now.</p>
        ${userData?.isMember ? '<p>Be the first to start one!</p>' : ''}
      </div>
    `;
  }
  
  return rooms.map(room => `
    <a href="${room.room_url || `/?room=${room.room_id}`}" class="room-card">
      <div class="room-card-title">${escapeHtml(room.title || 'Untitled Room')}</div>
      <div class="room-card-host">Hosted by ${escapeHtml(room.host_name || 'Anonymous')}</div>
      <span class="room-card-status">🔴 Live</span>
    </a>
  `).join('');
}

async function joinForum() {
  if (!currentUser) {
    window.location.href = '/';
    return;
  }
  
  try {
    const res = await fetch('/.netlify/functions/join-forum', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUser.id,
        forumSlug: getForumSlug(),
      }),
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      if (data.requiresInvite) {
        document.getElementById('inviteModal').style.display = 'flex';
        return;
      }
      throw new Error(data.error || 'Failed to join');
    }
    
    // Reload page
    window.location.reload();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function leaveForum() {
  if (!confirm('Are you sure you want to leave this forum?')) return;
  
  try {
    const res = await fetch('/.netlify/functions/leave-forum', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUser.id,
        forumSlug: getForumSlug(),
      }),
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.error || 'Failed to leave');
    }
    
    window.location.reload();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function joinWithInvite(slug, inviteCode) {
  try {
    const res = await fetch('/.netlify/functions/join-forum', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUser?.id,
        forumSlug: slug,
        inviteCode,
      }),
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      if (!currentUser) {
        showError('Sign In Required', 'Please sign in to use this invite code.');
        return;
      }
      throw new Error(data.error || 'Invalid invite code');
    }
    
    // Remove invite from URL and reload
    window.history.replaceState({}, '', `/f/${slug}`);
    window.location.reload();
  } catch (err) {
    showError('Invalid Invite', err.message);
  }
}

function setupInviteModal() {
  document.getElementById('inviteCancelBtn').addEventListener('click', () => {
    document.getElementById('inviteModal').style.display = 'none';
  });
  
  document.getElementById('inviteSubmitBtn').addEventListener('click', async () => {
    const code = document.getElementById('inviteCodeInput').value.trim();
    if (!code) return;
    
    await joinWithInvite(getForumSlug(), code);
  });
}

function showInviteRequired(slug) {
  const main = document.getElementById('forumMain');
  main.innerHTML = `
    <div class="error-state">
      <h2>🔒 Private Forum</h2>
      <p style="margin-bottom: var(--space-lg); color: var(--charcoal);">This forum is private. You need an invite to join.</p>
      ${currentUser ? `
        <div style="max-width: 300px; margin: 0 auto;">
          <input type="text" class="form-input" id="inviteInput" placeholder="Enter invite code..." style="margin-bottom: var(--space-sm);">
          <button class="forum-btn forum-btn-primary" onclick="submitInviteCode()" style="width: 100%;">Join with Invite</button>
        </div>
      ` : `
        <a href="/" class="forum-btn forum-btn-primary">Sign In</a>
      `}
      <p style="margin-top: var(--space-lg);"><a href="/forums">← Back to Forums</a></p>
    </div>
  `;
}

function submitInviteCode() {
  const code = document.getElementById('inviteInput').value.trim();
  if (code) joinWithInvite(getForumSlug(), code);
}

function showBanned() {
  const main = document.getElementById('forumMain');
  main.innerHTML = `
    <div class="banned-message">
      <h2>🚫 You are banned from this forum</h2>
      <p>You cannot view or participate in this forum.</p>
      <p style="margin-top: var(--space-lg);"><a href="/forums">← Back to Forums</a></p>
    </div>
  `;
}

function showError(title, message) {
  const main = document.getElementById('forumMain');
  main.innerHTML = `
    <div class="error-state">
      <h2>${title}</h2>
      <p style="color: var(--charcoal); opacity: 0.7;">${message}</p>
      <p style="margin-top: var(--space-lg);"><a href="/forums">← Back to Forums</a></p>
    </div>
  `;
}

function openSettings() {
  alert('Forum settings coming soon!');
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

// Initialize when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
