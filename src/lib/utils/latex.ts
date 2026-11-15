export const STATIC_PREAMBLE = `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[french]{babel}
\\usepackage{amsmath,amssymb,amsthm}
\\usepackage{geometry}
\\geometry{margin=2.5cm}
\\usepackage{enumitem}
\\usepackage{hyperref}`;

/**
 * Strips markdown code blocks and unwanted document envelopes from model output.
 */
export function cleanLatexBody(raw: string): string {
	if (!raw) return '';

	let cleaned = raw.trim();

	// Strip surrounding markdown code blocks e.g. ```latex ... ```
	cleaned = cleaned.replace(/^```(?:latex|tex)?\s*/i, '');
	cleaned = cleaned.replace(/\s*```$/, '');

	// If the model inadvertently generated documentclass or begin/end document, strip them
	cleaned = cleaned.replace(/\\documentclass(\[[^\]]*\])?\{[^}]+\}/g, '');
	cleaned = cleaned.replace(/\\usepackage(\[[^\]]*\])?\{[^}]+\}/g, '');
	cleaned = cleaned.replace(/\\geometry\{[^}]+\}/g, '');
	cleaned = cleaned.replace(/\\begin\{document\}/g, '');
	cleaned = cleaned.replace(/\\end\{document\}/g, '');

	return cleaned.trim();
}

/**
 * Assembles the complete LaTeX document string using the static preamble,
 * the cleaned body, and document tags.
 */
export function assembleLatexDocument(bodyContent: string): string {
	const cleanedBody = cleanLatexBody(bodyContent);

	return `${STATIC_PREAMBLE}

\\begin{document}

${cleanedBody}

\\end{document}
`;
}

