# apply-agent — Claude working instructions

## What this is

A multi-agent pipeline that takes a job posting and produces a full application package: tailored resume, candidate review, interview prep guide, and study plan. A separate interactive mock interview mode is available once the package is generated.

## Usage

```bash
# Full pipeline — paste a job posting interactively
node apply.mjs

# Full pipeline — pass a job posting file
node apply.mjs path/to/job-posting.txt

# Interactive mock interview (after running apply.mjs)
node interview.mjs jobs/<slug>
```

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
