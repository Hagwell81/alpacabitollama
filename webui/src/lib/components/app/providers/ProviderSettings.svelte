<script lang="ts">
	/**
	 * Richer grouped provider settings and model management (Task 13.2)
	 * Requirement 19.3
	 *
	 * Displays grouped provider settings, model management controls,
	 * and tool-progress/continuation states when supported by the provider.
	 */

	interface ProviderGroup {
		id: string;
		name: string;
		providers: ProviderInfo[];
	}

	interface ProviderInfo {
		id: string;
		name: string;
		status: string;
		capabilities: string[];
		modelCount: number;
		supportsTools: boolean;
		supportsStreaming: boolean;
	}

	interface Props {
		groups: ProviderGroup[];
		selectedProviderId?: string;
		onSelectProvider?: (id: string) => void;
		onConfigureProvider?: (id: string) => void;
	}

	let { groups, selectedProviderId, onSelectProvider, onConfigureProvider }: Props = $props();

	function supportsTools(provider: ProviderInfo): boolean {
		return provider.supportsTools || provider.capabilities.includes('tools');
	}

	function supportsStreaming(provider: ProviderInfo): boolean {
		return provider.supportsStreaming || provider.capabilities.includes('streaming');
	}

	function statusLabel(s: string): string {
		const labels: Record<string, string> = {
			available: 'Available',
			ready: 'Ready',
			disabled: 'Disabled',
			unavailable: 'Unavailable',
			degraded: 'Degraded'
		};
		return labels[s] ?? s;
	}
</script>

<section class="provider-settings" aria-labelledby="provider-settings-title" data-testid="provider-settings">
	<h2 id="provider-settings-title">Provider settings</h2>

	{#each groups as group (group.id)}
		<div class="provider-group" data-testid="provider-group" data-group-id={group.id}>
			<h3>{group.name}</h3>
			{#each group.providers as provider (provider.id)}
				<div
					class="provider-card"
					class:provider-card--selected={provider.id === selectedProviderId}
					data-testid="provider-card"
					data-provider-id={provider.id}
				>
					<div class="provider-card__header">
						<button
							type="button"
							class="provider-card__select"
							onclick={() => onSelectProvider?.(provider.id)}
							aria-pressed={provider.id === selectedProviderId}
							data-testid="provider-select-{provider.id}"
						>
							{provider.name}
						</button>
						<span class="provider-card__status" data-status={provider.status}>
							{statusLabel(provider.status)}
						</span>
					</div>

					<div class="provider-card__capabilities">
						{#if supportsStreaming(provider)}
							<span class="capability-badge" data-testid="capability-streaming">Streaming</span>
						{/if}
						{#if supportsTools(provider)}
							<span class="capability-badge" data-testid="capability-tools">Tools</span>
						{/if}
						<span class="capability-badge" data-testid="capability-models">
							{provider.modelCount} models
						</span>
					</div>

					<div class="provider-card__actions">
						<button
							type="button"
							class="provider-card__configure"
							onclick={() => onConfigureProvider?.(provider.id)}
							data-testid="provider-configure-{provider.id}"
						>
							Configure
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/each}
</section>

<style>
	.provider-settings {
		padding: 1rem;
	}
	.provider-group {
		margin-bottom: 1.5rem;
	}
	.provider-group h3 {
		font-size: 1rem;
		margin-bottom: 0.5rem;
	}
	.provider-card {
		border: 1px solid var(--border, #ccc);
		border-radius: 6px;
		padding: 0.75rem;
		margin-bottom: 0.5rem;
	}
	.provider-card--selected {
		border-color: var(--accent, #4a9);
	}
	.provider-card__header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.provider-card__select {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 0.95rem;
		font-weight: 600;
	}
	.provider-card__status[data-status='ready'],
	.provider-card__status[data-status='available'] {
		color: var(--success, #2a7a2a);
	}
	.provider-card__status[data-status='disabled'],
	.provider-card__status[data-status='unavailable'] {
		color: var(--danger, #c44);
	}
	.provider-card__capabilities {
		display: flex;
		gap: 0.5rem;
		margin: 0.5rem 0;
		flex-wrap: wrap;
	}
	.capability-badge {
		font-size: 0.75rem;
		padding: 0.15rem 0.5rem;
		border-radius: 3px;
		background: var(--surface-2, #eee);
	}
	.provider-card__actions {
		display: flex;
		gap: 0.5rem;
	}
	.provider-card__configure {
		font-size: 0.85rem;
		padding: 0.25rem 0.75rem;
		border: 1px solid var(--border, #ccc);
		border-radius: 4px;
		background: var(--surface, #fff);
		cursor: pointer;
	}
</style>
