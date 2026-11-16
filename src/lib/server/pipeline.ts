import type { CategoryKey, ExtractedDocument } from "./r2"
import { assembleLatexDocument } from "./latex"

const MAX_CHARS_PER_DOCUMENT = 24_000
const MAX_TOTAL_DOCUMENT_CHARS = 90_000
const MAX_IMAGES_IN_PROMPT = 24
const MAX_IMAGE_DATA_URL_CHARS = 3_000_000

function sanitizeRawPassthroughText(raw: string): string | null {
	if (!raw) return ""

	// If this looks like raw PDF bytes or mostly binary/control characters, don't pass it to the model.
	if (raw.startsWith("%PDF-")) return null

	const controlMatches = raw.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []
	const probeLength = Math.max(1, Math.min(raw.length, 4000))
	const controlRatio = controlMatches.length / probeLength
	if (controlRatio > 0.01) return null

	const normalized = raw
		.replace(/\u0000/g, "")
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.replace(/\n{4,}/g, "\n\n\n")
		.trim()

	if (!normalized) return ""
	return normalized
}

export const SYSTEM_PROMPT = `You are generating a **résumé de révision** for an ENSA Agadir student preparing for exams. All content you produce must be in **French**. The UI language is irrelevant to you.

Prioritize content that appears in **TDs, TPs, and Other** (exam notices, older DS). Lesson content is included only where it is **essential** to understand those exercises or where the TDs assume it.

Be **honest and transparent**. If a file is illegible, contradictory, or missing, say so in the Notes section. Do not hallucinate exam details.

The output must be **valid LaTeX body content** that will be inserted into a provided template. Do **not** include \`\\documentclass\`, \`\\begin{document}\`, or \`\\end{document}\`.`

export const LATEX_STRUCTURE_CONTRACT = `Strict structural requirements for your LaTeX body output:
You MUST produce exactly these four unnumbered sections in this exact order:

1. \\section*{Cours — L'essentiel}
- Include only bare essential concepts directly relevant to exercises in TDs/TPs or Other materials.
- Must include a \\subsection*{Conseils} detailing tips, common pitfalls, and teacher emphases.

2. \\section*{Exercices}
- Provide 4 to 5 distinct exercises with clear problem statements and brief solutions or method hints.
- Base them strictly on the source documents. If fewer than 4 distinct exercises are found, state so in Notes.

3. \\section*{Test — Sujet type DS}
- A practice exam synthesized from TD patterns and older DS.
- If no older DS was provided in Other, explicitly state that in Notes and label it as "sujet construit à partir des TDs".
- Include 2 to 3 problems with realistic point allocations.

4. \\section*{Notes — Transparence}
- Mandatory section (never omit).
- Disclose any unreadable, missing, contradictory, or ambiguous source material.
- Disclose any assumptions made (e.g., duration, notation).

Important: Return ONLY the LaTeX body code. Do NOT output \\documentclass, \\begin{document}, or \\end{document}.`

/**
 * Extracts markdown from a file using Workers AI toMarkdown.
 */
export async function extractDocumentMarkdown(
	ai: any,
	filename: string,
	fileBlob: Blob,
): Promise<string> {
	// Raw passthrough mode: do not run toMarkdown/unpdf conversion.
	// Keeping the previous conversion approach commented here for quick rollback if needed.
	//
	// Previous conversion flow:
	// 1) ai.toMarkdown({ name, blob })
	// 2) low-signal filtering
	// 3) unpdf fallback for PDFs

	void ai

	try {
		const raw = await fileBlob.text()
		const sanitized = sanitizeRawPassthroughText(raw)
		if (sanitized === null) {
			return `[Document ${filename}: raw passthrough produced binary/unreadable content. This file cannot be used without extraction or OCR.]`
		}
		return sanitized || `[Document ${filename} was empty]`
	} catch (err: any) {
		return `[Document ${filename}: unable to read raw text: ${err?.message || "unknown"}]`
	}
}

