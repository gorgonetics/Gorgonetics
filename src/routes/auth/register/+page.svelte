<script>
	import RegisterForm from '$lib/components/forms/RegisterForm.svelte';
</script>

<svelte:head>
	<title>Register - Gorgonetics</title>
</svelte:head>

<div class="auth-page">
	<div class="auth-container">
		<h1>Create Account</h1>
		<RegisterForm />
	</div>
</div>

<style>
	.auth-page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: 2rem;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
	}

	.auth-container {
		background: white;
		padding: 2rem;
		border-radius: 8px;
		box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
		max-width: 400px;
		width: 100%;
	}

	h1 {
		text-align: center;
		margin-bottom: 2rem;
		color: #1f2937;
	}
</style>