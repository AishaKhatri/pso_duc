// auth-functions.js

const StationAuth = {
  async signIn(username, password) {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

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
    const token = localStorage.getItem('authToken');
    if (token) {
      try {
        await fetch(`${API_BASE_URL}/auth/signout`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      } catch (e) {}
    }
    localStorage.clear();
    window.location.href = 'signin.html';
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

  isAuthenticated() {
    return localStorage.getItem('signedIn') === 'true' && !!this.getToken();
  },

  clearAuth() {
    localStorage.clear();
  }
};

// Global auth check function
async function checkAuthentication() {
  const signedIn = localStorage.getItem('signedIn');
  const userInfo = localStorage.getItem('currentUserInfo');
  const user = localStorage.getItem('currentUser');

  if (!signedIn || !userInfo || !user) {
    window.location.href = 'signin.html';
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
      window.location.href = 'signin.html';
      return false;
    }
    
    // Update stored user info
    localStorage.setItem('currentUserInfo', JSON.stringify(data.user));
    return true;
  } catch (error) {
    console.error('Auth check error:', error);
    StationAuth.clearAuth();
    window.location.href = 'signin.html';
    return false;
  }
}

window.checkAuthentication = checkAuthentication;
window.StationAuth = StationAuth;