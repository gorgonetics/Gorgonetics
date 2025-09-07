<script>
  import { authStore, isLoading, authError } from '../stores/authStore.js';
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  let username = '';
  let password = '';
  let showPassword = false;

  async function handleLogin() {
    if (!username.trim() || !password.trim()) {
      authError.set('Please fill in all fields');
      return;
    }

    const result = await authStore.login(username.trim(), password);
    if (result.success) {
      dispatch('loginSuccess');
    }
  }

  function togglePassword() {
    showPassword = !showPassword;
  }
</script>

<div class="login-form">
  <h2>Login to Gorgonetics</h2>
  
  <form on:submit|preventDefault={handleLogin}>
    <div class="form-group">
      <label for="username">Username</label>
      <input
        id="username"
        type="text"
        bind:value={username}
        placeholder="Enter your username"
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
          placeholder="Enter your password"
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

    {#if $authError}
      <div class="error-message">
        {$authError}
      </div>
    {/if}

    <button type="submit" class="login-btn" disabled={$isLoading}>
      {$isLoading ? 'Logging in...' : 'Login'}
    </button>
  </form>

  <div class="form-footer">
    <p>Don't have an account? <button type="button" class="link-btn" on:click={() => dispatch('switchToRegister')}>Sign up</button></p>
  </div>
</div>

<style>
  .login-form {
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

  .login-btn {
    width: 100%;
    background-color: #3b82f6;
    color: white;
    padding: 0.75rem;
    border: none;
    border-radius: 4px;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .login-btn:hover:not(:disabled) {
    background-color: #2563eb;
  }

  .login-btn:disabled {
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