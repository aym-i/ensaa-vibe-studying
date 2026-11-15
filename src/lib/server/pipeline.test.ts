import { describe, it, expect } from 'vitest';
import {
	SYSTEM_PROMPT,
	LATEX_STRUCTURE_CONTRACT,
	buildPromptFromDocuments
} from './pipeline';
import type { ExtractedDocument } from './r2';

describe('pipeline prompts and document builder', () => {
	it('system prompt matches verbatim specification', () => {
		expect(SYSTEM_PROMPT).toContain('ENSA Agadir student preparing for exams');
		expect(SYSTEM_PROMPT).toContain('All content you produce must be in **French**');
		expect(SYSTEM_PROMPT).toContain('Prioritize content that appears in **TDs, TPs, and Other**');
		expect(SYSTEM_PROMPT).toContain('Be **honest and transparent**');
		expect(SYSTEM_PROMPT).toContain(
			'Do **not** include `\\documentclass`, `\\begin{document}`, or `\\end{document}`'
		);
	});

	it('contract mandates the four unnumbered sections', () => {
		expect(LATEX_STRUCTURE_CONTRACT).toContain('\\section*{Cours — L\'essentiel}');
		expect(LATEX_STRUCTURE_CONTRACT).toContain('\\subsection*{Conseils}');
		expect(LATEX_STRUCTURE_CONTRACT).toContain('\\section*{Exercices}');
		expect(LATEX_STRUCTURE_CONTRACT).toContain('\\section*{Test — Sujet type DS}');
		expect(LATEX_STRUCTURE_CONTRACT).toContain('\\section*{Notes — Transparence}');
	});

	it('formats documents with category markers', () => {
		const sampleDocs: ExtractedDocument[] = [
			{
				category: 'cours',
				filename: 'chapitre1.pdf',
				markdown: '# Introduction aux équations'
			},
			{
				category: 'tds',
				filename: 'td1.pdf',
				markdown: '# Exercice 1: Dérivation'
			},
			{
				category: 'autres',
				filename: 'ds_2023.pdf',
				markdown: '# Examen Final 2023'
			}
		];

		const built = buildPromptFromDocuments('Analyse 1', sampleDocs);
		expect(built).toContain('# Sujet de Révision: Analyse 1');
		expect(built).toContain('=== CATEGORIE: Lessons (Cours) | FICHIER: chapitre1.pdf ===');
		expect(built).toContain('=== CATEGORIE: TDs / TPs (Travaux Dirigés / Pratiques) | FICHIER: td1.pdf ===');
		expect(built).toContain('=== CATEGORIE: Other (Exam notices, older DS, teacher instructions) | FICHIER: ds_2023.pdf ===');
	});
});