/**
 * Prepares the formatted user prompt from extracted documents.
 */
export function buildPromptFromDocuments(
	subjectName: string,
	documents: ExtractedDocument[],
): string {
	const categoryNames: Record<CategoryKey, string> = {
		cours: "Lessons (Cours)",
		tds: "TDs / TPs (Travaux Dirigés / Pratiques)",
		autres: "Other (Exam notices, older DS, teacher instructions)",
	}

	let content = `# Sujet de Révision: ${subjectName}\n\n`
	content += `${LATEX_STRUCTURE_CONTRACT}\n\n`
	content += `--- DOCUMENTS FOURNIS POUR L'EXTRACTION ET LA SYNTHÈSE ---\n\n`

	let remainingChars = MAX_TOTAL_DOCUMENT_CHARS

	if (documents.length === 0) {
		content += `(Aucun document n'a été fourni pour ce sujet.)\n`
	} else {
		for (const doc of documents) {
			if (remainingChars <= 0) {
				content += `[Troncature: limite de taille atteinte, certains documents n'ont pas été inclus.]\n\n`
				break
			}

			const catLabel = categoryNames[doc.category] || doc.category
			const markdown =
				doc.markdown ||
				`[Document ${doc.filename}: contenu textuel non disponible.]`
			const perDocSlice = markdown.slice(0, MAX_CHARS_PER_DOCUMENT)
			const bounded = perDocSlice.slice(0, remainingChars)
			remainingChars -= bounded.length
			const truncated = markdown.length > bounded.length

			content += `=== CATEGORIE: ${catLabel} | FICHIER: ${doc.filename} ===\n\n`
			content += `${bounded}\n\n`
			if (truncated) {
				content += `[Note: contenu tronqué pour respecter la limite de contexte.]\n\n`
			}
			content += `=== FIN DU FICHIER: ${doc.filename} ===\n\n`
		}
	}

	return content
}

function buildVisionUserContent(
	subjectName: string,
	documents: ExtractedDocument[],
) {
	const categoryNames: Record<CategoryKey, string> = {
		cours: "Lessons (Cours)",
		tds: "TDs / TPs (Travaux Dirigés / Pratiques)",
		autres: "Other (Exam notices, older DS, teacher instructions)",
	}

	const textSections: string[] = [
		`# Sujet de Révision: ${subjectName}`,
		LATEX_STRUCTURE_CONTRACT,
		"--- DOCUMENTS FOURNIS ---",
		"Les images sont attachées dans ce message et doivent être lues en priorité.",
	]

	const content: Array<
		| { type: "text"; text: string }
		| { type: "image_url"; image_url: { url: string } }
	> = []

	let remainingChars = MAX_TOTAL_DOCUMENT_CHARS
	let imageCount = 0

	for (const doc of documents) {
		const catLabel = categoryNames[doc.category] || doc.category
		const header = `=== CATEGORIE: ${catLabel} | FICHIER: ${doc.filename} ===`
		textSections.push(header)

		if (
			doc.imageDataUrl &&
			imageCount < MAX_IMAGES_IN_PROMPT &&
			doc.imageDataUrl.length <= MAX_IMAGE_DATA_URL_CHARS
		) {
			content.push({ type: "text", text: textSections.join("\n\n") })
			textSections.length = 0
			content.push({ type: "image_url", image_url: { url: doc.imageDataUrl } })
			imageCount += 1
			textSections.push(`(Image attachée: ${doc.filename})`)
			textSections.push("=== FIN DU FICHIER ===")
			continue
		}

		if (doc.imageDataUrl && imageCount >= MAX_IMAGES_IN_PROMPT) {
			textSections.push(
				`[Image ignorée: limite d'images atteinte (${MAX_IMAGES_IN_PROMPT}).]`,
			)
			textSections.push("=== FIN DU FICHIER ===")
			continue
		}

		if (
			doc.imageDataUrl &&
			doc.imageDataUrl.length > MAX_IMAGE_DATA_URL_CHARS
		) {
			textSections.push(
				"[Image ignorée: taille trop grande pour le contexte du modèle.]",
			)
			textSections.push("=== FIN DU FICHIER ===")
			continue
		}

		const markdown =
			doc.markdown ||
			`[Document ${doc.filename}: contenu textuel non disponible.]`
		if (remainingChars <= 0) {
			textSections.push(
				"[Troncature: limite de taille atteinte, certains contenus n'ont pas été inclus.]",
			)
			textSections.push("=== FIN DU FICHIER ===")
			continue
		}

		const perDocSlice = markdown.slice(0, MAX_CHARS_PER_DOCUMENT)
		const bounded = perDocSlice.slice(0, remainingChars)
		remainingChars -= bounded.length
		textSections.push(bounded)
		if (markdown.length > bounded.length) {
			textSections.push(
				"[Note: contenu tronqué pour respecter la limite de contexte.]",
			)
		}
		textSections.push("=== FIN DU FICHIER ===")
	}

	if (textSections.length > 0) {
		content.push({ type: "text", text: textSections.join("\n\n") })
	}

	if (content.length === 0) {
		content.push({
			type: "text",
			text: `# Sujet de Révision: ${subjectName}\n\n${LATEX_STRUCTURE_CONTRACT}\n\n(Aucun contenu exploitable n'a été fourni.)`,
		})
	}

	return content
}

