<script>
    import { authStore, isLoading, authError } from "../stores/authStore.js";
    import { createEventDispatcher } from "svelte";
    import { Input, Button, Alert } from "flowbite-svelte";

    const dispatch = createEventDispatcher();

    let username = "";
    let password = "";
    let showPassword = false;

    async function handleLogin() {
        if (!username.trim() || !password.trim()) {
            authError.set("Please fill in all fields");
            return;
        }

        const result = await authStore.login(username.trim(), password);
        if (result.success) {
            dispatch("loginSuccess");
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
            <Input
                id="username"
                type="text"
                bind:value={username}
                placeholder="Enter your username"
                disabled={$isLoading}
                required
                label="Username"
                class="mb-4"
            />
        </div>

        <div class="form-group">
            <div class="password-input">
                <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    bind:value={password}
                    placeholder="Enter your password"
                    disabled={$isLoading}
                    required
                    label="Password"
                    class="mb-4"
                />
                <button
                    type="button"
                    class="password-toggle"
                    on:click={togglePassword}
                    disabled={$isLoading}
                >
                    {showPassword ? "👁️" : "👁️‍🗨️"}
                </button>
            </div>
        </div>

        {#if $authError}
            <Alert color="red" class="mb-4">
                {$authError}
            </Alert>
        {/if}

        <Button type="submit" disabled={$isLoading} class="w-full">
            {$isLoading ? "Logging in..." : "Login"}
        </Button>
    </form>

    <div class="form-footer">
        <p>
            Don't have an account? <button
                type="button"
                class="link-btn"
                on:click={() => dispatch("switchToRegister")}>Sign up</button
            >
        </p>
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
