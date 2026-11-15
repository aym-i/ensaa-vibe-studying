import type { CategoryKey, ExtractedDocument } from './r2';
import { extractText } from 'unpdf';

export const SYSTEM_PROMPT = `You are generating a **résumé de révision** for an ENSA Agadir student preparing for exams. All content you produce must be in **French**. The UI language is irrelevant to you.

Prioritize content that appears in **TDs, TPs, and Other** (exam notices, older DS). Lesson content is included only where it is **essential** to understand those exercises or where the TDs assume it.

Be **honest and transparent**. If a file is illegible, contradictory, or missing, say so in the Notes section. Do not hallucinate exam details.

The output must be **valid LaTeX body content** that will be inserted into a provided template. Do **not** include \`\\documentclass\`, \`\\begin{document}\`, or \`\\end{document}\`.`;

export const LATEX_STRUCTURE_CONTRACT = `Strict structural requirements for your LaTeX body output:
You MUST produce exactly these four unnumbered sections in this exact order, with HIGH technical density and strictly grounded in the provided documents:

1. \\section*{Cours — L'essentiel}
- Do NOT provide vague bullet points or generic descriptions.
- Provide a rigorous, highly concentrated mathematical/technical résumé:
  * Formal statements of central theorems, definitions, and laws directly mobilized in the TDs/TPs.
  * Exact mathematical formulas, expressions, differential equations, or transfer functions formatted in LaTeX display math (\\[ ... \\] or \\begin{equation} ... \\end{equation}).
  * Explicit definition of each parameter, variable, physical unit, sign convention, and region of validity.
  * Operational hints and calculation recipes: direct shortcuts and methods used in exercises to solve standard problems.
- MUST include a comprehensive \\subsection*{Conseils}:
  * Pitfalls and traps (pièges classiques à éviter, erreurs fréquentes de signe ou d'hypothèse).
  * Teacher emphases highlighted during lectures/TDs.
  * Standard notation conventions to respect in exams.

2. \\section*{Exercices}
- Provide 4 to 5 rigorous, distinct exercises drawn directly from lesson applications, TD sheets, or exam notices.
- For each exercise:
  * Full, precise problem statement (Énoncé clair et contextualisé).
  * Methodological hint (Indication / Méthode de résolution).
  * Step-by-step solution outline with final analytical/numerical formulas.
- Do NOT invent artificial exercises. If fewer than 4 distinct exercises exist in the sources, say so in Notes.

3. \\section*{Test — Sujet type DS}
- A realistic practice exam synthesized from TD patterns and older DS found in Other.
- If no older DS exists in Other, explicitly label it in Notes as "sujet construit à partir des TDs".
- Include 2 to 3 multi-part problems with explicit point allocations totaling 20 points (e.g., Problème 1 [8 points], Problème 2 [12 points]).

4. \\section*{Notes — Transparence}
- Mandatory section (never omit, even if short).
- Disclose all ambiguities, unreadable formulas, missing parts, or contradictions detected in the uploaded documents.
- State all assumptions made (duration, default parameter values, notations).

Important: Return ONLY the LaTeX body code. Do NOT output \\documentclass, \\begin{document}, or \\end{document}.`;

/**
 * Extracts clean, readable text/markdown from an uploaded file.
 * Prioritizes Workers AI toMarkdown(), with robust fallback to unpdf for PDF binaries.
 */
