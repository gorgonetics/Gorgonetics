/**
 * Authentication store for Gorgonetics native app.
 * In a single-user desktop app, the user is always authenticated as a local admin.
 */

import { writable } from 'svelte/store';

// Authentication state — always authenticated in native app
export const user = writable({ id: 1, username: 'local', role: 'admin' });
export const isAuthenticated = writable(true);
export const isLoading = writable(false);
export const authError = writable('');

// Token keys — kept for import compatibility with existing code
export const TOKEN_KEY = 'gorgonetics_access_token';
export const REFRESH_TOKEN_KEY = 'gorgonetics_refresh_token';

export const authStore = {
  async initialize() {
    isLoading.set(false);
  },

  async login() {
    return { success: true };
  },

  async register() {
    return { success: true };
  },

  async logout() {},

  clearTokens() {},

  getAccessToken() {
    return 'local';
  },

  getRefreshToken() {
    return 'local';
  },

  clearError() {
    authError.set('');
  },
};
