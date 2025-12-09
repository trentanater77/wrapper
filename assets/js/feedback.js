/**
 * ChatSpheres Feedback System
 * 
 * Mobile-friendly bug report and improvement request forms
 * Include this script on any page to add the feedback button
 */

(function() {
  'use strict';

  // Don't initialize if already done
  if (window.__CHATSPHERES_FEEDBACK_INIT__) return;
  window.__CHATSPHERES_FEEDBACK_INIT__ = true;

  // Inject styles
  const styles = `
    /* Feedback FAB Button */
    .cs-feedback-fab {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: linear-gradient(135deg, #e63946 0%, #c1121f 100%);
      color: white;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(230, 57, 70, 0.4);
      z-index: 9990;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
      transition: all 0.3s ease;
    }
    
    .cs-feedback-fab:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 20px rgba(230, 57, 70, 0.5);
    }
    
    .cs-feedback-fab:active {
      transform: scale(0.95);
    }
    
    /* Feedback Modal */
    .cs-feedback-modal {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      background: rgba(34, 34, 59, 0.9);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }
    
    .cs-feedback-modal.active {
      display: flex;
    }
    
    .cs-feedback-content {
      background: #FFF8F5;
      border-radius: 1.5rem;
      width: 100%;
      max-width: 500px;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      border: 3px solid #F5B942;
      animation: cs-feedback-slide-up 0.3s ease;
    }
    
    @keyframes cs-feedback-slide-up {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    .cs-feedback-header {
      padding: 1.25rem 1.5rem;
      border-bottom: 2px solid #FCE2E5;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      background: #FFF8F5;
      border-radius: 1.5rem 1.5rem 0 0;
      z-index: 1;
    }
    
    .cs-feedback-title {
      font-size: 1.25rem;
      font-weight: 800;
      color: #22223B;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    .cs-feedback-close {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: none;
      background: #FCE2E5;
      color: #22223B;
      font-size: 1.5rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }
    
    .cs-feedback-close:hover {
      background: #e63946;
      color: white;
    }
    
    .cs-feedback-body {
      padding: 1.5rem;
    }
    
    /* Tab Buttons */
    .cs-feedback-tabs {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
    }
    
    .cs-feedback-tab {
      flex: 1;
      padding: 0.875rem 1rem;
      border: 2px solid #FCE2E5;
      border-radius: 1rem;
      background: white;
      color: #22223B;
      font-weight: 700;
      font-size: 0.875rem;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
    }
    
    .cs-feedback-tab:hover {
      border-color: #F5B942;
    }
    
    .cs-feedback-tab.active {
      background: linear-gradient(135deg, #e63946 0%, #c1121f 100%);
      color: white;
      border-color: #e63946;
    }
    
    .cs-feedback-tab-icon {
      font-size: 1.25rem;
    }
    
    /* Form Styles */
    .cs-feedback-form {
      display: none;
    }
    
    .cs-feedback-form.active {
      display: block;
    }
    
    .cs-feedback-group {
      margin-bottom: 1rem;
    }
    
    .cs-feedback-label {
      display: block;
      font-size: 0.875rem;
      font-weight: 700;
      color: #22223B;
      margin-bottom: 0.375rem;
    }
    
    .cs-feedback-input,
    .cs-feedback-select,
    .cs-feedback-textarea {
      width: 100%;
      padding: 0.75rem 1rem;
      border: 2px solid #FCE2E5;
      border-radius: 0.75rem;
      font-size: 1rem;
      font-family: inherit;
      background: white;
      color: #22223B;
      transition: border-color 0.2s;
      box-sizing: border-box;
    }
    
    .cs-feedback-input:focus,
    .cs-feedback-select:focus,
    .cs-feedback-textarea:focus {
      outline: none;
      border-color: #e63946;
    }
    
    .cs-feedback-textarea {
      min-height: 120px;
      resize: vertical;
    }
    
    .cs-feedback-hint {
      font-size: 0.75rem;
      color: #22223B;
      opacity: 0.6;
      margin-top: 0.25rem;
    }
    
    /* Submit Button */
    .cs-feedback-submit {
      width: 100%;
      padding: 1rem;
      background: linear-gradient(135deg, #e63946 0%, #c1121f 100%);
      color: white;
      border: none;
      border-radius: 2rem;
      font-size: 1rem;
      font-weight: 800;
      cursor: pointer;
      transition: all 0.3s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      margin-top: 1.5rem;
    }
    
    .cs-feedback-submit:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(230, 57, 70, 0.4);
    }
    
    .cs-feedback-submit:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }
    
    /* Success Message */
    .cs-feedback-success {
      text-align: center;
      padding: 2rem 1rem;
    }
    
    .cs-feedback-success-icon {
      font-size: 4rem;
      margin-bottom: 1rem;
      animation: cs-feedback-bounce 0.5s ease;
    }
    
    @keyframes cs-feedback-bounce {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.2); }
    }
    
    .cs-feedback-success h3 {
      font-size: 1.25rem;
      font-weight: 800;
      color: #22223B;
      margin-bottom: 0.5rem;
    }
    
    .cs-feedback-success p {
      color: #22223B;
      opacity: 0.7;
      margin-bottom: 1.5rem;
    }
    
    .cs-feedback-success-btn {
      padding: 0.75rem 2rem;
      background: #F5B942;
      color: #22223B;
      border: none;
      border-radius: 2rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .cs-feedback-success-btn:hover {
      background: #e63946;
      color: white;
    }
    
    /* Message */
    .cs-feedback-message {
      padding: 0.75rem 1rem;
      border-radius: 0.75rem;
      font-size: 0.875rem;
      font-weight: 600;
      margin-bottom: 1rem;
      display: none;
    }
    
    .cs-feedback-message.error {
      display: block;
      background: #e63946;
      color: white;
    }
    
    .cs-feedback-message.success {
      display: block;
      background: #F5B942;
      color: #22223B;
    }
    
    /* Mobile Responsiveness */
    @media (max-width: 480px) {
      .cs-feedback-fab {
        bottom: 16px;
        right: 16px;
        width: 50px;
        height: 50px;
        font-size: 1.25rem;
      }
      
      .cs-feedback-modal {
        padding: 0.5rem;
      }
      
      .cs-feedback-content {
        border-radius: 1.25rem;
        max-height: 95vh;
      }
      
      .cs-feedback-header {
        padding: 1rem;
        border-radius: 1.25rem 1.25rem 0 0;
      }
      
      .cs-feedback-title {
        font-size: 1.1rem;
      }
      
      .cs-feedback-body {
        padding: 1rem;
      }
      
      .cs-feedback-tabs {
        gap: 0.375rem;
      }
      
      .cs-feedback-tab {
        padding: 0.75rem 0.5rem;
        font-size: 0.75rem;
      }
      
      .cs-feedback-tab-icon {
        font-size: 1.125rem;
      }
      
      .cs-feedback-input,
      .cs-feedback-select,
      .cs-feedback-textarea {
        padding: 0.625rem 0.875rem;
        font-size: 16px; /* Prevents zoom on iOS */
      }
      
      .cs-feedback-submit {
        padding: 0.875rem;
        font-size: 0.9375rem;
      }
    }
    
    /* Avoid collision with other floating buttons */
    .cs-feedback-fab.shifted {
      bottom: 90px;
    }
  `;

  // Inject style tag
  const styleTag = document.createElement('style');
  styleTag.id = 'cs-feedback-styles';
  styleTag.textContent = styles;
  document.head.appendChild(styleTag);

  // Create modal HTML
  const modalHTML = `
    <div id="cs-feedback-modal" class="cs-feedback-modal">
      <div class="cs-feedback-content">
        <div class="cs-feedback-header">
          <h2 class="cs-feedback-title">
            <span>💬</span> Send Feedback
          </h2>
          <button class="cs-feedback-close" onclick="window.closeFeedbackModal()" aria-label="Close">&times;</button>
        </div>
        
        <div class="cs-feedback-body">
          <!-- Tabs -->
          <div class="cs-feedback-tabs">
            <button class="cs-feedback-tab active" data-tab="improvement" onclick="window.switchFeedbackTab('improvement')">
              <span class="cs-feedback-tab-icon">💡</span>
              <span>Suggestion</span>
            </button>
            <button class="cs-feedback-tab" data-tab="bug" onclick="window.switchFeedbackTab('bug')">
              <span class="cs-feedback-tab-icon">🐛</span>
              <span>Bug Report</span>
            </button>
          </div>
          
          <!-- Message -->
          <div id="cs-feedback-message" class="cs-feedback-message"></div>
          
          <!-- Improvement Form -->
          <form id="cs-improvement-form" class="cs-feedback-form active" onsubmit="window.submitImprovement(event)">
            <div class="cs-feedback-group">
              <label class="cs-feedback-label">Category</label>
              <select id="cs-improvement-category" class="cs-feedback-select" required>
                <option value="feature">✨ New Feature</option>
                <option value="ui">🎨 UI/Design</option>
                <option value="mobile">📱 Mobile Experience</option>
                <option value="performance">⚡ Performance</option>
                <option value="accessibility">♿ Accessibility</option>
                <option value="integration">🔗 Integration</option>
                <option value="other">💭 Other</option>
              </select>
            </div>
            
            <div class="cs-feedback-group">
              <label class="cs-feedback-label">Title</label>
              <input type="text" id="cs-improvement-title" class="cs-feedback-input" placeholder="Brief summary of your idea" required minlength="5" maxlength="200">
              <p class="cs-feedback-hint">Min 5 characters</p>
            </div>
            
            <div class="cs-feedback-group">
              <label class="cs-feedback-label">Description</label>
              <textarea id="cs-improvement-description" class="cs-feedback-textarea" placeholder="Describe your suggestion in detail. What problem does it solve? How would it work?" required minlength="20" maxlength="2000"></textarea>
              <p class="cs-feedback-hint">Min 20 characters - Be as detailed as possible!</p>
            </div>
            
            <div class="cs-feedback-group">
              <label class="cs-feedback-label">Priority (optional)</label>
              <select id="cs-improvement-priority" class="cs-feedback-select">
                <option value="normal">Normal</option>
                <option value="low">Low - Nice to have</option>
                <option value="high">High - Important for me</option>
              </select>
            </div>
            
            <button type="submit" class="cs-feedback-submit" id="cs-improvement-submit">
              <span>💡</span> Submit Suggestion
            </button>
          </form>
          
          <!-- Bug Report Form -->
          <form id="cs-bug-form" class="cs-feedback-form" onsubmit="window.submitBugReport(event)">
            <div class="cs-feedback-group">
              <label class="cs-feedback-label">Category</label>
              <select id="cs-bug-category" class="cs-feedback-select" required>
                <option value="video">📹 Video Issues</option>
                <option value="audio">🔊 Audio Issues</option>
                <option value="connection">🔌 Connection Problems</option>
                <option value="chat">💬 Chat Issues</option>
                <option value="ui">🎨 UI/Display Bugs</option>
                <option value="performance">⚡ Performance/Speed</option>
                <option value="other">🐛 Other</option>
              </select>
            </div>
            
            <div class="cs-feedback-group">
              <label class="cs-feedback-label">What happened?</label>
              <textarea id="cs-bug-description" class="cs-feedback-textarea" placeholder="Describe what went wrong. What were you trying to do? What happened instead?" required minlength="10" maxlength="1000"></textarea>
              <p class="cs-feedback-hint">Min 10 characters - Include steps to reproduce if possible</p>
            </div>
            
            <button type="submit" class="cs-feedback-submit" id="cs-bug-submit">
              <span>🐛</span> Submit Bug Report
            </button>
          </form>
          
          <!-- Success State -->
          <div id="cs-feedback-success" class="cs-feedback-success" style="display: none;">
            <div class="cs-feedback-success-icon">✅</div>
            <h3>Thank You!</h3>
            <p id="cs-feedback-success-message">Your feedback has been submitted.</p>
            <button class="cs-feedback-success-btn" onclick="window.closeFeedbackModal()">Done</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Create FAB button
  const fabHTML = `
    <button id="cs-feedback-fab" class="cs-feedback-fab" onclick="window.openFeedbackModal()" title="Send Feedback" aria-label="Send feedback">
      💬
    </button>
  `;

  // Wait for DOM to be ready
  function initFeedback() {
    console.log('💬 Initializing feedback component...');
    
    // Check if we're on a page that already has custom feedback (like index.html video chat)
    const existingBugBtn = document.getElementById('floating-bug-btn');
    
    // Add FAB
    const fabContainer = document.createElement('div');
    fabContainer.innerHTML = fabHTML;
    document.body.appendChild(fabContainer.firstElementChild);
    console.log('💬 Feedback FAB button added');
    
    // Shift FAB if there are other floating buttons
    if (existingBugBtn || document.getElementById('floating-tip-btn')) {
      const fab = document.getElementById('cs-feedback-fab');
      if (fab) fab.classList.add('shifted');
    }
    
    // Add Modal
    const modalContainer = document.createElement('div');
    modalContainer.innerHTML = modalHTML;
    document.body.appendChild(modalContainer.firstElementChild);
  }

  // Modal functions
  window.openFeedbackModal = function() {
    const modal = document.getElementById('cs-feedback-modal');
    if (modal) {
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
      // Reset to initial state
      resetFeedbackForms();
    }
  };

  window.closeFeedbackModal = function() {
    const modal = document.getElementById('cs-feedback-modal');
    if (modal) {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }
  };

  window.switchFeedbackTab = function(tab) {
    // Update tab buttons
    document.querySelectorAll('.cs-feedback-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    
    // Update forms
    document.getElementById('cs-improvement-form').classList.toggle('active', tab === 'improvement');
    document.getElementById('cs-bug-form').classList.toggle('active', tab === 'bug');
    
    // Hide success and messages
    document.getElementById('cs-feedback-success').style.display = 'none';
    document.getElementById('cs-feedback-message').className = 'cs-feedback-message';
  };

  function resetFeedbackForms() {
    document.getElementById('cs-improvement-form').reset();
    document.getElementById('cs-bug-form').reset();
    document.getElementById('cs-improvement-form').classList.add('active');
    document.getElementById('cs-bug-form').classList.remove('active');
    document.getElementById('cs-feedback-success').style.display = 'none';
    document.getElementById('cs-feedback-message').className = 'cs-feedback-message';
    document.querySelectorAll('.cs-feedback-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === 'improvement');
    });
  }

  function showFeedbackMessage(message, isError = false) {
    const el = document.getElementById('cs-feedback-message');
    el.textContent = message;
    el.className = `cs-feedback-message ${isError ? 'error' : 'success'}`;
  }

  function getDeviceInfo() {
    return {
      userAgent: navigator.userAgent.substring(0, 200),
      platform: navigator.platform,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      language: navigator.language,
      online: navigator.onLine
    };
  }

  function getCurrentUser() {
    // Try to get user from various sources
    const config = window.__CHATSPHERES_CONFIG__ || {};
    
    // Check if there's a Supabase session
    if (window.supabaseClient) {
      try {
        const session = window.supabaseClient.auth.getSession();
        if (session?.data?.session?.user) {
          const user = session.data.session.user;
          return {
            id: user.id,
            name: user.user_metadata?.name || user.email?.split('@')[0] || 'User',
            email: user.email
          };
        }
      } catch (e) {}
    }
    
    // Try localStorage
    try {
      const storedUser = localStorage.getItem('chatspheres_user');
      if (storedUser) {
        return JSON.parse(storedUser);
      }
    } catch (e) {}
    
    return { id: 'guest', name: 'Guest', email: null };
  }

  // Submit improvement request
  window.submitImprovement = async function(event) {
    event.preventDefault();
    
    const submitBtn = document.getElementById('cs-improvement-submit');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⏳</span> Submitting...';
    
    try {
      const user = getCurrentUser();
      const payload = {
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        category: document.getElementById('cs-improvement-category').value,
        title: document.getElementById('cs-improvement-title').value.trim(),
        description: document.getElementById('cs-improvement-description').value.trim(),
        priority: document.getElementById('cs-improvement-priority').value,
        deviceInfo: getDeviceInfo(),
        url: window.location.href,
        timestamp: new Date().toISOString()
      };
      
      const response = await fetch('/.netlify/functions/submit-improvement-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      
      if (data.success) {
        // Show success state
        document.getElementById('cs-improvement-form').style.display = 'none';
        document.getElementById('cs-feedback-success').style.display = 'block';
        document.getElementById('cs-feedback-success-message').textContent = 
          'Your suggestion has been submitted. We review all feedback regularly!';
      } else {
        throw new Error(data.error || 'Failed to submit');
      }
    } catch (error) {
      console.error('Improvement submit error:', error);
      showFeedbackMessage('❌ ' + (error.message || 'Failed to submit. Please try again.'), true);
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    }
  };

  // Submit bug report
  window.submitBugReport = async function(event) {
    event.preventDefault();
    
    const submitBtn = document.getElementById('cs-bug-submit');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⏳</span> Submitting...';
    
    try {
      const user = getCurrentUser();
      const payload = {
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        category: document.getElementById('cs-bug-category').value,
        description: document.getElementById('cs-bug-description').value.trim(),
        deviceInfo: getDeviceInfo(),
        url: window.location.href,
        timestamp: new Date().toISOString()
      };
      
      const response = await fetch('/.netlify/functions/submit-bug-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      
      if (data.success) {
        // Show success state
        document.getElementById('cs-bug-form').style.display = 'none';
        document.getElementById('cs-feedback-success').style.display = 'block';
        document.getElementById('cs-feedback-success-message').textContent = 
          'Your bug report has been submitted. We\'ll look into it!';
      } else {
        throw new Error(data.error || 'Failed to submit');
      }
    } catch (error) {
      console.error('Bug report submit error:', error);
      showFeedbackMessage('❌ ' + (error.message || 'Failed to submit. Please try again.'), true);
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    }
  };

  // Close modal on escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      window.closeFeedbackModal();
    }
  });

  // Close modal when clicking backdrop
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('cs-feedback-modal')) {
      window.closeFeedbackModal();
    }
  });

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFeedback);
  } else {
    initFeedback();
  }
})();
