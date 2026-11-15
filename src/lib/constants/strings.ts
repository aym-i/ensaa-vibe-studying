/**
 * UI text strings.
 * All UI strings are kept strictly isolated in English and never injected into the model prompt.
 */
export const strings = {
	app: {
		title: 'ENSA Agadir Study Résumé Generator',
		subtitle: 'Single-purpose exam revision résumé generator grounded in your course materials.'
	},
	subject: {
		label: 'Subject Name',
		placeholder: 'e.g., Analyse Numérique',
		hint: 'Used to derive the storage folder and group all revision documents.'
	},
	categories: {
		cours: {
			key: 'cours',
			label: 'Lessons',
			purpose: 'Course documents (PDFs, DOCX, etc.)'
		},
		tds: {
			key: 'tds',
			label: 'TDs / TPs',
			purpose: 'Travaux dirigés and Travaux Pratiques'
		},
		autres: {
			key: 'autres',
			label: 'Other',
			purpose: 'Teacher notices, older exams, DS, anything helpful but not fitting the first two'
		}
	},
	upload: {
		dropzone: 'Drop files here or click to browse',
		supportedTypes: 'PDF, DOCX, TXT, MD',
		removeAria: 'Remove file',
		noFiles: 'No files selected'
	},
	cache: {
		priorRunFound: 'Prior run detected for this subject.',
		priorExtracted: 'Cached extracted documents are available.',
		priorOutputAvailable: 'A previously generated résumé is ready to download.',
		reuseExtracted: 'Reuse cached extractions',
		reuploadNotice: 'Uploading new files will version the subject folder to preserve history.'
	},
	actions: {
		generate: 'Generate Résumé',
		generating: 'Generating…',
		regenerate: 'Regenerate',
		regenerating: 'Regenerating…',
		download: 'Download .tex'
	},
	thinking: {
		title: 'Thinking',
		liveBadge: 'Streaming reasoning',
		completeBadge: 'Reasoning complete',
		empty: 'Reasoning process will appear here as the model analyzes documents…',
		toggleAria: 'Toggle thinking panel'
	},
	preview: {
		title: 'Output Preview',
		streamingBadge: 'Streaming LaTeX output…',
		completeBadge: 'LaTeX output ready'
	},
	feedback: {
		title: 'Feedback & Iteration',
		hint: 'Refine the generated résumé without re-uploading documents.',
		placeholder: 'Describe what you want changed (e.g., add an exercise on matrices, shorten the Lessons section)…',
		button: 'Regenerate'
	},
	status: {
		uploading: 'Uploading course documents to storage…',
		extracting: 'Converting documents to Markdown via Workers AI…',
		reasoning: 'Reasoning and synthesizing revision résumé…',
		assembling: 'Assembling final LaTeX document…',
		completed: 'Résumé generated successfully.',
		error: 'An error occurred during processing.'
	}
} as const;

