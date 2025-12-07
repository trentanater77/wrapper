/**
 * Forums.js - Explore Forums Page
 */

// State
let currentFilter = 'top';
let currentCategory = 'all';
let currentPage = 1;
let currentUser = null;
let supabaseClient = null;

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
  if (user) {
    currentUser = user;
    document.getElementById('createForumBtn').style.display = 'flex';
    document.getElementById('myForumsSection').style.display = 'block';
    document.getElementById('joinedTab').style.display = 'block';
  }
  
  // Setup event listeners
  setupEventListeners();
  
  // Load forums
  loadForums();
  loadLiveRooms();
}

function setupEventListeners() {
  // Sidebar links
  document.querySelectorAll('.sidebar-link[data-filter]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      setFilter(link.dataset.filter);
    });
  });
  
  // Category links
  document.querySelectorAll('.sidebar-link[data-category]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      setCategory(link.dataset.category);
    });
  });
  
  // Filter tabs (mobile)
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      setFilter(tab.dataset.filter);
    });
  });
  
  // Search
  document.getElementById('searchBtn').addEventListener('click', doSearch);
  document.getElementById('searchInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') doSearch();
  });
}

function setFilter(filter) {
  currentFilter = filter;
  currentPage = 1;
  
  // Update UI
  document.querySelectorAll('.sidebar-link[data-filter]').forEach(l => l.classList.remove('active'));
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  
  document.querySelector(`.sidebar-link[data-filter="${filter}"]`)?.classList.add('active');
  document.querySelector(`.filter-tab[data-filter="${filter}"]`)?.classList.add('active');
  
  loadForums();
}

function setCategory(category) {
  currentCategory = category;
  currentPage = 1;
  
  // Update UI
  document.querySelectorAll('.sidebar-link[data-category]').forEach(l => l.classList.remove('active'));
  document.querySelector(`.sidebar-link[data-category="${category}"]`)?.classList.add('active');
  
  loadForums();
}

function doSearch() {
  const query = document.getElementById('searchInput').value.trim();
  if (!query) return;
  
  currentFilter = 'search';
  currentPage = 1;
  loadForums(query);
}

async function loadForums(search = null) {
  const container = document.getElementById('forumsContainer');
  container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
  
  try {
    const params = new URLSearchParams({
      filter: currentFilter,
      page: currentPage,
      limit: 20,
    });
    
    if (currentUser) params.append('userId', currentUser.id);
    if (currentCategory !== 'all') params.append('category', currentCategory);
    if (search) params.append('search', search);
    
    const res = await fetch(`/.netlify/functions/list-forums?${params}`);
    const data = await res.json();
    
    if (!res.ok) throw new Error(data.error || 'Failed to load forums');
    
    renderForums(data.forums, data.pagination);
  } catch (err) {
    console.error('Error loading forums:', err);
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">😕</div>
        <p>Failed to load forums. Please try again.</p>
      </div>
    `;
  }
}

function renderForums(forums, pagination) {
  const container = document.getElementById('forumsContainer');
  
  if (!forums || forums.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <p>No forums found. ${currentUser ? '<a href="/create-forum">Create one!</a>' : ''}</p>
      </div>
    `;
    return;
  }
  
  const categoryIcons = {
    gaming: '🎮', technology: '💻', music: '🎵', entertainment: '🎬',
    business: '💼', education: '📚', fitness: '💪', creative: '🎨',
    just_chatting: '💬', other: '📁'
  };
  
  let html = '<div class="forums-grid">';
  
  forums.forEach(forum => {
    const icon = forum.iconUrl ? `<img src="${forum.iconUrl}" alt="">` : (categoryIcons[forum.category] || '💬');
    const banner = forum.bannerUrl ? `<img src="${forum.bannerUrl}" alt="">` : '';
    
    html += `
      <a href="/f/${forum.slug}" class="forum-card">
        <div class="forum-card-banner" ${forum.primaryColor ? `style="background: ${forum.primaryColor}"` : ''}>
          ${banner}
          <div class="forum-card-icon">${icon}</div>
        </div>
        <div class="forum-card-body">
          <div class="forum-card-name">
            ${forum.name}
            ${forum.isNsfw ? '<span class="nsfw-badge">NSFW</span>' : ''}
          </div>
          <div class="forum-card-slug">f/${forum.slug}</div>
          ${forum.description ? `<div class="forum-card-desc">${escapeHtml(forum.description)}</div>` : ''}
          <div class="forum-card-stats">
            <span class="forum-card-stat">👥 ${formatNumber(forum.memberCount || 0)}</span>
            ${forum.activeRoomCount > 0 ? `<span class="forum-card-stat live">🔴 ${forum.activeRoomCount} live</span>` : ''}
          </div>
        </div>
      </a>
    `;
  });
  
  html += '</div>';
  
  // Pagination
  if (pagination && pagination.totalPages > 1) {
    html += `
      <div style="display: flex; justify-content: center; gap: var(--space-sm); margin-top: var(--space-xl);">
        ${pagination.page > 1 ? `<button class="filter-tab" onclick="changePage(${pagination.page - 1})">← Previous</button>` : ''}
        <span style="padding: var(--space-sm); color: var(--charcoal);">Page ${pagination.page} of ${pagination.totalPages}</span>
        ${pagination.page < pagination.totalPages ? `<button class="filter-tab" onclick="changePage(${pagination.page + 1})">Next →</button>` : ''}
      </div>
    `;
  }
  
  container.innerHTML = html;
}

async function loadLiveRooms() {
  try {
    const res = await fetch('/.netlify/functions/list-forums?filter=live&limit=10');
    const data = await res.json();
    
    if (!data.forums || data.forums.length === 0) {
      document.getElementById('liveSection').style.display = 'none';
      return;
    }
    
    // Get active rooms from forums with live rooms
    const liveForums = data.forums.filter(f => f.activeRoomCount > 0);
    if (liveForums.length === 0) {
      document.getElementById('liveSection').style.display = 'none';
      return;
    }
    
    document.getElementById('liveSection').style.display = 'block';
    
    // For now, show forum cards with live indicator
    const scroll = document.getElementById('liveRoomsScroll');
    scroll.innerHTML = liveForums.map(forum => `
      <a href="/f/${forum.slug}" class="live-room-card">
        <div class="live-room-title">${escapeHtml(forum.name)}</div>
        <div class="live-room-forum">f/${forum.slug}</div>
        <div class="live-room-host">🔴 ${forum.activeRoomCount} room${forum.activeRoomCount > 1 ? 's' : ''} live</div>
      </a>
    `).join('');
  } catch (err) {
    console.error('Error loading live rooms:', err);
    document.getElementById('liveSection').style.display = 'none';
  }
}

function changePage(page) {
  currentPage = page;
  loadForums();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
