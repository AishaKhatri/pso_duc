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
        // Store authentication data
        localStorage.setItem('stationToken', data.token);
        localStorage.setItem('stationUser', JSON.stringify(data.user));
        localStorage.setItem('stationPermissions', JSON.stringify(data.permissions || {}));
        
        return {
          success: true,
          user: data.user,
          permissions: data.permissions
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
        await fetch(`${this.API_BASE_URL}/auth/signout`, {
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
    return localStorage.getItem('stationToken');
  },

  // Get current station user
  getCurrentUser() {
    const userStr = localStorage.getItem('stationUser');
    return userStr ? JSON.parse(userStr) : null;
  },

  // Get station permissions/config
  getPermissions() {
    const permsStr = localStorage.getItem('stationPermissions');
    return permsStr ? JSON.parse(permsStr) : {};
  },

  // Check if authenticated
  isAuthenticated() {
    return !!this.getToken();
  },

  // Clear all authentication data
  clearAuth() {
    localStorage.removeItem('stationToken');
    localStorage.removeItem('stationUser');
    localStorage.removeItem('stationPermissions');
  },

//   // Verify token with server
//   async verifyToken() {
//     try {
//       const token = this.getToken();
//       if (!token) return { valid: false, user: null };

//       const response = await fetch(`${this.API_BASE_URL}/auth/verify`, {
//         headers: {
//           'Authorization': `Bearer ${token}`
//         }
//       });

//       const data = await response.json();
      
//       if (data.success) {
//         // Update stored user data if needed
//         localStorage.setItem('stationUser', JSON.stringify(data.user));
//         return { valid: true, user: data.user };
//       } else {
//         this.clearAuth();
//         return { valid: false, user: null };
//       }
//     } catch (error) {
//       console.error('Token verification error:', error);
//       this.clearAuth();
//       return { valid: false, user: null };
//     }
//   },

//   // Protected route middleware
//   requireAuth(redirectTo = 'signin.html') {
//     if (!this.isAuthenticated()) {
//       window.location.href = redirectTo;
//       return false;
//     }
//     return true;
//   },

//   // Check if user has specific permission
//   hasPermission(permissionKey) {
//     const permissions = this.getPermissions();
//     return permissions[permissionKey] === true;
//   }
};