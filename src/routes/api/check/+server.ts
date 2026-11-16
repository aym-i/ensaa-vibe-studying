import { json } from "@sveltejs/kit"
import type { RequestHandler } from "./$types"
import { env } from "cloudflare:workers"
import { toSubjectSlug } from "#lib/server/slug"
import { inspectSubject } from "#lib/server/r2"

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as { subjectName?: string }
		const subjectName = body?.subjectName

		if (!subjectName || typeof subjectName !== "string") {
			return json({ error: "Subject name is required" }, { status: 400 })
		}

		const slug = toSubjectSlug(subjectName)
		const bucket = env.BUCKET

		if (!bucket) {
			return json({
				slug,
				exists: false,
				hasExtracted: false,
				extractedCount: 0,
				extractedFiles: [],
				hasOutput: false,
				outputFiles: [],
				latestOutput: null,
			})
		}

		const inspection = await inspectSubject(bucket, slug)
		return json(inspection)
	} catch (err: any) {
		console.error("Check subject failed:", err)
		return json(
			{ error: err?.message || "Failed to inspect subject" },
			{ status: 500 },
		)
	}
}
