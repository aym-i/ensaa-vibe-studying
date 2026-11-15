<script lang="ts">
	import Icon from '@iconify/svelte';
	import { strings } from '#lib/constants/strings';

	interface Props {
		reasoningText: string;
		isStreaming: boolean;
	}

	let { reasoningText = '', isStreaming = false }: Props = $props();

	let isOpen = $state(false);
	let scrollContainerRef = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (isOpen && reasoningText && scrollContainerRef) {
			scrollContainerRef.scrollTop = scrollContainerRef.scrollHeight;
		}
	});

	function toggle() {
		isOpen = !isOpen;
	}
</script>

<div class="border-t border-neutral-200 pt-3">
	<button
		type="button"
		onclick={toggle}
		aria-expanded={isOpen}
		aria-label={strings.thinking.toggleAria}
		class="w-full flex items-center justify-between py-2 text-sm text-neutral-500 hover:text-neutral-900 transition-colors cursor-pointer select-none"
	>
		<div class="flex items-center space-x-2">
			<Icon
				icon={isOpen ? 'lucide:chevron-down' : 'lucide:chevron-right'}
				class="w-4 h-4 text-neutral-500"
			/>
			<span class="font-medium text-neutral-700">{strings.thinking.title}</span>
		</div>

		<div class="flex items-center space-x-2 text-xs">
			{#if isStreaming}
				<span class="inline-block w-1.5 h-1.5 rounded-full bg-neutral-900 animate-pulse"></span>
				<span class="text-neutral-500">{strings.thinking.liveBadge}</span>
			{:else if reasoningText.length > 0}
				<span class="text-neutral-400 font-mono text-[11px]">
					{reasoningText.split(/\s+/).filter(Boolean).length} tokens
				</span>
			{/if}
		</div>
	</button>

	{#if isOpen}
		<div
			bind:this={scrollContainerRef}
			class="mt-2 p-4 border border-neutral-200 bg-neutral-100/60 font-mono text-xs text-neutral-600 leading-relaxed max-h-80 overflow-y-auto whitespace-pre-wrap break-words"
		>
			{#if reasoningText.trim().length > 0}
				{reasoningText}
				{#if isStreaming}
					<span class="inline-block w-1.5 h-3 ml-0.5 bg-neutral-500 animate-pulse"></span>
				{/if}
			{:else}
				<span class="text-neutral-400 italic">{strings.thinking.empty}</span>
			{/if}
		</div>
	{/if}
</div>
