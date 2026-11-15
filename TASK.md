# Project Prompt: ENSA Agadir Study Résumé Generator

## Project Overview

Build a **minimal, single-purpose web application** for a student at **ENSA Agadir, Morocco**. The **interface is entirely in English**; all **AI-generated content is in French**. The app ingests three categories of academic documents, runs them through a Cloudflare Workers AI pipeline, and produces a downloadable **LaTeX (`.tex`) file** that serves as a structured "résumé" for exam preparation.

Stack: **SvelteKit + TailwindCSS + Iconify**, deployed on **Cloudflare Workers**. File storage uses **R2** (which also serves as the only cache). No KV, no D1, no Durable Objects.

---

## UI/UX Specification (Non-Negotiable)

The visual design is **barely minimal**, with no decorative elements. Treat this section as a hard constraint, not a suggestion.

- **Language:** **All UI text in English.**
- **Typography:** **Instrument Sans** exclusively. Load via `@fontsource-variable/instrument-sans` or Google Fonts. No secondary font. Set `fontFamily.sans` in Tailwind config to `['Instrument Sans', 'sans-serif']`.
- **Color:** **Grayscale only**. Use the Tailwind `neutral` scale (`neutral-50` backgrounds, `neutral-900` text, `neutral-200` hairlines). No accent colors. No contrasting colors.
- **Mode:** **Light mode only**. No dark mode toggle.
- **Prohibited:** No glow effects, no gradients, no drop shadows, no harsh borders. For separation, use hairline borders (`border` with `neutral-200`) or spacing alone.
- **Layout:** Generous whitespace, single primary column. Upload zones, thinking panel, and feedback area should feel quiet and uncluttered.
- **Icons:** Use **Iconify** sparingly—only where functionally necessary (upload, download, feedback, collapse). No decorative icons.

---

## File Upload & Management

The app accepts three distinct upload categories, visually separated and labeled.

| Category | Label (UI, English) | Purpose |
|---|---|---|
| Lessons | **Lessons** | Course documents (PDFs, DOCX, etc.) |
| TDs / TPs | **TDs / TPs** | Travaux dirigés and Travaux Pratiques |
| Other | **Other** | Teacher notices, older exams, DS, anything helpful but not fitting the first two |

**Upload flow:**

1. User enters a **Subject name** (free text, e.g., "Analyse Numérique").
2. User uploads files into the three zones. Multiple files per category, each with a remove (×) button.
3. On submit, the server derives a **subject slug** from the subject name (lowercase, accents stripped, spaces → hyphens). This slug is the R2 folder name.
4. Files are stored in R2 under:
   ```
   r2://enssa-resumes/<subject-slug>/uploads/<cours|tds|autres>/<filename>
   ```
5. Each file is converted to Markdown with **`env.AI.toMarkdown()`** and written to:
   ```
   r2://enssa-resumes/<subject-slug>/extracted/<cours|tds|autres>/<filename>.md
   ```

Do not send raw file bytes to any LLM. Only `toMarkdown` output ever reaches the reasoning stage.

---

## AI Processing Pipeline

Implement as an explicit, staged pipeline.

### Stage 1 — Extraction (no LLM reasoning)
For each uploaded file, call `env.AI.toMarkdown()` on the R2 object. Persist the resulting Markdown to `<subject-slug>/extracted/`. Associate each `.md` with its category label.

### Stage 2 — Reasoning & Generation (single reasoning-capable Workers AI call)
Load all extracted `.md` files for the subject, concatenate them with explicit category markers, and send them to a reasoning-capable model.

**Model:** **Kimi K2.6** (`@cf/moonshotai/kimi-k2.6`) or **DeepSeek V4.1 Flash** (`@cf/deepseek-ai/deepseek-v4.1-flash-1017`). Both expose a separate `reasoning` field alongside `content`. Use `stream: true`.

**Reasoning effort:**
- Initial generation: `reasoning_effort: "medium"`
- Feedback regeneration: `reasoning_effort: "low"` (smaller context, cheaper, faster)

**System prompt (pass verbatim):**

> You are generating a **résumé de révision** for an ENSA Agadir student preparing for exams. All content you produce must be in **French**. The UI language is irrelevant to you.
>
> Prioritize content that appears in **TDs, TPs, and Other** (exam notices, older DS). Lesson content is included only where it is **essential** to understand those exercises or where the TDs assume it.
>
> Be **honest and transparent**. If a file is illegible, contradictory, or missing, say so in the Notes section. Do not hallucinate exam details.
>
> The output must be **valid LaTeX body content** that will be inserted into a provided template. Do **not** include `\documentclass`, `\begin{document}`, or `\end{document}`.

**Stream handling:** The API returns reasoning tokens in a `reasoning` field and final output in `content`. Forward both to the client over a streaming response (SSE or chunked transfer), tagged so the frontend can route them to different panels.

### Stage 3 — Assembly
Wrap the model's LaTeX body in a **static preamble**:

```latex
\documentclass[11pt,a4paper]{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage[french]{babel}
\usepackage{amsmath,amssymb,amsthm}
\usepackage{geometry}
\geometry{margin=2.5cm}
\usepackage{enumitem}
\usepackage{hyperref}
```

Write the final `.tex` string to:
```
r2://enssa-resumes/<subject-slug>/output/resume.tex
```
Return it to the client as a downloadable file.

---

## LaTeX Output Structure (Contract)

The generated `.tex` file must contain **exactly these four sections**, in this order, using `\section*{}` (unnumbered):

