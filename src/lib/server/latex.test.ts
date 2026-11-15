import { describe, it, expect } from 'vitest';
import { cleanLatexBody, assembleLatexDocument, STATIC_PREAMBLE } from './latex';

describe('latex assembling and cleaning', () => {
	it('strips markdown code fences from model output', () => {
		const raw = `\`\`\`latex
\\section*{Cours — L'essentiel}
Contenu essentiel...
\`\`\``;
		const cleaned = cleanLatexBody(raw);
		expect(cleaned).not.toContain('```');
		expect(cleaned).toContain("\\section*{Cours — L'essentiel}");
	});

	it('strips redundant documentclass and document tags if accidentally generated', () => {
		const raw = `\\documentclass{article}
\\begin{document}
\\section*{Cours — L'essentiel}
Body
\\end{document}`;
		const cleaned = cleanLatexBody(raw);
		expect(cleaned).not.toContain('\\documentclass');
		expect(cleaned).not.toContain('\\begin{document}');
		expect(cleaned).not.toContain('\\end{document}');
		expect(cleaned).toContain("\\section*{Cours — L'essentiel}");
	});

	it('assembles the document with static preamble and environment wrappers', () => {
		const body = `\\section*{Cours — L'essentiel}
Texte.
\\section*{Exercices}
Exos.
\\section*{Test — Sujet type DS}
DS.
\\section*{Notes — Transparence}
Notes.`;

		const assembled = assembleLatexDocument(body);

		expect(assembled).toContain(STATIC_PREAMBLE);
		expect(assembled).toContain('\\begin{document}');
		expect(assembled).toContain('\\end{document}');
		expect(assembled).toContain('\\usepackage[french]{babel}');
		expect(assembled).toContain('\\geometry{margin=2.5cm}');
		expect(assembled).toContain("\\section*{Notes — Transparence}");
	});
});

