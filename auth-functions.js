// Station Authentication Helper
const StationAuth = {
  async signIn(username, password) {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/signin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();
      
      if (data.success) {
        localStorage.setItem('authToken', data.token);
        localStorage.setItem('currentUserInfo', JSON.stringify(data.user));
        
        return {
          success: true,
          user: data.user
        };
      } else {
        return {
          success: false,
          message: data.message
        };
      }
    } catch (error) {
      console.error('Sign in error:', error);
      return {
        success: false,
        message: 'Network error. Please try again.'
      };
    }
  },

  // Sign out
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
      window.location.href = 'signin.html';
    }
  },

  // Get authentication token
  getToken() {
    return localStorage.getItem('authToken');
  },

  // Get current station user
  getCurrentUser() {
    const userStr = localStorage.getItem('currentUserInfo');
    return userStr ? JSON.parse(userStr) : null;
  },

  // Check if authenticated
  isAuthenticated() {
    return !!this.getToken();
  },

  // Clear all authentication data
  clearAuth() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUserInfo');
  },

  // Verify token with server
  async verifyToken() {
    try {
      const token = this.getToken();
      if (!token) return { valid: false, user: null };

      const response = await fetch(`${API_BASE_URL}/auth/verify`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await response.json();
      
      if (data.success) {
        // Update stored user data if needed
        localStorage.setItem('currentUserInfo', JSON.stringify(data.user));
        return { valid: true, user: data.user };
      } else {
        this.clearAuth();
        return { valid: false, user: null };
      }
    } catch (error) {
      console.error('Token verification error:', error);
      this.clearAuth();
      return { valid: false, user: null };
    }
  },

  // Check if user has specific permission
  hasPermission(requiredRole) {
    const user = this.getCurrentUser();
    if (!user) return false;
    
    const roleHierarchy = { 'admin': 3, 'operator': 2, 'viewer': 1 };
    const userLevel = roleHierarchy[user.role] || 0;
    const requiredLevel = roleHierarchy[requiredRole] || 0;
    
    return userLevel >= requiredLevel;
  },

  // Check if user can access a specific station
  canAccessStation(customerCode) {
    const user = this.getCurrentUser();
    if (!user) return false;
    if (user.role === 'admin') return true;
    return user.customer_code === customerCode;
  }
};

window.StationAuth = StationAuth;