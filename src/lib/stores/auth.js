import { writable } from "svelte/store";
import { apiClient } from "$lib/services/api.js";

// Authentication state
export const user = writable(null);
export const isAuthenticated = writable(false);
export const isLoading = writable(false);
export const authError = writable("");

// Token management — exported so api.js can reference the same keys
export const TOKEN_KEY = 'gorgonetics_access_token';
export const REFRESH_TOKEN_KEY = 'gorgonetics_refresh_token';

export const authStore = {
  // Initialize authentication from stored tokens
  async initialize() {
    try {
      isLoading.set(true);
      const token = localStorage.getItem(TOKEN_KEY);
      
      if (token) {
        // Set token in API client first
        apiClient.setAuthToken(token);
        
        // Validate token by getting current user
        const userData = await apiClient.getCurrentUser(token);
        user.set(userData);
        isAuthenticated.set(true);
        authError.set("");
      }
    } catch {
      console.warn('Token validation failed, clearing stored tokens');
      this.clearTokens();
    } finally {
      isLoading.set(false);
    }
  },

  // User login
  async login(username, password) {
    try {
      isLoading.set(true);
      authError.set("");
      
      const response = await apiClient.login(username, password);
      
      // Store tokens
      localStorage.setItem(TOKEN_KEY, response.access_token);
      if (response.refresh_token) {
        localStorage.setItem(REFRESH_TOKEN_KEY, response.refresh_token);
      }
      
      // Set token in API client immediately
      apiClient.setAuthToken(response.access_token);
      
      // Get user data
      const userData = await apiClient.getCurrentUser(response.access_token);
      user.set(userData);
      isAuthenticated.set(true);
      
      return { success: true };
    } catch (error) {
      authError.set(error.message || 'Login failed');
      return { success: false, error: error.message };
    } finally {
      isLoading.set(false);
    }
  },

  // User registration
  async register(username, password) {
    try {
      isLoading.set(true);
      authError.set("");
      
      await apiClient.register(username, password);

      // Auto-login after successful registration
      return await this.login(username, password);
    } catch (error) {
      authError.set(error.message || 'Registration failed');
      return { success: false, error: error.message };
    } finally {
      isLoading.set(false);
    }
  },

  // User logout
  async logout() {
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      if (token) {
        await apiClient.logout(token);
      }
    } catch (error) {
      console.warn('Logout API call failed:', error);
    } finally {
      this.clearTokens();
      apiClient.setAuthToken(null);
      user.set(null);
      isAuthenticated.set(false);
      authError.set("");
    }
  },

  // Clear stored tokens
  clearTokens() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    apiClient.setAuthToken(null);
  },

  // Get current access token
  getAccessToken() {
    return localStorage.getItem(TOKEN_KEY);
  },

  // Get refresh token
  getRefreshToken() {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  },

  // Clear auth error
  clearError() {
    authError.set("");
  }
};