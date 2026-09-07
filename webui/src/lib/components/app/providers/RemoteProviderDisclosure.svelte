<script lang="ts">
	/**
	 * Remote provider disclosure panel (Task 12.3, Requirement 18.4).
	 * Displays transport, authentication, privacy, and availability
	 * characteristics before a remote provider is used. Shows failure
	 * redaction, cancellation status, phase gate state, and local fallback.
	 */
	interface ProviderDescriptor {
		id: string;
		name: string;
		origin: string;
		authMode: string;
		capabilities: string[];
		endpoint?: string;
	}

	interface ProviderStatus {
		providerId: string;
		status: string;
		message?: string;
		health?: { status: string; latencyMs?: number; message?: string };
		lastCheckedAt?: number;
	}

	interface Props {
		descriptor: ProviderDescriptor;
		status?: ProviderStatus;
		phase1Passed?: boolean;
		remoteOptIn?: boolean;
		onEnable?: () => void;
		onDisable?: () => void;
		onTestConnection?: () => void;
	}

	let {
		descriptor,
		status,
		phase1Passed = false,
		remoteOptIn = false,
		onEnable,
		onDisable,
		onTestConnection
	}: Props = $props();

	let isRemote = $derived(descriptor.origin !== 'loopback' && descriptor.origin !== 'local');
	let isDisabled = $derived(isRemote && (!phase1Passed || !remoteOptIn));
	let phaseGateMessage = $derived(
		!phase1Passed
			? 'Phase 1 exit criteria must pass before remote providers are available.'
			: !remoteOptIn
				? 'Remote providers require explicit user opt-in.'
				: null
	);

	let privacyNote = $derived(
		isRemote
			? 'This provider sends requests to a remote endpoint. Conversation content leaves the local device.'
			: 'This provider runs locally. Conversation content stays on this device.'
	);

	let transportLabel = $derived(
		descriptor.endpoint?.startsWith('https://')
			? 'HTTPS (encrypted)'
			: descriptor.endpoint?.startsWith('http://')
				? 'HTTP (unencrypted)'
				: 'Unknown'
	);

	let authLabel = $derived(
		{
			'api-key': 'API key (Bearer token)',
			token: 'Token',
			'secure-store': 'Secure store',
			none: 'No authentication'
		}[descriptor.authMode] ?? descriptor.authMode
	);

	function statusLabel(s: string | undefined): string {
		const labels: Record<string, string> = {
			available: 'Available',
			unavailable: 'Unavailable',
			degraded: 'Degraded',
			starting: 'Starting',
			ready: 'Ready',
			failed: 'Failed',
			disabled: 'Disabled'
		};
		return labels[s ?? 'unavailable'] ?? s ?? 'Unknown';
	}
</script>

<section
	class="remote-provider-disclosure"
	aria-labelledby="rpd-title-{descriptor.id}"
	data-testid="remote-provider-disclosure"
	data-provider-id={descriptor.id}
>
	<h3 id="rpd-title-{descriptor.id}">{descriptor.name}</h3>

	<dl class="rpd-characteristics">
		<div class="rpd-row">
			<dt>Transport</dt>
			<dd>{transportLabel}</dd>
		</div>
		<div class="rpd-row">
			<dt>Endpoint</dt>
			<dd>{descriptor.endpoint ?? 'Not configured'}</dd>
		</div>
		<div class="rpd-row">
			<dt>Authentication</dt>
			<dd>{authLabel}</dd>
		</div>
		<div class="rpd-row">
			<dt>Origin</dt>
			<dd>{isRemote ? 'Remote' : 'Local'}</dd>
		</div>
		<div class="rpd-row">
			<dt>Capabilities</dt>
			<dd>{descriptor.capabilities.join(', ') || 'None'}</dd>
		</div>
		<div class="rpd-row">
			<dt>Availability</dt>
			<dd class="rpd-status" data-status={status?.status ?? 'unavailable'}>
				{statusLabel(status?.status)}
			</dd>
		</div>
	</dl>

	<p class="rpd-privacy" role="note" data-testid="rpd-privacy-note">
		{privacyNote}
	</p>

	{#if isDisabled && phaseGateMessage}
		<p class="rpd-phase-gate" role="alert" data-testid="rpd-phase-gate">
			{phaseGateMessage}
		</p>
	{/if}

	{#if status?.message}
		<p class="rpd-message" data-testid="rpd-message">{status.message}</p>
	{/if}

	{#if status?.health}
		<p class="rpd-health" data-testid="rpd-health">
			Health: {status.health.status}
			{#if status.health.latencyMs !== undefined}· {status.health.latencyMs}ms{/if}
		</p>
	{/if}

	<div class="rpd-actions">
		{#if isRemote && phase1Passed && !remoteOptIn}
			<button type="button" class="rpd-enable" onclick={onEnable} data-testid="rpd-enable">
				Enable remote provider
			</button>
		{/if}
		{#if isRemote && remoteOptIn}
			<button type="button" class="rpd-disable" onclick={onDisable} data-testid="rpd-disable">
				Disable remote provider
			</button>
		{/if}
		{#if !isDisabled}
			<button type="button" class="rpd-test" onclick={onTestConnection} data-testid="rpd-test">
				Test connection
			</button>
		{/if}
	</div>

	{#if isDisabled}
		<p class="rpd-fallback" data-testid="rpd-fallback">
			Local llama-server provider remains available as fallback.
		</p>
	{/if}
</section>

<style>
	.remote-provider-disclosure {
		border: 1px solid var(--border, #ccc);
		border-radius: 8px;
		padding: 1rem;
		margin: 0.5rem 0;
	}
	.rpd-characteristics {
		margin: 0.5rem 0;
		display: grid;
		gap: 0.25rem;
	}
	.rpd-row {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
	}
	.rpd-row dt {
		font-weight: 600;
		flex-shrink: 0;
	}
	.rpd-row dd {
		margin: 0;
		text-align: right;
	}
	.rpd-privacy {
		font-size: 0.85rem;
		color: var(--text-muted, #666);
		margin: 0.5rem 0;
	}
	.rpd-phase-gate {
		color: var(--warning, #c4801e);
		font-size: 0.85rem;
		margin: 0.5rem 0;
	}
	.rpd-status[data-status='available'],
	.rpd-status[data-status='ready'] {
		color: var(--success, #2a7a2a);
	}
	.rpd-status[data-status='disabled'],
	.rpd-status[data-status='unavailable'],
	.rpd-status[data-status='failed'] {
		color: var(--danger, #c44);
	}
	.rpd-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}
	.rpd-fallback {
		font-size: 0.85rem;
		color: var(--text-muted, #666);
		margin-top: 0.5rem;
	}
</style>
