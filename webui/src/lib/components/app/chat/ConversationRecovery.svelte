<script lang="ts">
	interface Props {
		status: 'interrupted' | 'cancelled' | 'failed' | 'context-overflow';
		error?: string | null;
		onContinue?: () => void | Promise<void>;
		onRetry?: () => void | Promise<void>;
		onReduceContext?: () => void | Promise<void>;
	}
	let { status, error = null, onContinue, onRetry, onReduceContext }: Props = $props();
	let title = $derived(status === 'context-overflow' ? 'Context limit reached' : 'Conversation needs recovery');
</script>

<section class="conversation-recovery" role="status" aria-labelledby="recovery-title">
	<h2 id="recovery-title">{title}</h2>
	<p>{error ?? 'The previous response did not complete. Your saved conversation remains available.'}</p>
	<div class="actions">
		{#if status === 'interrupted' || status === 'cancelled'}
			<button type="button" onclick={() => onContinue?.()}>Continue</button>
		{/if}
		<button type="button" onclick={() => onRetry?.()}>Retry</button>
		{#if status === 'context-overflow'}
			<button type="button" onclick={() => onReduceContext?.()}>Reduce context</button>
		{/if}
	</div>
</section>
