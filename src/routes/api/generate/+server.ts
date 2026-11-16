import type { RequestHandler } from "./$types"
import { env } from "cloudflare:workers"
import {
	toSubjectSlug,
	toTimestampedSlug,
	getNextOutputFilename,
} from "#lib/server/slug"
import {
	type CategoryKey,
	type ExtractedDocument,
	saveRawUpload,
	saveExtractedMarkdown,
	loadExtractedDocuments,
	saveOutputLatex,
	inspectSubject,
} from "#lib/server/r2"
import { runReasoningPipeline } from "#lib/server/pipeline"
import { assembleLatexDocument } from "#lib/utils/latex"

const MAX_IMAGE_BYTES = 5_000_000

function toBase64(arrayBuffer: ArrayBuffer): string {
	const bytes = new Uint8Array(arrayBuffer)
	let binary = ""
	const chunkSize = 0x8000
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const chunk = bytes.subarray(i, i + chunkSize)
		binary += String.fromCharCode(...chunk)
	}
	return btoa(binary)
}

export const POST: RequestHandler = async ({ request }) => {
	const formData = await request.formData()

	const subjectName = (formData.get("subject") as string)?.trim()
	const action = (formData.get("action") as string) || "generate"
	const feedback = (formData.get("feedback") as string)?.trim()
	const targetSlugParam = (formData.get("targetSlug") as string)?.trim()
	const reuseExtracted = formData.get("reuseExtracted") === "true"

	if (!subjectName) {
		return new Response(JSON.stringify({ error: "Subject name is required" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		})
	}

	const baseSlug = toSubjectSlug(subjectName)
	const bucket = env.BUCKET
	const ai = env.AI

	let effectiveSlug = baseSlug

	// Determine versioning:
	if (bucket && action === "generate" && !reuseExtracted) {
		const existingInspection = await inspectSubject(bucket, baseSlug)
		if (
			existingInspection.exists &&
			(existingInspection.hasExtracted || existingInspection.hasOutput)
		) {
			effectiveSlug = toTimestampedSlug(baseSlug)
		}
	} else if (targetSlugParam) {
		effectiveSlug = targetSlugParam
	}

	const encoder = new TextEncoder()

	const stream = new ReadableStream({
		async start(controller) {
			const sendEvent = (event: string, data: any) => {
				controller.enqueue(
					encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
				)
			}

			try {
				let documents: ExtractedDocument[] = []

				if (action === "regenerate" || reuseExtracted) {
					sendEvent("status", {
						step: "loading",
						message: "Loading existing extracted documents from storage…",
					})

					documents = await loadExtractedDocuments(bucket, effectiveSlug)
					if (documents.length === 0 && effectiveSlug !== baseSlug) {
						documents = await loadExtractedDocuments(bucket, baseSlug)
						if (documents.length > 0) effectiveSlug = baseSlug
					}

					console.log(
						`[Pipeline] Reusing ${documents.length} cached documents for ${effectiveSlug}`,
					)
				} else {
					// Stage 1: Visual preparation
					sendEvent("status", {
						step: "preparing",
						message: "Preparing uploaded documents for vision input…",
					})

					const categories: CategoryKey[] = ["cours", "tds", "autres"]

					for (const cat of categories) {
						const files = formData.getAll(`files_${cat}`) as File[]
						for (const file of files) {
							if (!file || typeof file === "string" || file.size === 0) continue

							const filename = file.name || `file_${Date.now()}`
							const arrayBuffer = await file.arrayBuffer()

							// 1. Persist raw file to R2
							await saveRawUpload(
								bucket,
								effectiveSlug,
								cat,
								filename,
								arrayBuffer,
							)

							// 2. Build image input for multimodal model (no PDF text extraction)
							const fileBlob = new Blob([arrayBuffer], { type: file.type })
							const isImage = file.type.startsWith("image/")

							let markdown: string | undefined
							let imageDataUrl: string | undefined

							if (isImage) {
								if (file.size > MAX_IMAGE_BYTES) {
									markdown = `[Image ${filename}: ignored because it exceeds ${MAX_IMAGE_BYTES} bytes.]`
								} else {
									const base64 = toBase64(arrayBuffer)
									imageDataUrl = `data:${file.type};base64,${base64}`
									markdown = `[Image ${filename}: attached for multimodal analysis.]`
								}
							} else if (
								file.type === "application/pdf" ||
								filename.toLowerCase().endsWith(".pdf")
							) {
								markdown = `[PDF ${filename}: PDF extraction is disabled in image-only mode. Convert this PDF to images client-side before upload.]`
							} else {
								markdown = `[File ${filename}: unsupported in image-only mode. Upload image files instead.]`
							}

							// 3. Persist status note to R2
							await saveExtractedMarkdown(
								bucket,
								effectiveSlug,
								cat,
								filename,
								markdown || `[File ${filename}: no additional details.]`,
							)

							documents.push({
								category: cat,
								filename,
								markdown,
								imageDataUrl,
								mimeType: file.type || fileBlob.type,
							})
						}
					}

					console.log(
						`[Pipeline] Extracted ${documents.length} documents for "${subjectName}" (${effectiveSlug}):`,
						documents.map(
							(d) =>
								`${d.category}/${d.filename} (${(d.markdown || "").length} chars)`,
						),
					)
				}

				// Stage 2: Reasoning & Generation
				sendEvent("status", {
					step: "reasoning",
					message:
						action === "regenerate"
							? "Regenerating LaTeX résumé with user feedback…"
							: "Synthesizing revision résumé with reasoning model…",
				})

				let accumulatedReasoning = ""
				let accumulatedContent = ""
				let hadError = false

				const reasoningGen = runReasoningPipeline({
					ai,
					subjectName,
					documents,
					isRegeneration: action === "regenerate",
					feedback,
				})

				for await (const chunk of reasoningGen) {
					if (chunk.type === "reasoning" && chunk.chunk) {
						accumulatedReasoning += chunk.chunk
						sendEvent("reasoning", { chunk: chunk.chunk })
					} else if (chunk.type === "content" && chunk.chunk) {
						accumulatedContent += chunk.chunk
						sendEvent("content", { chunk: chunk.chunk })
					} else if (chunk.type === "status") {
						sendEvent("status", chunk)
					} else if (chunk.type === "error") {
						hadError = true
						sendEvent("error", { message: chunk.message })
					}
				}

				if (hadError) {
					controller.close()
					return
				}

				if (!accumulatedContent.trim()) {
					sendEvent("error", {
						message:
							"Model returned empty output. Please verify that documents contain readable text.",
					})
					controller.close()
					return
				}

				// Stage 3: Assembly
				sendEvent("status", {
					step: "assembling",
					message: "Assembling complete LaTeX document with preamble…",
				})

				const completeLatex = assembleLatexDocument(accumulatedContent)

				const inspection = await inspectSubject(bucket, effectiveSlug)
				let outputFilename = "resume.tex"
				if (action === "regenerate") {
					outputFilename = getNextOutputFilename(inspection.outputFiles)
				}
				await saveOutputLatex(
					bucket,
					effectiveSlug,
					outputFilename,
					completeLatex,
				)

				sendEvent("done", {
					slug: effectiveSlug,
					outputFile: outputFilename,
					downloadUrl: `/api/download?slug=${encodeURIComponent(effectiveSlug)}&file=${encodeURIComponent(outputFilename)}`,
				})

				controller.close()
			} catch (err: any) {
				console.error("Generation pipeline error:", err)
				sendEvent("error", {
					message: err?.message || "Pipeline processing failed",
				})
				controller.close()
			}
		},
	})

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
		},
	})
}
