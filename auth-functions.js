// Station Authentication Helper
const StationAuth = {
  API_BASE_URL: API_BASE_URL,
  
  async signIn(username, password) {
    try {
      console.log('Attempting sign in for:', username);
      
      const response = await fetch(`${API_BASE_URL}/auth/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();
      console.log('Sign in response:', data);
      
      if (data.success) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        return { success: true, user: data.user };
      } else {
        // Return error message without redirecting
        return { success: false, message: data.message || 'Invalid username or password' };
      }
    } catch (error) {
      console.error('Sign in error:', error);
      // Return error message without redirecting
      return { success: false, message: 'Network error. Please try again.' };
    }
  },

  async signOut() {
    try {
      const token = this.getToken();
      if (token) {
        await fetch(`${API_BASE_URL}/auth/signout`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      }
    } catch (error) {
      console.error('Sign out error:', error);
    } finally {
      this.clearAuth();
      window.location.href = 'signin.html';
    }
  },

  getToken() {
    return localStorage.getItem('token');
  },

  getCurrentUser() {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  },

  isAuthenticated() {
    const token = this.getToken();
    if (!token) return false;
    
    // Check if token is expired
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const expired = payload.exp * 1000 < Date.now();
      if (expired) {
        this.clearAuth();
        return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  },

  clearAuth() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },

  getAuthHeaders() {
    const token = this.getToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : ''
    };
  },

  hasPermission(requiredRole) {
    const user = this.getCurrentUser();
    if (!user) return false;
    
    const roleHierarchy = { 'admin': 3, 'operator': 2, 'viewer': 1 };
    const userLevel = roleHierarchy[user.role] || 0;
    const requiredLevel = roleHierarchy[requiredRole] || 0;
    
    return userLevel >= requiredLevel;
  },

  canAccessStation(customerCode) {
    const user = this.getCurrentUser();
    if (!user) return false;
    if (user.role === 'admin') return true;
    return user.customer_code === customerCode;
  }
};

// Make available globally
window.StationAuth = StationAuth;