export async function extractDocumentMarkdown(
	ai: any,
	filename: string,
	fileBlob: Blob
): Promise<string> {
	const isPdf = filename.toLowerCase().endsWith('.pdf') || fileBlob.type.includes('pdf');

	// 1. First attempt: Cloudflare Workers AI toMarkdown()
	if (ai && typeof ai.toMarkdown === 'function') {
		try {
			const res = await ai.toMarkdown({
				name: filename,
				blob: fileBlob
			});

			if (res) {
				const doc = Array.isArray(res) ? res[0] : res;
				if (doc && typeof doc === 'object') {
					if ('data' in doc && typeof doc.data === 'string' && doc.data.trim()) {
						return doc.data;
					}
					if ('text' in doc && typeof doc.text === 'string' && doc.text.trim()) {
						return doc.text;
					}
				} else if (typeof res === 'string' && res.trim()) {
					return res;
				}
			}
		} catch (err: any) {
			console.warn(`env.AI.toMarkdown failed for ${filename}, attempting parser fallback:`, err?.message || err);
		}
	}

	// 2. Second attempt: If it is a PDF file, extract real textual content using unpdf
	if (isPdf) {
		try {
			const buffer = await fileBlob.arrayBuffer();
			const { text } = await extractText(new Uint8Array(buffer));
			const extracted = Array.isArray(text) ? text.join('\n\n') : text;
			if (extracted && extracted.trim().length > 30) {
				return extracted;
			}
		} catch (pdfErr: any) {
			console.warn(`PDF extraction fallback failed for ${filename}:`, pdfErr?.message || pdfErr);
		}
	}

	// 3. Third attempt: Plain text read
	try {
		const rawText = await fileBlob.text();
		// Ensure we do not pass raw binary garbage to the LLM
		if (rawText.startsWith('%PDF-') || /[\x00-\x08\x0E-\x1F]/.test(rawText.slice(0, 500))) {
			return `[Document ${filename}: binary PDF file could not be text-extracted. Please verify document formatting.]`;
		}
		return rawText || `[Document ${filename} was empty]`;
	} catch (e: any) {
		return `[Document ${filename}: unable to read text: ${e?.message || 'unknown'}]`;
	}
}

/**
 * Prepares the formatted user prompt strictly containing the user's extracted documents.
 */
export function buildPromptFromDocuments(
	subjectName: string,
	documents: ExtractedDocument[]
): string {
	const categoryNames: Record<CategoryKey, string> = {
		cours: 'Lessons (Cours)',
		tds: 'TDs / TPs (Travaux Dirigés / Pratiques)',
		autres: 'Other (Exam notices, older DS, teacher instructions)'
	};

	let content = `# Sujet de Révision: ${subjectName}\n\n`;
	content += `${LATEX_STRUCTURE_CONTRACT}\n\n`;
	content += `--- DOCUMENTS FOURNIS POUR L'EXTRACTION ET LA SYNTHÈSE ---\n\n`;

	if (documents.length === 0) {
		content += `(Aucun document textuel n'a pu être extrait. Veuillez vous baser sur les prérequis stricts du sujet.)\n`;
	} else {
		for (const doc of documents) {
			const catLabel = categoryNames[doc.category] || doc.category;
			content += `=== CATEGORIE: ${catLabel} | FICHIER: ${doc.filename} ===\n\n`;
			content += `${doc.markdown}\n\n`;
			content += `=== FIN DU FICHIER: ${doc.filename} ===\n\n`;
		}
	}

	return content;
}

export interface StreamEvent {
	type: 'status' | 'reasoning' | 'content' | 'done' | 'error';
	chunk?: string;
	message?: string;
	step?: string;
	slug?: string;
	outputFile?: string;
}

/**
 * Runs the reasoning AI pipeline with streaming.
 */
