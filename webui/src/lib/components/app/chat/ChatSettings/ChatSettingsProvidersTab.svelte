<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
	import { providersStore } from '$lib/stores/providers.svelte';
	import { userStore } from '$lib/stores/user.svelte';
	import {
		KeyRound,
		Plus,
		Trash2,
		Edit3,
		Globe,
		Server,
		AlertCircle,
		Lock,
		Save,
		X,
		Cpu,
		Download,
		RefreshCw,
		CheckCircle2,
		CircleAlert
	} from '@lucide/svelte';

	// Local backend (llama.cpp) state
	let backendInfo = $state<{ tag: string | null; backend: string | null; installed: boolean } | null>(null);
	let latestTag = $state<string | null>(null);
	let isCheckingUpdate = $state(false);
	let isUpdating = $state(false);
	let updateMessage = $state<string | null>(null);
	let updateError = $state<string | null>(null);

	async function loadBackendInfo() {
		try {
			const api = (window as any).llamaAPI;
			if (!api?.getCurrentBackendInfo) return;
			const info = await api.getCurrentBackendInfo();
			backendInfo = info;
		} catch (e) {
			console.error('Failed to load backend info:', e);
		}
	}

	async function checkForBackendUpdate() {
		isCheckingUpdate = true;
		updateMessage = null;
		updateError = null;
		try {
			const api = (window as any).llamaAPI;
			if (!api?.checkForBackendUpdate) {
				updateError = 'Backend update check not available';
				return;
			}
			const [info, release] = await Promise.all([
				api.getCurrentBackendInfo?.() || Promise.resolve(null),
				api.checkForBackendUpdate()
			]);
			if (info) backendInfo = info;
			if (release.success) {
				latestTag = release.tag;
				const currentNum = parseInt(String(backendInfo?.tag || '').replace(/\D/g, ''), 10) || 0;
				const latestNum = parseInt(String(release.tag).replace(/\D/g, ''), 10) || 0;
				if (backendInfo?.tag && latestNum <= currentNum) {
					updateMessage = `Backend is up to date (${backendInfo.tag}).`;
				} else {
					updateMessage = null;
				}
			} else {
				updateError = release.error || 'Failed to check for updates';
			}
		} catch (e) {
			updateError = 'Failed to check for updates';
		} finally {
			isCheckingUpdate = false;
		}
	}

	async function updateBackend() {
		isUpdating = true;
		updateMessage = null;
		updateError = null;
		try {
			const api = (window as any).llamaAPI;
			if (!api?.updateBackend) {
				updateError = 'Backend update not available';
				return;
			}
			const result = await api.updateBackend();
			if (result.success) {
				updateMessage = result.message;
				if (result.latestTag) latestTag = result.latestTag;
				if (result.latestTag) {
					backendInfo = {
						tag: result.latestTag,
						backend: backendInfo?.backend ?? null,
						installed: true
					};
				}
			} else {
				updateError = result.error || 'Update failed';
			}
		} catch (e) {
			updateError = 'Update failed';
		} finally {
			isUpdating = false;
		}
	}

	// Load backend info on mount
	$effect(() => {
		loadBackendInfo();
	});

	let isEditing = $state(false);
	let editId = $state('');
	let name = $state('');
	let baseUrl = $state('');
	let apiKey = $state('');
	let modelsText = $state('');
	let isSaving = $state(false);
	let deleteConfirmId = $state<string | null>(null);

	function startAdd() {
		isEditing = true;
		editId = crypto.randomUUID();
		name = '';
		baseUrl = '';
		apiKey = '';
		modelsText = '';
		deleteConfirmId = null;
	}

	function startEdit(provider: (typeof providersStore.providers)[0]) {
		isEditing = true;
		editId = provider.id;
		name = provider.name;
		baseUrl = provider.baseUrl;
		apiKey = provider.apiKey || '';
		modelsText = (provider.models || []).join(', ');
		deleteConfirmId = null;
	}

	function cancelEdit() {
		isEditing = false;
		editId = '';
		name = '';
		baseUrl = '';
		apiKey = '';
		modelsText = '';
		deleteConfirmId = null;
	}

	async function handleSave() {
		if (!name.trim() || !baseUrl.trim()) return;
		isSaving = true;
		const models = modelsText
			.split(',')
			.map((m) => m.trim())
			.filter(Boolean);
		const success = await providersStore.saveProvider(editId, name.trim(), baseUrl.trim(), apiKey, models);
		isSaving = false;
		if (success) {
			cancelEdit();
		}
	}

	async function handleDelete(id: string) {
		if (deleteConfirmId !== id) {
			deleteConfirmId = id;
			return;
		}
		await providersStore.deleteProvider(id);
		deleteConfirmId = null;
	}

	function cancelDelete() {
		deleteConfirmId = null;
	}
