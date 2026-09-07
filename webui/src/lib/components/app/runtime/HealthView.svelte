<script lang="ts">
	import { runtimeStore } from '$lib/stores/runtime.svelte';
</script>

<section aria-labelledby="runtime-health-title">
	<h2 id="runtime-health-title">Runtime health</h2>
	<p>{runtimeStore.diagnosticsHealth?.status ?? runtimeStore.diagnosticsHealth?.overall ?? 'Health information unavailable'}</p>
	{#if runtimeStore.snapshot}
		<p>Runtime: {runtimeStore.snapshot.runtime?.state ?? runtimeStore.snapshot.state ?? 'unknown'}</p>
		<p>Active model: {runtimeStore.snapshot.compatibility?.activeModel ?? runtimeStore.snapshot.runtime?.model?.id ?? 'none'}</p>
		<p>Queued: {runtimeStore.snapshot.scheduler?.queued ?? 0} · Active: {runtimeStore.snapshot.scheduler?.active ?? 0}</p>
		<p>Providers: {runtimeStore.providerStatuses.length}</p>
	{/if}
	{#if runtimeStore.error}<p role="alert">{runtimeStore.error}</p>{/if}
</section>