### 1. `\section*{Cours — L'essentiel}`
- Bare essentials only.
- Every concept here must be justified by its appearance in the TDs/TPs or Other files. Omit lesson topics that never appear in exercises or notices.
- Include a `\subsection*{Conseils}` with tips derived from the documents—common pitfalls, teacher emphases, notation warnings.

### 2. `\section*{Exercices}`
- **4–5 exercises**, drawn from lesson examples, exercices d'application, DS (if in Other), and TD problems.
- Each exercise: clear statement plus a brief solution or method hint where appropriate.
- Do not invent exercises. If sources yield fewer than 4 distinct exercises, say so in Notes and include what exists.

### 3. `\section*{Test — Sujet type DS}`
- A **sample DS** for practice, synthesized from TD patterns and any older DS in Other.
- If no older DS exists, label it in Notes as *"sujet construit à partir des TDs"*.
- Include 2–3 problems with point allocations if the source material suggests a format.

### 4. `\section*{Notes — Transparence}`
- **Mandatory, even if empty.**
- State exactly what was missing, ambiguous, or contradictory in the source files.
- Disclose any assumptions (e.g., "durée du DS non spécifiée, supposée 2h").
- Note any file that could not be parsed well.

---

## Thinking Process Panel

Below the "Generate" button, render a **collapsible panel** labeled **"Thinking"**.

- **Styling:** Grayscale only, `text-sm`, `neutral-500`, hairline top border. Collapsed by default with a small chevron icon (Iconify).
- **Content:** Stream `reasoning` tokens into it in real time as the model works.
- **Behavior:** The final `.tex` download button appears only when `content` streaming completes. The thinking panel remains visible for inspection but is never part of the output.
- **Fallback:** If the chosen model returns reasoning inline in `content` (some providers differ), still display it—do not block the download.

---

## File Caching Strategy (R2 Folder-per-Subject)

**No KV, no TTL, no hash tables.** The R2 folder structure *is* the cache.

```
r2://enssa-resumes/<subject-slug>/
├── uploads/
│   ├── cours/<filename>
│   ├── tds/<filename>
│   └── autres/<filename>
├── extracted/
│   ├── cours/<filename>.md
│   ├── tds/<filename>.md
│   └── autres/<filename>.md
└── output/
    └── resume.tex
```

**Behavior:**

- **Detect prior run:** On subject entry, call `bucket.list({ prefix: "<subject-slug>/" })`. If `extracted/*.md` exists, skip Stage 1 and reuse. If `output/resume.tex` exists, offer immediate download.
- **Re-upload for same subject:** Version the folder with a timestamp suffix (`<subject-slug>-20261115-1430`) to preserve history. Simpler than mutation and fully inspectable in the R2 dashboard.
- **Feedback regeneration:** Load `extracted/*.md`, re-run **Stage 2 and Stage 3 only**, write a new `output/resume-v2.tex` (versioned filename). Never re-extract on feedback.

---

## Feedback & Iteration

Below the download button, include a feedback section:

- Single multiline textarea, placeholder: *"Describe what you want changed (e.g., add an exercise on matrices, shorten the Lessons section)…"*
- **"Regenerate"** button.
- On submit, re-run Stage 2 and Stage 3 with the user's feedback injected as an additional user message, alongside the previously extracted Markdown. Do **not** re-upload or re-extract.
- Reasoning effort drops to `low` for regenerations.

---

## Tech Stack & Deployment

- **Framework:** SvelteKit with `@sveltejs/adapter-cloudflare`.
- **Styling:** TailwindCSS. `fontFamily.sans` set to Instrument Sans.
- **Icons:** `@iconify/svelte`.
- **Cloudflare bindings** in `wrangler.jsonc`:
  ```jsonc
  {
    "ai": { "binding": "AI" },
    "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "enssa-resumes" }]
  }
  ```
- Access via `platform.env.AI` and `platform.env.BUCKET` in SvelteKit server routes. Never expose these to the client.
- **Streaming:** Use a SvelteKit `+server.ts` endpoint that returns a `ReadableStream`, forwarding Workers AI chunks tagged as either `reasoning` or `content`.

---

## What Success Looks Like

A student opens the app, enters a subject name, uploads their files into the three labeled zones, and clicks **"Generate"**. They watch the Thinking panel populate in real time as the model reasons. When the LaTeX body finishes streaming, a **Download `.tex`** button appears. The resulting file's content is *demonstrably grounded in their actual course materials*—not a generic summary. The Notes section is honest. Feedback regenerates quickly from cached Markdown without touching the original uploads. The interface is quiet, grayscale, English, and typographically consistent.

---

## Why This Version Works

| Concern | How it's addressed |
|---|---|
| **UI English / Output French** | Explicitly separated: UI strings are English and never passed to the model; the system prompt instructs French output for the résumé body only. |
| **Caching without KV** | R2 folder-per-subject. The folder *is* the cache. Inspectable in the R2 dashboard, no extra binding, no TTL management. |
| **Thinking visibility** | Reasoning-capable model (Kimi K2.6 / DeepSeek V4.1 Flash) returns `reasoning` and `content` in separate fields; streamed to a collapsible grayscale panel. |
| **LaTeX ambiguity** | Four-section contract with unnumbered headings, body-only output, static preamble supplied by the app. |
| **Language contamination risk** | UI strings kept in a separate `const strings = { ... }` object; never injected into the model prompt. |
| **Reasoning token burn** | `reasoning_effort: medium` for generation, `low` for feedback regeneration. |
| **Silent failures** | Notes section is mandatory and must disclose missing files, contradictions, and assumptions. |