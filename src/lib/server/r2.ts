export type CategoryKey = 'cours' | 'tds' | 'autres';

export interface ExtractedDocument {
	category: CategoryKey;
	filename: string;
	markdown: string;
}

export interface SubjectInspection {
	slug: string;
	exists: boolean;
	hasExtracted: boolean;
	extractedCount: number;
	extractedFiles: string[];
	hasOutput: boolean;
	outputFiles: string[];
	latestOutput: string | null;
}

// In-memory resilience cache for local dev / session continuity
const memoryFallback = new Map<string, string>();

/**
 * Inspects the R2 folder (and memory fallback) for a given subject slug.
 */
export async function inspectSubject(bucket: R2Bucket | undefined, slug: string): Promise<SubjectInspection> {
	const extractedFiles = new Set<string>();
	const outputFiles = new Set<string>();

	if (bucket) {
		try {
			const prefix = `${slug}/`;
			const listed = await bucket.list({ prefix });
			for (const obj of listed.objects) {
				const key = obj.key;
				if (key.startsWith(`${slug}/extracted/`) && key.endsWith('.md')) {
					extractedFiles.add(key.replace(`${slug}/extracted/`, ''));
				} else if (key.startsWith(`${slug}/output/`) && key.endsWith('.tex')) {
					outputFiles.add(key.replace(`${slug}/output/`, ''));
				}
			}
		} catch (e) {
			console.warn('R2 bucket.list check failed, checking memory fallback:', e);
		}
	}

	// Also check memory fallback
	for (const key of memoryFallback.keys()) {
		if (key.startsWith(`${slug}/extracted/`) && key.endsWith('.md')) {
			extractedFiles.add(key.replace(`${slug}/extracted/`, ''));
		} else if (key.startsWith(`${slug}/output/`) && key.endsWith('.tex')) {
			outputFiles.add(key.replace(`${slug}/output/`, ''));
		}
	}

	const sortedOutputs = Array.from(outputFiles).sort((a, b) => {
		const getVer = (s: string) => {
			if (s === 'resume.tex') return 1;
			const m = s.match(/^resume-v(\d+)\.tex$/);
			return m ? parseInt(m[1], 10) : 0;
		};
		return getVer(b) - getVer(a);
	});

	const exists = extractedFiles.size > 0 || outputFiles.size > 0;

	return {
		slug,
		exists,
		hasExtracted: extractedFiles.size > 0,
		extractedCount: extractedFiles.size,
		extractedFiles: Array.from(extractedFiles),
		hasOutput: sortedOutputs.length > 0,
		outputFiles: sortedOutputs,
		latestOutput: sortedOutputs[0] ?? null
	};
}

/**
 * Stores an uploaded file in R2 under:
 * <slug>/uploads/<category>/<filename>
 */
export async function saveRawUpload(
	bucket: R2Bucket | undefined,
	slug: string,
	category: CategoryKey,
	filename: string,
	data: ArrayBuffer | ReadableStream
): Promise<string> {
	const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
	const key = `${slug}/uploads/${category}/${sanitizedFilename}`;
	if (bucket) {
		try {
			await bucket.put(key, data);
		} catch (e) {
			console.warn(`R2 put failed for ${key}:`, e);
		}
	}
	return key;
}

/**
 * Stores an extracted Markdown document in R2 under:
 * <slug>/extracted/<category>/<filename>.md
 */
export async function saveExtractedMarkdown(
	bucket: R2Bucket | undefined,
	slug: string,
	category: CategoryKey,
	filename: string,
	markdown: string
): Promise<string> {
	const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
	const key = `${slug}/extracted/${category}/${sanitizedFilename}.md`;
	memoryFallback.set(key, markdown);
	if (bucket) {
		try {
			await bucket.put(key, markdown, {
				httpMetadata: {
					contentType: 'text/markdown; charset=utf-8'
				}
			});
		} catch (e) {
			console.warn(`R2 put markdown failed for ${key}:`, e);
		}
	}
	return key;
}

/**
 * Loads all extracted markdown files for a subject slug.
 */
export async function loadExtractedDocuments(
	bucket: R2Bucket | undefined,
	slug: string
): Promise<ExtractedDocument[]> {
	const prefix = `${slug}/extracted/`;
	const map = new Map<string, ExtractedDocument>();

	if (bucket) {
		try {
			const listed = await bucket.list({ prefix });
			for (const obj of listed.objects) {
				if (!obj.key.endsWith('.md')) continue;
				const relative = obj.key.slice(prefix.length);
				const parts = relative.split('/');
				if (parts.length < 2) continue;
				const category = parts[0] as CategoryKey;
				const filename = parts.slice(1).join('/');

				const item = await bucket.get(obj.key);
				if (item) {
					const markdown = await item.text();
					map.set(obj.key, {
						category,
						filename: filename.replace(/\.md$/, ''),
						markdown
					});
				}
			}
		} catch (e) {
			console.warn('R2 loadExtractedDocuments failed:', e);
		}
	}

	// Memory fallback
	for (const [key, markdown] of memoryFallback.entries()) {
		if (key.startsWith(prefix) && key.endsWith('.md') && !map.has(key)) {
			const relative = key.slice(prefix.length);
			const parts = relative.split('/');
			if (parts.length >= 2) {
				const category = parts[0] as CategoryKey;
				const filename = parts.slice(1).join('/');
				map.set(key, {
					category,
					filename: filename.replace(/\.md$/, ''),
					markdown
				});
			}
		}
	}

	const results = Array.from(map.values());
	const order: Record<CategoryKey, number> = { cours: 1, tds: 2, autres: 3 };
	results.sort((a, b) => (order[a.category] ?? 99) - (order[b.category] ?? 99));

	return results;
}

/**
 * Saves generated LaTeX file to R2:
 * <slug>/output/<filename>
 */
export async function saveOutputLatex(
	bucket: R2Bucket | undefined,
	slug: string,
	filename: string,
	texContent: string
): Promise<string> {
	const key = `${slug}/output/${filename}`;
	memoryFallback.set(key, texContent);

	if (bucket) {
		try {
			await bucket.put(key, texContent, {
				httpMetadata: {
					contentType: 'application/x-tex; charset=utf-8'
				}
			});
		} catch (e) {
			console.warn(`R2 put latex failed for ${key}:`, e);
		}
	}
	return key;
}

/**
 * Retrieves a generated LaTeX file from R2 or fallback.
 */
export async function getOutputLatex(
	bucket: R2Bucket | undefined,
	slug: string,
	filename: string
): Promise<{ text: () => Promise<string>; body: any } | null> {
	const key = `${slug}/output/${filename}`;

	if (bucket) {
		try {
			const item = await bucket.get(key);
			if (item) return item;
		} catch (e) {
			console.warn(`R2 bucket.get failed for ${key}:`, e);
		}
	}

	const cached = memoryFallback.get(key);
	if (cached) {
		return {
			text: async () => cached,
			body: cached
		};
	}

	return null;
}
