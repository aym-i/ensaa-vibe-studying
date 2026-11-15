import type { RequestHandler } from './$types';
import { getOutputLatex } from '#lib/server/r2';

export const GET: RequestHandler = async ({ url, platform }) => {
	const slug = url.searchParams.get('slug');
	const file = url.searchParams.get('file') || 'resume.tex';

	if (!slug) {
		return new Response('Missing slug parameter', { status: 400 });
	}

	// Sanitize file parameter to avoid directory traversal
	const sanitizedFile = file.replace(/[^a-zA-Z0-9._-]/g, '');
	if (!sanitizedFile.endsWith('.tex')) {
		return new Response('Invalid file requested', { status: 400 });
	}

	const bucket = platform?.env?.BUCKET;
	const item = await getOutputLatex(bucket, slug, sanitizedFile);

	if (!item) {
		return new Response('File not found in storage or cache', { status: 404 });
	}

	const filename = `${slug}-${sanitizedFile}`;
	const content = typeof item.body === 'string' ? item.body : await item.text();

	return new Response(content, {
		headers: {
			'Content-Type': 'application/x-tex; charset=utf-8',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Cache-Control': 'no-cache'
		}
	});
};
