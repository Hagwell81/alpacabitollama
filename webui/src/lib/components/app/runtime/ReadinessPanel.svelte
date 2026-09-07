<script lang="ts">
	import { runtimeStore, nextRuntimeAction, readinessOperation } from '$lib/stores/runtime.svelte';

	let request: Record<string, unknown> = { providerId: 'local-llama-server', modelIdentity: '' };
	let operation = $derived(readinessOperation());
	let action = $derived(nextRuntimeAction(runtimeStore.snapshot));
	let state = $derived(runtimeStore.snapshot?.runtime?.state ?? runtimeStore.snapshot?.state ?? 'idle');
	let error = $derived(runtimeStore.error);
	let progress = $derived(typeof operation?.progress === 'number' ? operation.progress : null);

	async function activate() {
		if (action === 'start') await runtimeStore.start();
		else if (action === 'retry') await runtimeStore.start();
		else if (action === 'cancel') {
			if (operation?.providerId && operation?.modelIdentity) await runtimeStore.cancel({ providerId: operation.providerId, modelIdentity: operation.modelIdentity }, operation.id);
			else await runtimeStore.stop();
		}
		else if (action === 'ensure-ready' && request.modelIdentity) await runtimeStore.ensureReady(request);
	}
</script>

<section class="runtime-readiness" aria-labelledby="runtime-readiness-title" aria-live="polite">
	<h2 id="runtime-readiness-title">Runtime readiness</h2>
	<p class="status">Status: <strong>{state}</strong></p>
	{#if runtimeStore.snapshot?.runtime?.provider || runtimeStore.snapshot?.runtime?.model}
		<p class="identity">
			{runtimeStore.snapshot?.runtime?.provider ?? 'local'}
			{#if runtimeStore.snapshot?.runtime?.model} · {runtimeStore.snapshot.runtime.model.id ?? runtimeStore.snapshot.runtime.model.identity}{/if}
		</p>
	{/if}
	{#if progress !== null}
		<progress max="1" value={progress} aria-label="Runtime operation progress">{Math.round(progress * 100)}%</progress>
	{/if}
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	{#if action !== 'none'}
		<button type="button" onclick={activate} disabled={runtimeStore.loading || runtimeStore.actionInFlight !== null}>
			{action === 'ensure-ready' ? 'Ensure ready' : action[0].toUpperCase() + action.slice(1)}
		</button>
	{:else}
		<p class="disabled-reason">No action is available while the runtime is {state}.</p>
	{/if}
</section>

<style>
	.runtime-readiness { display: grid; gap: 0.5rem; padding: 0.75rem; }
	.status, .identity, .disabled-reason { margin: 0; }
	.error { color: var(--color-error, #b42318); }
	progress { width: 100%; }
	@media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }
</style>