</script>

<div class="space-y-6">
	<!-- Local Backend (llama.cpp) -->
	<Card>
		<CardHeader class="pb-3">
			<div class="flex items-start justify-between">
				<div class="flex items-center gap-2">
					<Cpu class="h-4 w-4 text-muted-foreground" />
					<CardTitle class="text-base">Local Backend (llama.cpp)</CardTitle>
				</div>
				{#if backendInfo?.tag && latestTag}
					{@const currentNum = parseInt(String(backendInfo.tag).replace(/\D/g, ''), 10) || 0}
					{@const latestNum = parseInt(String(latestTag).replace(/\D/g, ''), 10) || 0}
					{#if latestNum > currentNum}
						<span class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
							<CircleAlert class="mr-1 h-3 w-3" />
							Update available
						</span>
					{:else}
						<span class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
							<CheckCircle2 class="mr-1 h-3 w-3" />
							Up to date
						</span>
					{/if}
				{/if}
			</div>
			<CardDescription>
				Current version: {backendInfo?.tag ?? 'Not installed'}
				{#if latestTag && latestTag !== backendInfo?.tag}
					&nbsp;&bull; Latest: {latestTag}
				{/if}
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-3 pt-0">
			<div class="flex flex-wrap gap-2">
				<Button
					variant="outline"
					size="sm"
					onclick={checkForBackendUpdate}
					disabled={isCheckingUpdate || isUpdating}
				>
					<RefreshCw class="mr-1 h-4 w-4 {isCheckingUpdate ? 'animate-spin' : ''}" />
					{isCheckingUpdate ? 'Checking...' : 'Check for Updates'}
				</Button>
				{#if latestTag && backendInfo?.tag}
					{@const currentNum = parseInt(String(backendInfo.tag).replace(/\D/g, ''), 10) || 0}
					{@const latestNum = parseInt(String(latestTag).replace(/\D/g, ''), 10) || 0}
					{#if latestNum > currentNum}
						<Button
							variant="default"
							size="sm"
							onclick={updateBackend}
							disabled={isUpdating}
						>
							<Download class="mr-1 h-4 w-4" />
							{isUpdating ? 'Updating...' : `Update to ${latestTag}`}
						</Button>
					{/if}
				{/if}
			</div>
			{#if updateMessage}
				<div class="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
					{updateMessage}
				</div>
			{/if}
			{#if updateError}
				<div class="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-300">
					{updateError}
				</div>
			{/if}
		</CardContent>
	</Card>

	{#if !userStore.isLoggedIn}
		<div class="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
			<div class="flex items-start gap-3">
				<AlertCircle class="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
				<div class="space-y-1">
					<p class="text-sm font-medium text-amber-800 dark:text-amber-300">
						Authentication Required
					</p>
					<p class="text-sm text-amber-700 dark:text-amber-400">
						Provider credentials are stored securely per user account.
						Please log in or register to add and persist custom providers.
						Without an account, any entered details will not be saved.
					</p>
				</div>
			</div>
		</div>
	{/if}

	{#if providersStore.providers.length > 0}
		<div class="space-y-3">
			{#each providersStore.providers as provider (provider.id)}
				<Card>
					<CardHeader class="pb-3">
						<div class="flex items-start justify-between">
							<div class="flex items-center gap-2">
								<Server class="h-4 w-4 text-muted-foreground" />
								<CardTitle class="text-base">{provider.name}</CardTitle>
							</div>
							<div class="flex gap-1">
								<Button
									variant="ghost"
									size="icon"
									class="h-8 w-8"
									onclick={() => startEdit(provider)}
								>
									<Edit3 class="h-4 w-4" />
								</Button>
								{#if deleteConfirmId === provider.id}
									<Button
										variant="destructive"
										size="sm"
										class="h-8"
										onclick={() => handleDelete(provider.id)}
									>
										Confirm
									</Button>
									<Button
										variant="outline"
										size="sm"
										class="h-8"
										onclick={cancelDelete}
									>
										<X class="h-4 w-4" />
									</Button>
								{:else}
									<Button
										variant="ghost"
										size="icon"
										class="h-8 w-8 text-destructive hover:text-destructive"
										onclick={() => handleDelete(provider.id)}
									>
										<Trash2 class="h-4 w-4" />
									</Button>
								{/if}
							</div>
						</div>
						<CardDescription class="flex items-center gap-1">
							<Globe class="h-3 w-3" />
							{provider.baseUrl}
						</CardDescription>
					</CardHeader>
					<CardContent class="space-y-2 pt-0">
						<div class="flex items-center gap-2 text-sm">
							<KeyRound class="h-4 w-4 text-muted-foreground" />
							<span class="text-muted-foreground">
								{#if provider.apiKey}
									<Lock class="inline h-3 w-3 text-emerald-500" />
									API key stored securely
								{:else}
									No API key configured
								{/if}
							</span>
						</div>
						{#if provider.models && provider.models.length > 0}
							<div class="flex flex-wrap gap-1 pt-1">
								{#each provider.models as model}
									<span class="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
										{model}
									</span>
								{/each}
							</div>
						{/if}
					</CardContent>
				</Card>
			{/each}
		</div>
	{:else if !isEditing}
		<div class="rounded-lg border border-dashed border-border p-6 text-center">
			<Server class="mx-auto h-8 w-8 text-muted-foreground" />
			<p class="mt-2 text-sm font-medium">No custom providers configured</p>
			<p class="text-xs text-muted-foreground">
				Add OpenAI-compatible providers to use them alongside local models.
			</p>
		</div>
	{/if}

	{#if isEditing}
		<Card>
			<CardHeader>
				<CardTitle class="text-base">
					{editId && providersStore.providers.some((p) => p.id === editId) ? 'Edit Provider' : 'Add Provider'}
				</CardTitle>
				<CardDescription>
					Configure an OpenAI-compatible API endpoint.
					{#if !userStore.isLoggedIn}
						<span class="text-amber-600 dark:text-amber-400">Not saved: log in to persist credentials.</span>
					{/if}
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<div class="space-y-2">
					<Label for="provider-name">Provider Name</Label>
					<Input id="provider-name" bind:value={name} placeholder="e.g., My OpenAI Proxy" />
				</div>
				<div class="space-y-2">
					<Label for="provider-url">Base URL</Label>
					<Input
						id="provider-url"
						bind:value={baseUrl}
						placeholder="https://api.example.com/v1"
					/>
					<p class="text-xs text-muted-foreground">
						The base URL for the provider's OpenAI-compatible API.
					</p>
				</div>
				<div class="space-y-2">
					<Label for="provider-key">API Key</Label>
					<Input
						id="provider-key"
						type="password"
						bind:value={apiKey}
						placeholder="sk-..."
					/>
					<p class="text-xs text-muted-foreground">
						Stored securely via OS keychain when you have an account.
					</p>
				</div>
				<div class="space-y-2">
					<Label for="provider-models">Models (optional)</Label>
					<Input
						id="provider-models"
						bind:value={modelsText}
						placeholder="gpt-4, gpt-3.5-turbo"
					/>
					<p class="text-xs text-muted-foreground">
						Comma-separated list of available model IDs.
					</p>
				</div>
				<div class="flex gap-2 pt-2">
					<Button
						variant="default"
						onclick={handleSave}
						disabled={isSaving || !name.trim() || !baseUrl.trim()}
					>
						<Save class="mr-2 h-4 w-4" />
						{isSaving ? 'Saving...' : 'Save Provider'}
					</Button>
					<Button variant="outline" onclick={cancelEdit}>
						<X class="mr-2 h-4 w-4" />
						Cancel
					</Button>
				</div>
			</CardContent>
		</Card>
	{:else}
		<Button variant="outline" class="w-full" onclick={startAdd}>
			<Plus class="mr-2 h-4 w-4" />
			Add Custom Provider
		</Button>
	{/if}
</div>