export async function* runReasoningPipeline(options: {
	ai: any;
	subjectName: string;
	documents: ExtractedDocument[];
	isRegeneration?: boolean;
	feedback?: string;
	previousLatex?: string;
}): AsyncGenerator<StreamEvent> {
	const { ai, subjectName, documents, isRegeneration, feedback, previousLatex } = options;

	const reasoningEffort = isRegeneration ? 'low' : 'medium';
	const baseUserPrompt = buildPromptFromDocuments(subjectName, documents);

	const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
		{ role: 'system', content: SYSTEM_PROMPT },
		{ role: 'user', content: baseUserPrompt }
	];

	if (isRegeneration && feedback) {
		if (previousLatex) {
			messages.push({
				role: 'assistant',
				content: previousLatex
			});
		}
		messages.push({
			role: 'user',
			content: `Feedback de révision de l'étudiant:\n${feedback}\n\nVeuillez régénérer le corps du document LaTeX en intégrant ces ajustements tout en respectant scrupuleusement les 4 sections obligatoires.`
		});
	}

	// Models supported in Workers AI
	const candidateModels = [
		'@cf/moonshotai/kimi-k2.6',
		'@cf/deepseek-ai/deepseek-v4.1-flash-1017',
		'@cf/deepseek-ai/deepseek-v4-flash-0731',
		'@cf/deepseek-ai/deepseek-r1-distill-qwen-32b'
	];

	yield {
		type: 'status',
		step: 'reasoning',
		message: isRegeneration
			? 'Refining résumé with low reasoning effort…'
			: 'Analyzing uploaded documents and reasoning with Cloudflare Workers AI…'
	};

	let stream: any = null;
	let lastError: any = null;

	if (ai && typeof ai.run === 'function') {
		for (const model of candidateModels) {
			try {
				// First try with reasoning_effort
				stream = await ai.run(model, {
					messages,
					stream: true,
					reasoning_effort: reasoningEffort
				});
				if (stream) break;
			} catch (err: any) {
				lastError = err;
				console.warn(`Model ${model} with reasoning_effort failed:`, err?.message || err);

				// Second try without reasoning_effort if unsupported by that specific model
				try {
					stream = await ai.run(model, {
						messages,
						stream: true
					});
					if (stream) break;
				} catch (retryErr: any) {
					lastError = retryErr;
					console.warn(`Model ${model} standard run also failed:`, retryErr?.message || retryErr);
				}
			}
		}
	} else {
		lastError = new Error('Cloudflare Workers AI binding (platform.env.AI) is not available. Please ensure you are logged in via "pnpm wrangler login" or run with "pnpm run dev -- --remote".');
	}

	if (!stream) {
		const errorMessage = lastError?.message || 'Unable to establish connection with Cloudflare Workers AI.';
		console.error('Fatal AI error:', errorMessage);
		yield {
			type: 'error',
			message: `Workers AI error: ${errorMessage}`
		};
		return;
	}

	// Read and forward chunks from stream
	let inReasoningBlock = false;
	const textDecoder = new TextDecoder();
	const reader = stream.getReader();
	let buffer = '';

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += typeof value === 'string' ? value : textDecoder.decode(value, { stream: true });

		const lines = buffer.split('\n');
		buffer = lines.pop() ?? '';

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed === 'data: [DONE]') continue;

			if (trimmed.startsWith('data: ')) {
				const jsonStr = trimmed.slice(6);
				try {
					const data = JSON.parse(jsonStr);

					let reasoningChunk =
						data.reasoning ??
						data.choices?.[0]?.delta?.reasoning ??
						data.choices?.[0]?.delta?.reasoning_content;

					let contentChunk =
						data.content ??
						data.response ??
						data.choices?.[0]?.delta?.content ??
						data.choices?.[0]?.text;

					if (!reasoningChunk && contentChunk) {
						if (contentChunk.includes('<think>') || contentChunk.includes('<reasoning>')) {
							inReasoningBlock = true;
							contentChunk = contentChunk.replace(/<(?:think|reasoning)>/g, '');
						}
						if (contentChunk.includes('</think>') || contentChunk.includes('</reasoning>')) {
							const parts = contentChunk.split(/<\/(?:think|reasoning)>/);
							if (inReasoningBlock && parts[0]) {
								yield { type: 'reasoning', chunk: parts[0] };
							}
							inReasoningBlock = false;
							contentChunk = parts.slice(1).join('');
						} else if (inReasoningBlock) {
							reasoningChunk = contentChunk;
							contentChunk = '';
						}
					}

					if (reasoningChunk) {
						yield { type: 'reasoning', chunk: reasoningChunk };
					}
					if (contentChunk) {
						yield { type: 'content', chunk: contentChunk };
					}
				} catch {
					yield { type: 'content', chunk: jsonStr };
				}
			}
		}
	}

	if (buffer.trim() && buffer.trim() !== 'data: [DONE]') {
		if (buffer.startsWith('data: ')) {
			try {
				const data = JSON.parse(buffer.slice(6));
				const r = data.reasoning || data.choices?.[0]?.delta?.reasoning;
				const c = data.content || data.response || data.choices?.[0]?.delta?.content;
				if (r) yield { type: 'reasoning', chunk: r };
				if (c) yield { type: 'content', chunk: c };
			} catch {
				yield { type: 'content', chunk: buffer.slice(6) };
			}
		}
	}
}
