<script lang="ts">
	import Icon from '@iconify/svelte';
	import { strings } from '#lib/constants/strings';
	import UploadZone from '#lib/components/UploadZone.svelte';
	import ThinkingPanel from '#lib/components/ThinkingPanel.svelte';
	import { toSubjectSlug } from '#lib/utils/slug';
	import { assembleLatexDocument } from '#lib/utils/latex';

	// Form State
	let subjectName = $state('');
	let filesCours = $state<File[]>([]);
	let filesTds = $state<File[]>([]);
	let filesAutres = $state<File[]>([]);

	// Subject Inspection & Prior Run State
	interface InspectionState {
		exists: boolean;
		slug: string;
		hasExtracted: boolean;
		extractedCount: number;
		hasOutput: boolean;
		outputFiles: string[];
		latestOutput: string | null;
	}
	let inspection = $state<InspectionState | null>(null);
	let isCheckingSubject = $state(false);
	let reuseExtracted = $state(false);

	// Processing & Streaming State
	let isProcessing = $state(false);
	let statusMessage = $state('');
	let reasoningStream = $state('');
	let contentStream = $state('');
	let isStreamingReasoning = $state(false);
	let isStreamingContent = $state(false);
	let generationCompleted = $state(false);

	// Output & Download State
	let activeSlug = $state('');
	let activeOutputFile = $state('');
	let downloadUrl = $state('');
	let errorMessage = $state('');
	let copiedLatex = $state(false);
	let showLatexPreview = $state(true); // Default open so preview is immediately visible
	let isLoadingPriorPreview = $state(false);

	// Feedback State
	let feedbackText = $state('');
	let isRegenerating = $state(false);

	// Derived slug
	let derivedSlug = $derived(toSubjectSlug(subjectName));

	let totalFilesStaged = $derived(
		filesCours.length + filesTds.length + filesAutres.length
	);

	let canGenerate = $derived(
		subjectName.trim().length > 0 &&
			(totalFilesStaged > 0 || (inspection?.hasExtracted && reuseExtracted)) &&
			!isProcessing
	);

	// Debounce subject check against R2
	let checkTimer: any = null;
	function onSubjectInput() {
		inspection = null;
		reuseExtracted = false;
		if (checkTimer) clearTimeout(checkTimer);

		if (!subjectName.trim()) return;

		checkTimer = setTimeout(async () => {
			isCheckingSubject = true;
			try {
				const res = await fetch('/api/check', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ subjectName })
				});
				if (res.ok) {
					inspection = await res.json();
				}
			} catch (e) {
				console.error('Failed to check subject:', e);
			} finally {
				isCheckingSubject = false;
			}
		}, 450);
	}

	async function loadPriorOutputPreview(slug: string, filename: string) {
		isLoadingPriorPreview = true;
		errorMessage = '';
		try {
			const res = await fetch(`/api/download?slug=${encodeURIComponent(slug)}&file=${encodeURIComponent(filename)}`);
			if (!res.ok) throw new Error('Could not fetch prior résumé');
			const text = await res.text();
			contentStream = text;
			activeSlug = slug;
			activeOutputFile = filename;
			downloadUrl = `/api/download?slug=${encodeURIComponent(slug)}&file=${encodeURIComponent(filename)}`;
			generationCompleted = true;
			showLatexPreview = true;
		} catch (e: any) {
			console.error(e);
			errorMessage = e?.message || 'Failed to load prior résumé preview';
		} finally {
			isLoadingPriorPreview = false;
		}
	}

	function handleDirectDownload() {
		const fullDoc = contentStream.includes('\\begin{document}')
			? contentStream
			: assembleLatexDocument(contentStream);

		const blob = new Blob([fullDoc], { type: 'application/x-tex;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${activeSlug || derivedSlug}-${activeOutputFile || 'resume.tex'}`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	async function handleCopyLatex() {
		const fullDoc = contentStream.includes('\\begin{document}')
			? contentStream
			: assembleLatexDocument(contentStream);

		await navigator.clipboard.writeText(fullDoc);
		copiedLatex = true;
		setTimeout(() => {
			copiedLatex = false;
		}, 2000);
	}

	async function handleSubmit(action: 'generate' | 'regenerate' = 'generate') {
		if (isProcessing) return;

		errorMessage = '';
		isProcessing = true;
		generationCompleted = false;

		if (action === 'generate') {
			reasoningStream = '';
			contentStream = '';
			downloadUrl = '';
			activeOutputFile = '';
		} else {
			isRegenerating = true;
			reasoningStream = `[Regeneration Feedback]: ${feedbackText}\n\n`;
			contentStream = '';
		}

		statusMessage =
			action === 'regenerate'
				? strings.actions.regenerating
				: strings.status.uploading;

		try {
			const formData = new FormData();
			formData.append('subject', subjectName.trim());
			formData.append('action', action);

			if (action === 'regenerate') {
				formData.append('feedback', feedbackText.trim());
				if (activeSlug) {
					formData.append('targetSlug', activeSlug);
				}
			} else {
				if (reuseExtracted) {
					formData.append('reuseExtracted', 'true');
				}
				for (const f of filesCours) formData.append('files_cours', f);
				for (const f of filesTds) formData.append('files_tds', f);
				for (const f of filesAutres) formData.append('files_autres', f);
			}

			const response = await fetch('/api/generate', {
				method: 'POST',
				body: formData
			});

			if (!response.ok || !response.body) {
				throw new Error(`Server returned status ${response.status}`);
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			isStreamingReasoning = true;

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const events = buffer.split('\n\n');
				buffer = events.pop() ?? '';

				for (const eventStr of events) {
					const lines = eventStr.split('\n');
					let currentEvent = 'message';
					let currentData = '';

					for (const line of lines) {
						if (line.startsWith('event: ')) {
							currentEvent = line.slice(7).trim();
						} else if (line.startsWith('data: ')) {
							currentData += line.slice(6);
						}
					}

					if (!currentData) continue;

					try {
						const parsed = JSON.parse(currentData);

						if (currentEvent === 'status') {
							if (parsed.message) statusMessage = parsed.message;
						} else if (currentEvent === 'reasoning') {
							if (parsed.chunk) {
								reasoningStream += parsed.chunk;
							}
						} else if (currentEvent === 'content') {
							isStreamingReasoning = false;
							isStreamingContent = true;
							if (parsed.chunk) {
								contentStream += parsed.chunk;
							}
						} else if (currentEvent === 'done') {
							activeSlug = parsed.slug;
							activeOutputFile = parsed.outputFile;
							downloadUrl = parsed.downloadUrl;
							generationCompleted = true;
							showLatexPreview = true;
							statusMessage = strings.status.completed;
						} else if (currentEvent === 'error') {
							errorMessage = parsed.message || strings.status.error;
						}
					} catch {
						// Ignored non-json chunk
					}
				}
			}

			// Finalize completion
			isStreamingReasoning = false;
			isStreamingContent = false;
			if (contentStream.length > 0 && !downloadUrl) {
				activeSlug = derivedSlug;
				activeOutputFile = 'resume.tex';
				downloadUrl = `/api/download?slug=${encodeURIComponent(activeSlug)}&file=resume.tex`;
				generationCompleted = true;
				showLatexPreview = true;
			}
		} catch (err: any) {
			console.error('Generation failed:', err);
			errorMessage = err?.message || 'Failed to complete generation pipeline';
		} finally {
			isProcessing = false;
			isRegenerating = false;
			isStreamingReasoning = false;
			isStreamingContent = false;
		}
	}
</script>

<svelte:head>
	<title>{strings.app.title}</title>
</svelte:head>

<main class="min-h-screen bg-neutral-50 text-neutral-900 selection:bg-neutral-200">
	<div class="max-w-3xl mx-auto px-6 py-12">
		<!-- Header -->
		<header class="mb-10 pb-6 border-b border-neutral-200">
			<h1 class="text-2xl font-bold tracking-tight text-neutral-900">
				{strings.app.title}
			</h1>
			<p class="mt-1 text-sm text-neutral-500 leading-relaxed">
				{strings.app.subtitle}
			</p>
		</header>

		<!-- Error Banner -->
		{#if errorMessage}
			<div class="mb-8 p-4 border border-neutral-300 bg-white text-xs text-neutral-800">
				<p class="font-semibold mb-1">Notice</p>
				<p class="font-mono">{errorMessage}</p>
			</div>
		{/if}

		<!-- Subject Input Section -->
		<section class="mb-8">
			<label for="subject-input" class="block text-sm font-semibold text-neutral-900 mb-1.5">
				{strings.subject.label}
			</label>
			<div class="relative">
				<input
					id="subject-input"
					type="text"
					bind:value={subjectName}
					oninput={onSubjectInput}
					placeholder={strings.subject.placeholder}
					disabled={isProcessing}
					class="w-full px-3.5 py-2.5 text-sm bg-white border border-neutral-300 text-neutral-900 placeholder-neutral-400 focus:outline-none focus:border-neutral-900 transition-colors disabled:bg-neutral-100 disabled:cursor-not-allowed"
				/>
				{#if isCheckingSubject}
					<span class="absolute right-3 top-3 text-xs text-neutral-400 font-mono">
						checking…
					</span>
				{/if}
			</div>

			{#if subjectName.trim()}
				<div class="mt-1.5 flex items-center justify-between text-xs text-neutral-400 font-mono">
					<span>slug: {derivedSlug}</span>
				</div>
			{/if}

			<!-- Prior Run Detection Box -->
			{#if inspection && inspection.exists}
				<div class="mt-4 p-4 border border-neutral-200 bg-neutral-100/70 text-xs">
					<div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
						<div>
							<p class="font-semibold text-neutral-900">{strings.cache.priorRunFound}</p>
							{#if inspection.hasExtracted}
								<p class="text-neutral-600 mt-0.5">
									{inspection.extractedCount} cached extracted Markdown files found.
								</p>
							{/if}
							{#if inspection.hasOutput}
								<p class="text-neutral-600 mt-0.5">
									{strings.cache.priorOutputAvailable} ({inspection.latestOutput})
								</p>
							{/if}
							<p class="text-neutral-400 mt-1">
								{strings.cache.reuploadNotice}
							</p>
						</div>

						{#if inspection.hasOutput && inspection.latestOutput}
							<div class="flex items-center space-x-2 shrink-0">
								<button
									type="button"
									onclick={() => loadPriorOutputPreview(inspection!.slug, inspection!.latestOutput!)}
									disabled={isLoadingPriorPreview}
									class="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-neutral-300 text-neutral-800 hover:border-neutral-900 transition-colors text-xs font-medium cursor-pointer"
								>
									<Icon icon="lucide:eye" class="w-3.5 h-3.5 text-neutral-600" />
									<span>Preview</span>
								</button>
								<a
									href="/api/download?slug={encodeURIComponent(inspection.slug)}&file={encodeURIComponent(inspection.latestOutput)}"
									download
									class="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-neutral-900 text-white hover:bg-neutral-800 transition-colors text-xs font-medium"
								>
									<Icon icon="lucide:download" class="w-3.5 h-3.5" />
									<span>Download</span>
								</a>
							</div>
						{/if}
					</div>

					{#if inspection.hasExtracted}
						<div class="mt-3 pt-3 border-t border-neutral-200/80 flex items-center space-x-2">
							<input
								type="checkbox"
								id="reuse-extracted-checkbox"
								bind:checked={reuseExtracted}
								disabled={isProcessing}
								class="border-neutral-300 rounded-none text-neutral-900 focus:ring-0 cursor-pointer"
							/>
							<label
								for="reuse-extracted-checkbox"
								class="text-xs text-neutral-800 font-medium cursor-pointer"
							>
								{strings.cache.reuseExtracted} ({inspection.extractedCount} files ready)
							</label>
						</div>
					{/if}
				</div>
			{/if}
		</section>

		<!-- Upload Zones (Three Categories) -->
		{#if !reuseExtracted}
			<section class="mb-8 space-y-4">
				<UploadZone
					categoryKey="cours"
					label={strings.categories.cours.label}
					purpose={strings.categories.cours.purpose}
					files={filesCours}
					onFilesChange={(newFiles: File[]) => (filesCours = newFiles)}
				/>

				<UploadZone
					categoryKey="tds"
					label={strings.categories.tds.label}
					purpose={strings.categories.tds.purpose}
					files={filesTds}
					onFilesChange={(newFiles: File[]) => (filesTds = newFiles)}
				/>

				<UploadZone
					categoryKey="autres"
					label={strings.categories.autres.label}
					purpose={strings.categories.autres.purpose}
					files={filesAutres}
					onFilesChange={(newFiles: File[]) => (filesAutres = newFiles)}
				/>
			</section>
		{:else}
			<div class="mb-8 p-4 border border-neutral-200 bg-white text-xs text-neutral-600">
				<p class="font-medium text-neutral-900">Reusing cached extractions for {derivedSlug}.</p>
				<p class="mt-0.5 text-neutral-500">Uncheck above if you want to upload new replacement documents.</p>
			</div>
		{/if}

		<!-- Generate Button & Status -->
		<section class="mb-6">
			<div class="flex items-center space-x-4">
				<button
					type="button"
					onclick={() => handleSubmit('generate')}
					disabled={!canGenerate}
					class="px-5 py-2.5 text-sm font-medium bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
				>
					{isProcessing && !isRegenerating
						? strings.actions.generating
						: strings.actions.generate}
				</button>

				{#if statusMessage}
					<span class="text-xs text-neutral-500 font-mono">
						{statusMessage}
					</span>
				{/if}
			</div>

			<!-- Collapsible Thinking Process Panel (Non-Negotiable placement: below Generate button) -->
			<div class="mt-4">
				<ThinkingPanel
					reasoningText={reasoningStream}
					isStreaming={isStreamingReasoning}
				/>
			</div>
		</section>

		<!-- Live Streaming Preview Indicator -->
		{#if isStreamingContent}
			<section class="mb-8 p-5 border border-neutral-200 bg-white">
				<div class="flex items-center justify-between mb-3">
					<div class="flex items-center space-x-2 text-xs text-neutral-700 font-medium">
						<span class="inline-block w-2 h-2 rounded-full bg-neutral-900 animate-pulse"></span>
						<span>{strings.preview.streamingBadge}</span>
					</div>
					<span class="text-xs text-neutral-400 font-mono">streaming</span>
				</div>
				<div class="p-4 border border-neutral-200 bg-neutral-50 font-mono text-xs text-neutral-800 leading-relaxed max-h-72 overflow-y-auto whitespace-pre-wrap">
					{contentStream}
				</div>
			</section>
		{/if}

		<!-- Output & Download Section (Contract: Appears ONLY when content streaming completes) -->
		{#if generationCompleted && contentStream.length > 0}
			<section class="mb-10 p-6 border border-neutral-200 bg-white">
				<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
					<div>
						<h2 class="text-base font-semibold text-neutral-900">
							Résumé Ready
						</h2>
						<p class="text-xs text-neutral-500 mt-0.5 font-mono">
							File: {activeOutputFile || 'resume.tex'} ({activeSlug || derivedSlug})
						</p>
					</div>

					<div class="flex items-center space-x-3">
						<button
							type="button"
							onclick={handleCopyLatex}
							class="inline-flex items-center space-x-1.5 px-3.5 py-2.5 bg-white border border-neutral-300 hover:border-neutral-900 text-neutral-800 text-xs font-medium transition-colors cursor-pointer"
						>
							<Icon
								icon={copiedLatex ? 'lucide:check' : 'lucide:copy'}
								class="w-4 h-4 text-neutral-700"
							/>
							<span>{copiedLatex ? 'Copied' : 'Copy LaTeX'}</span>
						</button>

						<button
							type="button"
							onclick={handleDirectDownload}
							class="inline-flex items-center justify-center space-x-2 px-5 py-2.5 bg-neutral-900 text-white hover:bg-neutral-800 text-sm font-medium transition-colors cursor-pointer"
						>
							<Icon icon="lucide:download" class="w-4 h-4" />
							<span>{strings.actions.download}</span>
						</button>
					</div>
				</div>

				<!-- Prominent LaTeX Preview Panel -->
				<div class="mt-6 pt-5 border-t border-neutral-200">
					<div class="flex items-center justify-between mb-3">
						<span class="text-xs font-semibold text-neutral-900 tracking-wide uppercase">
							Generated LaTeX Body Preview
						</span>
						<button
							type="button"
							onclick={() => (showLatexPreview = !showLatexPreview)}
							class="text-xs text-neutral-500 hover:text-neutral-900 font-medium transition-colors cursor-pointer"
						>
							{showLatexPreview ? 'Collapse preview' : 'Expand preview'}
						</button>
					</div>

					{#if showLatexPreview}
						<div class="p-4 border border-neutral-200 bg-neutral-50 font-mono text-xs text-neutral-800 leading-relaxed max-h-[32rem] overflow-y-auto whitespace-pre-wrap select-text">
							{contentStream}
						</div>
					{/if}
				</div>
			</section>
		{/if}

		<!-- Feedback & Iteration Section -->
		{#if generationCompleted}
			<section class="p-6 border border-neutral-200 bg-neutral-50/70">
				<div class="mb-3">
					<h3 class="text-sm font-semibold text-neutral-900">
						{strings.feedback.title}
					</h3>
					<p class="text-xs text-neutral-500 mt-0.5">
						{strings.feedback.hint}
					</p>
				</div>

				<textarea
					bind:value={feedbackText}
					disabled={isProcessing}
					rows="3"
					placeholder={strings.feedback.placeholder}
					class="w-full p-3 text-xs bg-white border border-neutral-300 text-neutral-900 placeholder-neutral-400 focus:outline-none focus:border-neutral-900 transition-colors disabled:bg-neutral-100 disabled:cursor-not-allowed leading-relaxed"
				></textarea>

				<div class="mt-3 flex justify-end">
					<button
						type="button"
						onclick={() => handleSubmit('regenerate')}
						disabled={!feedbackText.trim() || isProcessing}
						class="inline-flex items-center space-x-2 px-4 py-2 text-xs font-medium bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
					>
						<Icon icon="lucide:refresh-cw" class="w-3.5 h-3.5 {isRegenerating ? 'animate-spin' : ''}" />
						<span>{isRegenerating ? strings.actions.regenerating : strings.feedback.button}</span>
					</button>
				</div>
			</section>
		{/if}
	</div>
</main>
