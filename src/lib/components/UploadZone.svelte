<script lang="ts">
	import Icon from '@iconify/svelte';
	import { strings } from '#lib/constants/strings';

	interface Props {
		categoryKey: 'cours' | 'tds' | 'autres';
		label: string;
		purpose: string;
		files: File[];
		onFilesChange: (files: File[]) => void;
	}

	let { categoryKey, label, purpose, files = [], onFilesChange }: Props = $props();

	let fileInputRef: HTMLInputElement | null = null;
	let isDragging = $state(false);

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		isDragging = true;
	}

	function handleDragLeave(e: DragEvent) {
		e.preventDefault();
		isDragging = false;
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		isDragging = false;
		if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
			addFiles(Array.from(e.dataTransfer.files));
		}
	}

	function handleFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files && target.files.length > 0) {
			addFiles(Array.from(target.files));
			target.value = ''; // Reset input to allow selecting same file again if desired
		}
	}

	function addFiles(newFiles: File[]) {
		const existingNames = new Set(files.map((f) => f.name));
		const uniqueNew = newFiles.filter((f) => !existingNames.has(f.name));
		onFilesChange([...files, ...uniqueNew]);
	}

	function removeFile(index: number) {
		const updated = files.filter((_, i) => i !== index);
		onFilesChange(updated);
	}

	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
	}
</script>

<div class="border border-neutral-200 bg-neutral-50/50 p-5">
	<div class="mb-3 flex items-baseline justify-between">
		<div>
			<h3 class="text-sm font-semibold text-neutral-900">{label}</h3>
			<p class="text-xs text-neutral-500 mt-0.5">{purpose}</p>
		</div>
		<span class="text-xs text-neutral-400 font-mono">
			{files.length} {files.length === 1 ? 'file' : 'files'}
		</span>
	</div>

	<!-- Drop Zone -->
	<div
		role="button"
		tabindex="0"
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				fileInputRef?.click();
			}
		}}
		onclick={() => fileInputRef?.click()}
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDrop}
		class="relative flex flex-col items-center justify-center p-6 border border-dashed transition-colors cursor-pointer {isDragging
			? 'border-neutral-900 bg-neutral-100'
			: 'border-neutral-300 hover:border-neutral-400 bg-white'}"
	>
		<input
			bind:this={fileInputRef}
			type="file"
			multiple
			class="hidden"
			onchange={handleFileSelect}
		/>

		<Icon icon="lucide:upload" class="w-5 h-5 text-neutral-400 mb-2" />
		<p class="text-xs text-neutral-600 font-medium">{strings.upload.dropzone}</p>
		<p class="text-[11px] text-neutral-400 mt-1">{strings.upload.supportedTypes}</p>
	</div>

	<!-- Selected Files List -->
	{#if files.length > 0}
		<ul class="mt-3 divide-y divide-neutral-200 border border-neutral-200 bg-white">
			{#each files as file, index}
				<li class="flex items-center justify-between px-3 py-2 text-xs">
					<div class="flex items-center space-x-2 truncate pr-2">
						<Icon icon="lucide:file-text" class="w-3.5 h-3.5 text-neutral-400 shrink-0" />
						<span class="truncate text-neutral-700 font-medium">{file.name}</span>
						<span class="text-neutral-400 shrink-0 font-mono">({formatBytes(file.size)})</span>
					</div>
					<button
						type="button"
						onclick={(e) => {
							e.stopPropagation();
							removeFile(index);
						}}
						aria-label={strings.upload.removeAria}
						class="text-neutral-400 hover:text-neutral-900 transition-colors p-1"
					>
						<Icon icon="lucide:x" class="w-3.5 h-3.5" />
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