export interface StreamEvent {
	type: "status" | "reasoning" | "content" | "done" | "error"
	chunk?: string
	message?: string
	step?: string
	slug?: string
	outputFile?: string
}

/**
 * Runs the reasoning AI pipeline with streaming.
 */
export async function* runReasoningPipeline(options: {
	ai: any
	subjectName: string
	documents: ExtractedDocument[]
	isRegeneration?: boolean
	feedback?: string
	previousLatex?: string
}): AsyncGenerator<StreamEvent> {
	const {
		ai,
		subjectName,
		documents,
		isRegeneration,
		feedback,
		previousLatex,
	} = options

	const reasoningEffort = isRegeneration ? "low" : "medium"
	const baseUserContent = buildVisionUserContent(subjectName, documents)

	const messages: Array<{
		role: "system" | "user" | "assistant"
		content: any
	}> = [
		{ role: "system", content: SYSTEM_PROMPT },
		{ role: "user", content: baseUserContent },
	]

	if (isRegeneration && feedback) {
		if (previousLatex) {
			messages.push({
				role: "assistant",
				content: previousLatex,
			})
		}
		messages.push({
			role: "user",
			content: `Feedback de révision de l'étudiant:\n${feedback}\n\nVeuillez régénérer le corps du document LaTeX en intégrant ces ajustements tout en respectant scrupuleusement les 4 sections obligatoires.`,
		})
	}

	// Model selection: primary GPT-OSS 120B, fallback to Gemma 4 26B A4B
	const primaryModel = "@cf/google/gemma-4-26b-a4b-it"
	const fallbackModel = "@cf/openai/gpt-oss-120b"

	yield {
		type: "status",
		step: "reasoning",
		message: isRegeneration
			? "Refining résumé with low reasoning effort…"
			: "Analyzing documents and reasoning with medium effort…",
	}

	let stream: any = null

	if (ai && typeof ai.run === "function") {
		try {
			stream = await ai.run(primaryModel, {
				messages,
				stream: true,
				reasoning_effort: reasoningEffort,
			})
		} catch (err: any) {
			console.warn(
				`Primary model ${primaryModel} failed, trying fallback ${fallbackModel}:`,
				err,
			)
			try {
				stream = await ai.run(fallbackModel, {
					messages,
					stream: true,
					reasoning_effort: reasoningEffort,
				})
			} catch (fallbackErr: any) {
				console.error("AI run failed on both models:", fallbackErr)
				throw fallbackErr
			}
		}
	} else {
		// Mock streaming generator for local testing / offline environments
		yield* mockStreamResponse(subjectName, isRegeneration, feedback)
		return
	}

	// Read and parse chunks from Workers AI stream
	let inReasoningBlock = false
	const textDecoder = new TextDecoder()
	const reader = stream.getReader()
	let buffer = ""

	while (true) {
		const { done, value } = await reader.read()
		if (done) break

		buffer +=
			typeof value === "string"
				? value
				: textDecoder.decode(value, { stream: true })

		const lines = buffer.split("\n")
		buffer = lines.pop() ?? ""

		for (const line of lines) {
			const trimmed = line.trim()
			if (!trimmed || trimmed === "data: [DONE]") continue

			if (trimmed.startsWith("data: ")) {
				const jsonStr = trimmed.slice(6)
				try {
					const data = JSON.parse(jsonStr)

					// 1. Separate reasoning field
					let reasoningChunk =
						data.reasoning ??
						data.choices?.[0]?.delta?.reasoning ??
						data.choices?.[0]?.delta?.reasoning_content

					// 2. Separate content / response field
					let contentChunk =
						data.content ??
						data.response ??
						data.choices?.[0]?.delta?.content ??
						data.choices?.[0]?.text

					// 3. Fallback: Check if reasoning is inline via <think> or <reasoning> tags
					if (!reasoningChunk && contentChunk) {
						if (
							contentChunk.includes("<think>") ||
							contentChunk.includes("<reasoning>")
						) {
							inReasoningBlock = true
							contentChunk = contentChunk.replace(/<(?:think|reasoning)>/g, "")
						}
						if (
							contentChunk.includes("</think>") ||
							contentChunk.includes("</reasoning>")
						) {
							const parts = contentChunk.split(/<\/(?:think|reasoning)>/)
							if (inReasoningBlock && parts[0]) {
								yield { type: "reasoning", chunk: parts[0] }
							}
							inReasoningBlock = false
							contentChunk = parts.slice(1).join("")
						} else if (inReasoningBlock) {
							reasoningChunk = contentChunk
							contentChunk = ""
						}
					}

					if (reasoningChunk) {
						yield { type: "reasoning", chunk: reasoningChunk }
					}
					if (contentChunk) {
						yield { type: "content", chunk: contentChunk }
					}
				} catch {
					// Raw text chunk if not JSON
					yield { type: "content", chunk: jsonStr }
				}
			}
		}
	}

	if (buffer.trim() && buffer.trim() !== "data: [DONE]") {
		if (buffer.startsWith("data: ")) {
			try {
				const data = JSON.parse(buffer.slice(6))
				const r = data.reasoning || data.choices?.[0]?.delta?.reasoning
				const c =
					data.content || data.response || data.choices?.[0]?.delta?.content
				if (r) yield { type: "reasoning", chunk: r }
				if (c) yield { type: "content", chunk: c }
			} catch {
				yield { type: "content", chunk: buffer.slice(6) }
			}
		}
	}
}

