/**
 * Derives a normalized subject slug:
 * lowercase, accents stripped, non-alphanumeric chars converted to hyphens.
 * Example: "Analyse Numérique" -> "analyse-numerique"
 */
export function toSubjectSlug(name: string): string {
	if (!name || typeof name !== 'string') return 'unnamed-subject';

	const normalized = name
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '') // remove diacritics
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-') // spaces and non-alphanumerics to hyphens
		.replace(/^-+|-+$/g, ''); // strip leading/trailing hyphens

	return normalized || 'unnamed-subject';
}

/**
 * Creates a timestamped version string for subject re-uploads:
 * e.g., "analyse-numerique-20261115-1430"
 */
export function toTimestampedSlug(slug: string, date = new Date()): string {
	const pad = (n: number) => n.toString().padStart(2, '0');
	const y = date.getUTCFullYear();
	const m = pad(date.getUTCMonth() + 1);
	const d = pad(date.getUTCDate());
	const hh = pad(date.getUTCHours());
	const mm = pad(date.getUTCMinutes());

	return `${slug}-${y}${m}${d}-${hh}${mm}`;
}

/**
 * Determines the next output version filename in an R2 subject directory:
 * e.g., resume.tex -> resume-v2.tex -> resume-v3.tex
 */
export function getNextOutputFilename(existingFiles: string[]): string {
	const resumeFiles = existingFiles.filter((f) => f.startsWith('resume') && f.endsWith('.tex'));
	if (resumeFiles.length === 0) return 'resume.tex';

	let highestVersion = 1;
	for (const file of resumeFiles) {
		if (file === 'resume.tex') {
			highestVersion = Math.max(highestVersion, 1);
			continue;
		}
		const match = file.match(/^resume-v(\d+)\.tex$/);
		if (match) {
			const v = parseInt(match[1], 10);
			if (!isNaN(v)) {
				highestVersion = Math.max(highestVersion, v);
			}
		}
	}

	return `resume-v${highestVersion + 1}.tex`;
}

