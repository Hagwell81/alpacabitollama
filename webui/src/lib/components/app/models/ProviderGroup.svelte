<script lang="ts">
	interface Props { name: string; status?: string; models?: Array<{ id?: string; model?: string; name?: string; availability?: string; verification?: string }>; }
	let { name, status = 'available', models = [] }: Props = $props();
</script>

<section class="provider-group" aria-labelledby={`provider-${name}`}>
	<h3 id={`provider-${name}`}>{name}</h3>
	<span class="status" aria-label={`Provider status: ${status}`}>{status}</span>
	<ul>
		{#each models as model (model.id ?? model.model)}
			<li>
				<span>{model.name ?? model.model ?? model.id}</span>
				{#if model.availability}<span> · {model.availability}</span>{/if}
				{#if model.verification}<span> · {model.verification}</span>{/if}
			</li>
		{/each}
	</ul>
</section>
