# apply-agent — Claude working instructions

## What this is

A multi-agent pipeline that takes a job posting and produces a full application package: tailored resume, candidate review, interview prep guide, and study plan. A separate interactive mock interview mode is available once the package is generated.

## Usage

```bash
# Discover matching jobs and pipe into apply pipeline
node find.mjs

# Full pipeline — paste a job posting interactively
node apply.mjs

# Full pipeline — pass a job posting file
node apply.mjs path/to/job-posting.txt

# Interactive mock interview (after running apply.mjs)
node interview.mjs jobs/<slug>

# Track application status (add, update stage, view in-flight)
node track.mjs
```

`find.mjs` polls Greenhouse boards for the watchlist companies and Adzuna for broader discovery, filters by role/seniority/location, scores by stack match, and lets you pick one to run through the full apply pipeline.

`track.mjs` manages application status. State is stored in `status.json` (committed, not gitignored). Stages: `applied → recruiter_screen → hm_screen → technical → onsite → offer / rejected / ghosted / withdrew`. Applications with no activity for 21+ days are flagged as stale.

`digest.mjs` runs the same logic non-interactively and emails the top 3 matches via Resend. Triggered automatically by `.github/workflows/job-digest.yml` every Mon/Wed/Fri at 10am EST. Requires `RESEND_API_KEY` set as a GitHub secret (resend.com → API Keys). To test locally: `RESEND_API_KEY=your_key node digest.mjs`.

Outputs are saved to `jobs/<company-role-slug>/`:
- `job-posting.txt` — original posting
- `tailored-resume.txt` — resume rewritten for this role
- `candidate-review.md` — strengths, gaps, likely questions, reframe notes
- `interview-prep.md` — targeted Q&A study guide
- `study-plan.md` — LeetCode topics, system design, resources
- `interview-notes.md` — appended after each mock interview session

## Resume sync

The portfolio site at `~/projects/rcaseyx.dev/app/resume/page.tsx` is the source-of-truth web resume. **When updating `resume.txt` with canonical changes** (not job-specific tailoring), also update the corresponding arrays in `resume/page.tsx`.

Do not sync tailored resumes to the portfolio.