/**
 * Mock generator for local development when Workers AI binding is simulated.
 */
async function* mockStreamResponse(
	subjectName: string,
	isRegeneration?: boolean,
	feedback?: string,
): AsyncGenerator<StreamEvent> {
	const reasoningSteps = [
		`Analyse des documents pour la matière: "${subjectName}".\n`,
		`Identification des concepts centraux dans les TDs et TPs.\n`,
		`Filtrage du cours magistral pour ne retenir que l'essentiel requis.\n`,
		`Formulation de 4 exercices d'application représentatifs avec indications de résolution.\n`,
		`Synthèse d'un sujet type DS avec barème sur 20 points.\n`,
		`Rédaction de la section Notes — Transparence.\n`,
	]

	for (const step of reasoningSteps) {
		yield { type: "reasoning", chunk: step }
		await new Promise((r) => setTimeout(r, 60))
	}

	const latexBody = `\\section*{Cours — L'essentiel}
Cette synthèse regroupe les concepts essentiels du cours de \\textbf{${subjectName}}, directement mobilisés dans les fiches de travaux dirigés et de travaux pratiques.

\\begin{itemize}[leftmargin=*]
  \\item \\textbf{Fondements et Définitions Clés :} Les théorèmes cardinaux indispensables à la résolution des exercices types.
  \\item \\textbf{Méthodologie Opératoire :} Les étapes systématiques d'analyse et de calcul prescrites lors des séances encadrées.
\\end{itemize}

\\subsection*{Conseils}
\\begin{itemize}[leftmargin=*]
  \\item \\textbf{Attention aux hypothèses :} Toujours vérifier les conditions de validité des théorèmes avant leur application.
  \\item \\textbf{Rigueur de la rédaction :} Les enseignants accordent une importance primordiale à la clarté des justifications intermédiaires.
  \\item \\textbf{Notation :} Conserver scrupuleusement les notations introduites dans l'énoncé du DS.
\\end{itemize}

\\section*{Exercices}

\\subsection*{Exercice 1 : Application directe}
\\textbf{Énoncé :} Soit le problème fondamental présenté en TD 1. Déterminer les solutions sous les hypothèses initiales standards.
\\\\
\\textit{Indication / Solution succincte :} Appliquer le théorème principal en posant la substitution classique. On aboutit à un résultat direct après simplification algébrique.

\\subsection*{Exercice 2 : Méthode de calcul et convergence}
\\textbf{Énoncé :} Établir l'existence et l'unicité de la solution pour le système donné dans le TP 1.
\\\\
\\textit{Indication / Solution succincte :} Utiliser le critère de convergence uniforme et expliciter le majorant d'erreur.

\\subsection*{Exercice 3 : Étude d'un cas pratique}
\\textbf{Énoncé :} Modéliser le cas pratique tiré du TD 2 et déterminer les paramètres optimaux.
\\\\
\\textit{Indication / Solution succincte :} Poser les équations d'équilibre et résoudre le système linéaire associé.

\\subsection*{Exercice 4 : Problème de synthèse}
\\textbf{Énoncé :} Démontrer la propriété limite lorsque les conditions aux limites sont perturbées.
\\\\
\\textit{Indication / Solution succincte :} Procéder par dérivation sous le signe somme ou récurrence selon le cadre fixé.

\\section*{Test — Sujet type DS}
\\noindent\\textbf{Épreuve de révision — ENSA Agadir} \\hfill \\textbf{Durée : 2h00} \\\\
\\noindent\\rule{\\linewidth}{0.4pt}

\\subsection*{Problème 1 (8 points)}
Soit l'étude analytique complète du formalisme abordé en séance de TD.
\\begin{enumerate}[label=\\alph*)]
  \\item Définir le cadre d'étude et rappeler les hypothèses (2 pts).
  \\item Résoudre l'équation caractéristique associée (3 pts).
  \\item Interpréter les variations et déduire le comportement asymptotique (3 pts).
\\end{enumerate}

\\subsection*{Problème 2 (12 points)}
Problème de synthèse inspiré des exercices de TD et d'annales.
\\begin{enumerate}[label=\\alph*)]
  \\item Établir les relations de récurrence (4 pts).
  \\item Implémenter l'algorithme de résolution par étapes successives (4 pts).
  \\item Discuter la sensibilité aux paramètres d'entrée (4 pts).
\\end{enumerate}

\\section*{Notes — Transparence}
${
	isRegeneration
		? `Régénération effectuée à partir du feedback: "${feedback || "Ajustements demandés"}". `
		: ""
}Sujet type DS construit à partir des fiches de TD fournies. Aucune annale complète de DS n'étant présente dans les documents annexes, la structure d'évaluation a été calibrée sur le niveau de difficulté des exercices de TD. Durée indicative estimée à 2 heures.`

	const chunkSize = 60
	for (let i = 0; i < latexBody.length; i += chunkSize) {
		yield { type: "content", chunk: latexBody.slice(i, i + chunkSize) }
		await new Promise((r) => setTimeout(r, 20))
	}
}
