import { describe, it, expect } from 'vitest';
import { toSubjectSlug, toTimestampedSlug, getNextOutputFilename } from './slug';

describe('slug utilities', () => {
	it('converts subject names to normalized slugs', () => {
		expect(toSubjectSlug('Analyse Numérique')).toBe('analyse-numerique');
		expect(toSubjectSlug('Algèbre & Géométrie Spatiale')).toBe('algebre-geometrie-spatiale');
		expect(toSubjectSlug('Électronique Analogique II')).toBe('electronique-analogique-ii');
		expect(toSubjectSlug('  Théorie des Graphes  ')).toBe('theorie-des-graphes');
		expect(toSubjectSlug('')).toBe('unnamed-subject');
	});

	it('creates timestamped version slugs', () => {
		const fixedDate = new Date('2026-11-15T14:30:00Z');
		const result = toTimestampedSlug('analyse-numerique', fixedDate);
		expect(result).toBe('analyse-numerique-20261115-1430');
	});

	it('computes the next versioned output filename', () => {
		expect(getNextOutputFilename([])).toBe('resume.tex');
		expect(getNextOutputFilename(['other.txt'])).toBe('resume.tex');
		expect(getNextOutputFilename(['resume.tex'])).toBe('resume-v2.tex');
		expect(getNextOutputFilename(['resume.tex', 'resume-v2.tex'])).toBe('resume-v3.tex');
		expect(getNextOutputFilename(['resume.tex', 'resume-v2.tex', 'resume-v5.tex'])).toBe('resume-v6.tex');
	});
});

