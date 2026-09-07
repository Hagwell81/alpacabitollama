<script lang="ts">
	/**
	 * Resizable nested split layout (Task 13.3)
	 * Requirements: 19.4-19.5
	 *
	 * Features:
	 * - Resizable panes with drag handle
	 * - Minimum pane sizes enforced
	 * - Persistence: saves sizes to localStorage
	 * - Keyboard navigation: arrow keys to resize
	 * - Single-pane fallback: renders only first pane when second is collapsed
	 * - Direction: horizontal or vertical
	 */

	interface Props {
		direction?: 'horizontal' | 'vertical';
		first: import('svelte').Snippet;
		second?: import('svelte').Snippet;
		initialFirstSize?: number;
		minFirstSize?: number;
		minSecondSize?: number;
		secondCollapsed?: boolean;
		persistKey?: string;
		onResize?: (firstSize: number) => void;
	}

	let {
		direction = 'horizontal',
		first,
		second,
		initialFirstSize = 50,
		minFirstSize = 10,
		minSecondSize = 10,
		secondCollapsed = false,
		persistKey,
		onResize
	}: Props = $props();

	let firstSize = $state(initialFirstSize);
	let isDragging = $state(false);
	let containerEl: HTMLElement | null = null;

	// Restore persisted size
	$effect(() => {
		if (persistKey) {
			const saved = localStorage.getItem(`split-pane-${persistKey}`);
			if (saved !== null) {
				const parsed = parseFloat(saved);
				if (!isNaN(parsed) && parsed >= minFirstSize && parsed <= 100 - minSecondSize) {
					firstSize = parsed;
				}
			}
		}
	});

	function persist() {
		if (persistKey) {
			localStorage.setItem(`split-pane-${persistKey}`, String(firstSize));
		}
	}

	function startDrag(e: MouseEvent) {
		e.preventDefault();
		isDragging = true;
		window.addEventListener('mousemove', onDrag);
		window.addEventListener('mouseup', stopDrag);
	}

	function onDrag(e: MouseEvent) {
		if (!isDragging || !containerEl) return;
		const rect = containerEl.getBoundingClientRect();
		const percentage = direction === 'horizontal'
			? ((e.clientX - rect.left) / rect.width) * 100
			: ((e.clientY - rect.top) / rect.height) * 100;
		const clamped = Math.max(minFirstSize, Math.min(100 - minSecondSize, percentage));
		firstSize = clamped;
		onResize?.(firstSize);
	}

	function stopDrag() {
		isDragging = false;
		window.removeEventListener('mousemove', onDrag);
		window.removeEventListener('mouseup', stopDrag);
		persist();
	}

	function onKeyDown(e: KeyboardEvent) {
		const step = 5;
		if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
			firstSize = Math.max(minFirstSize, firstSize - step);
			onResize?.(firstSize);
			persist();
			e.preventDefault();
		} else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
			firstSize = Math.min(100 - minSecondSize, firstSize + step);
			onResize?.(firstSize);
			persist();
			e.preventDefault();
		}
	}

	let containerClass = $derived(
		`split-pane split-pane--${direction}${isDragging ? ' split-pane--dragging' : ''}`
	);
	let firstStyle = $derived(
		direction === 'horizontal'
			? `flex: 0 0 ${firstSize}%; min-width: ${minFirstSize}%;`
			: `flex: 0 0 ${firstSize}%; min-height: ${minFirstSize}%;`
	);
	let secondStyle = $derived(
		direction === 'horizontal'
			? `flex: 1 1 auto; min-width: ${minSecondSize}%;`
			: `flex: 1 1 auto; min-height: ${minSecondSize}%;`
	);
</script>

<div
	bind:this={containerEl}
	class={containerClass}
	data-testid="split-pane"
	data-direction={direction}
>
	<div class="split-pane__first" style={firstStyle} data-testid="split-pane-first">
		{@render first()}
	</div>

	{#if !secondCollapsed && second}
		<div
			class="split-pane__handle"
			role="separator"
			aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
			aria-valuenow={firstSize}
			aria-valuemin={minFirstSize}
			aria-valuemax={100 - minSecondSize}
			tabindex="0"
			onmousedown={startDrag}
			onkeydown={onKeyDown}
			data-testid="split-pane-handle"
		>
			<span class="split-pane__handle-grip"></span>
		</div>
		<div class="split-pane__second" style={secondStyle} data-testid="split-pane-second">
			{@render second()}
		</div>
	{/if}
</div>

<style>
	.split-pane {
		display: flex;
		width: 100%;
		height: 100%;
		overflow: hidden;
	}
	.split-pane--horizontal {
		flex-direction: row;
	}
	.split-pane--vertical {
		flex-direction: column;
	}
	.split-pane--dragging {
		user-select: none;
		cursor: grabbing;
	}
	.split-pane__first,
	.split-pane__second {
		overflow: auto;
		position: relative;
	}
	.split-pane__handle {
		flex: 0 0 6px;
		background: var(--border, #ccc);
		cursor: grab;
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		z-index: 1;
	}
	.split-pane--horizontal .split-pane__handle {
		cursor: col-resize;
		width: 6px;
		height: 100%;
	}
	.split-pane--vertical .split-pane__handle {
		cursor: row-resize;
		height: 6px;
		width: 100%;
	}
	.split-pane__handle:focus-visible {
		outline: 2px solid var(--accent, #4a9);
		outline-offset: -1px;
	}
	.split-pane__handle-grip {
		width: 4px;
		height: 24px;
		background: var(--text-muted, #999);
		border-radius: 2px;
	}
	.split-pane--vertical .split-pane__handle-grip {
		width: 24px;
		height: 4px;
	}
</style>
