// auth-functions.js

// Sends the user to signin.html. When `savePath` is true (default), the
// current URL is stashed in sessionStorage so the signin page can bounce the
// user back to where they came from after re-authenticating. Pass false on
// explicit sign-out — the user asked to leave, no return trip needed.
function redirectToSignin(savePath = true) {
  try {
    const path = window.location.pathname + window.location.search;
    const file = path.split('/').pop() || '';
    // Don't loop back to signin.html itself, and skip empty/root paths so the
    // post-signin redirect doesn't end up on the same blank page.
    if (savePath && file && file !== 'signin.html') {
      sessionStorage.setItem('signinReturnTo', path);
    } else {
      sessionStorage.removeItem('signinReturnTo');
    }
  } catch (e) {
    // sessionStorage can throw in private-mode contexts; redirect anyway.
  }
  window.location.href = 'signin.html';
}

const StationAuth = {
  async signIn(username, password) {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      // Rate-limited by the server after too many failed attempts. Build a
      // "retry after X minutes" message from the standard rate-limit headers
      // (seconds remaining); fall back to the limiter's 15-minute window if
      // the headers aren't present.
      if (response.status === 429) {
        const retrySecs = parseInt(
          response.headers.get('Retry-After') ||
          response.headers.get('RateLimit-Reset') || '',
          10
        );
        const minutes = Number.isFinite(retrySecs) && retrySecs > 0
          ? Math.ceil(retrySecs / 60)
          : 15;
        return {
          success: false,
          rateLimited: true,
          message: `Too many unsuccessful login attempts. Please retry after ${minutes} minute${minutes === 1 ? '' : 's'}.`
        };
      }

      const data = await response.json();
      
      if (data.success) {
        localStorage.setItem('authToken', data.token);
        localStorage.setItem('currentUser', username);
        localStorage.setItem('currentUserInfo', JSON.stringify(data.user));
        localStorage.setItem('signedIn', 'true');
        return { success: true, user: data.user };
      } else {
        return { success: false, message: data.message };
      }
    } catch (error) {
      console.error('Sign in error:', error);
      return { success: false, message: 'Network error' };
    }
  },

  async signOut() {
    try {
      const token = this.getToken();
      if (token) {
        await fetch(`${API_BASE_URL}/auth/signout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
      }
    } catch (error) {
      console.error('Sign out error:', error);
    } finally {
      this.clearAuth();
      // Explicit user logout — no return trip; default to dashboard next signin.
      redirectToSignin(false);
    }
  },

  getToken() {
    return localStorage.getItem('authToken');
  },

  getCurrentUser() {
    return localStorage.getItem('currentUser');
  },

  getUserInfo() {
    const userStr = localStorage.getItem('currentUserInfo');
    return userStr ? JSON.parse(userStr) : null;
  },

  clearAuth() {
    // Preserve user theme preference across sign-out
    const theme = localStorage.getItem('theme');
    localStorage.clear();
    if (theme) localStorage.setItem('theme', theme);
  }
};

// Global auth check function
async function checkAuthentication() {
  const signedIn = localStorage.getItem('signedIn');
  const userInfo = localStorage.getItem('currentUserInfo');
  const user = localStorage.getItem('currentUser');

  if (!signedIn || !userInfo || !user) {
    redirectToSignin();
    return false;
  }

  try {
    // Verify user exists in database
    const token = localStorage.getItem('authToken');
    const response = await fetch(`${API_BASE_URL}/auth/verify`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const data = await response.json();
    
    if (!data.success) {
      StationAuth.clearAuth();
      redirectToSignin();
      return false;
    }
    
    // Update stored user info
    localStorage.setItem('currentUserInfo', JSON.stringify(data.user));
    return true;
  } catch (error) {
    console.error('Auth check error:', error);
    StationAuth.clearAuth();
    redirectToSignin();
    return false;
  }
}

window.checkAuthentication = checkAuthentication;
window.StationAuth = StationAuth;