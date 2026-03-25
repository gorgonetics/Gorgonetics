<script>
  import { authStore, isLoading, authError } from '$lib/stores/auth.js';
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  let username = '';
  let password = '';
  let confirmPassword = '';
  let showPassword = false;
  let showConfirmPassword = false;

  async function handleRegister() {
    // Client-side validation
    if (!username.trim() || !password.trim() || !confirmPassword.trim()) {
      authError.set('Please fill in all fields');
      return;
    }

    if (username.trim().length < 3) {
      authError.set('Username must be at least 3 characters');
      return;
    }

    if (password.length < 8) {
      authError.set('Password must be at least 8 characters');
      return;
    }

    if (password !== confirmPassword) {
      authError.set('Passwords do not match');
      return;
    }

    const result = await authStore.register(username.trim(), password);
    if (result.success) {
      dispatch('registerSuccess');
    }
  }

  function togglePassword() {
    showPassword = !showPassword;
  }

  function toggleConfirmPassword() {
    showConfirmPassword = !showConfirmPassword;
  }
</script>

<div class="register-form">
  <h2>Create Account</h2>
  
  <form on:submit|preventDefault={handleRegister}>
    <div class="form-group">
      <label for="username">Username</label>
      <input
        id="username"
        type="text"
        bind:value={username}
        placeholder="Enter your username (3+ characters)"
        disabled={$isLoading}
        required
      />
    </div>

    <div class="form-group">
      <label for="password">Password</label>
      <div class="password-input">
        <input
          id="password"
          type={showPassword ? 'text' : 'password'}
          bind:value={password}
          placeholder="Enter your password (8+ characters)"
          disabled={$isLoading}
          required
        />
        <button
          type="button"
          class="password-toggle"
          on:click={togglePassword}
          disabled={$isLoading}
        >
          {showPassword ? '👁️' : '👁️‍🗨️'}
        </button>
      </div>
    </div>

    <div class="form-group">
      <label for="confirmPassword">Confirm Password</label>
      <div class="password-input">
        <input
          id="confirmPassword"
          type={showConfirmPassword ? 'text' : 'password'}
          bind:value={confirmPassword}
          placeholder="Confirm your password"
          disabled={$isLoading}
          required
        />
        <button
          type="button"
          class="password-toggle"
          on:click={toggleConfirmPassword}
          disabled={$isLoading}
        >
          {showConfirmPassword ? '👁️' : '👁️‍🗨️'}
        </button>
      </div>
    </div>

    {#if $authError}
      <div class="error-message">
        {$authError}
      </div>
    {/if}

    <button type="submit" class="register-btn" disabled={$isLoading}>
      {$isLoading ? 'Creating Account...' : 'Create Account'}
    </button>
  </form>

  <div class="form-footer">
    <p>Already have an account? <button type="button" class="link-btn" on:click={() => dispatch('switchToLogin')}>Sign in</button></p>
  </div>
</div>

<style>
  .register-form {
    max-width: 400px;
    margin: 2rem auto;
    padding: 2rem;
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }

  h2 {
    text-align: center;
    margin-bottom: 1.5rem;
    color: #1f2937;
  }

  .form-group {
    margin-bottom: 1rem;
  }

  label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 500;
    color: #374151;
  }

  input[type="text"],
  input[type="password"] {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    font-size: 1rem;
    transition: border-color 0.2s;
  }

  input[type="text"]:focus,
  input[type="password"]:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }

  input:disabled {
    background-color: #f3f4f6;
    cursor: not-allowed;
  }

  .password-input {
    position: relative;
    display: flex;
    align-items: center;
  }

  .password-toggle {
    position: absolute;
    right: 0.75rem;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 4px;
    font-size: 1rem;
    opacity: 0.7;
    transition: opacity 0.2s;
  }

  .password-toggle:hover {
    opacity: 1;
  }

  .password-toggle:disabled {
    cursor: not-allowed;
  }

  .error-message {
    background-color: #fef2f2;
    color: #dc2626;
    padding: 0.75rem;
    border-radius: 4px;
    border: 1px solid #fecaca;
    margin-bottom: 1rem;
    font-size: 0.875rem;
  }

  .register-btn {
    width: 100%;
    background-color: #10b981;
    color: white;
    padding: 0.75rem;
    border: none;
    border-radius: 4px;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .register-btn:hover:not(:disabled) {
    background-color: #059669;
  }

  .register-btn:disabled {
    background-color: #9ca3af;
    cursor: not-allowed;
  }

  .form-footer {
    text-align: center;
    margin-top: 1.5rem;
  }

  .form-footer p {
    color: #6b7280;
    margin: 0;
  }

  .link-btn {
    background: none;
    border: none;
    color: #3b82f6;
    cursor: pointer;
    text-decoration: underline;
    font-size: inherit;
  }

  .link-btn:hover {
    color: #2563eb;
  }
</style>