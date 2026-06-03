import dotenv from "dotenv";
dotenv.config({ override: true });
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { createInterface } from "readline/promises";
import { fileURLToPath } from "url";

const client = new Anthropic();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_RESUME = fs.readFileSync(path.join(__dirname, "resume.txt"), "utf-8");

// ─── Input ─────────────────────────────────────────────────────────────────────

async function getJobPosting() {
  if (process.argv[2]) {
    return fs.readFileSync(process.argv[2], "utf-8");
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log("Paste the job posting. Type END on its own line when done:\n");
  const lines = [];
  for await (const line of rl) {
    if (line.trim() === "END") {
      rl.close();
      break;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

// ─── Derive job folder slug ────────────────────────────────────────────────────

async function deriveSlug(jobPosting) {
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 50,
    messages: [
      {
        role: "user",
        content: `Extract the company name and job title from this posting and return ONLY a lowercase kebab-case slug in the format "company-job-title". No explanation, no punctuation other than hyphens. Examples: "stripe-senior-frontend-engineer", "netflix-staff-software-engineer".

Job posting:
${jobPosting.slice(0, 1500)}`,
      },
    ],
  });
  return response.content[0].text.trim().replace(/[^a-z0-9-]/g, "");
}

// ─── Agent 1: Resume Tailor ────────────────────────────────────────────────────

async function tailorResume(jobPosting) {
  process.stdout.write("Tailoring resume...");
  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 4000,
    system: `You are an expert resume writer who tailors resumes to specific job postings.

Rules:
- Never fabricate experience, skills, or credentials not in the original resume
- Reorder bullets to lead with the most relevant work for this specific role
- Rephrase bullets to echo the job description's language — only when it's accurate
- Emphasize what this role clearly values; de-emphasize what it doesn't
- Keep the same structure and formatting as the original
- Output the tailored resume as plain text only, no commentary`,
    messages: [
      {
        role: "user",
        content: `ORIGINAL RESUME:\n${BASE_RESUME}\n\n---\n\nJOB POSTING:\n${jobPosting}`,
      },
    ],
  });
  console.log(" done.");
  return response.content[0].text;
}

// ─── Agent 2: Candidate Review ─────────────────────────────────────────────────

async function candidateReview(tailoredResume, jobPosting) {
  process.stdout.write("Writing candidate review...");
  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 3000,
    system: `You are a senior hiring manager doing a cold read of a candidate's resume against a job description. Be direct and honest — your job is to give the candidate an accurate picture, not encouragement. Today's date is ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.`,
    messages: [
      {
        role: "user",
        content: `Review this candidate's fit for the role. Return a markdown document with these sections:

## Where they fit
Bullet list of specific resume items that directly map to job requirements. Be concrete — quote both sides.

## Where they fall short
Honest gaps: missing skills, wrong experience surface, weak signals where the JD expects strong ones. If a gap is likely fatal, say so.

## Questions likely to come up
5-7 specific interview questions this resume will generate, based on gaps or claims that need defense.

## Reframe notes
How the candidate should position their experience to cover the gaps — not spin, just the most favorable accurate framing.

---

RESUME:
${tailoredResume}

JOB POSTING:
${jobPosting}`,
      },
    ],
  });
  console.log(" done.");
  return response.content[0].text;
}

// ─── Agent 3: Interview Prep ───────────────────────────────────────────────────

async function interviewPrep(tailoredResume, jobPosting, review) {
  process.stdout.write("Generating interview prep questions...");
  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 4000,
    system: `You are a senior technical recruiter who has interviewed hundreds of candidates for this type of role. Generate a targeted study guide — not generic tips, but questions and answers specific to this candidate and this role.`,
    messages: [
      {
        role: "user",
        content: `Generate an interview prep guide for this candidate applying to this role. For each question, include:
- The question itself
- What the interviewer is actually probing for
- Specific guidance on how THIS candidate should answer it, given their resume

Cover: 4-5 technical questions, 3-4 behavioral questions, 2-3 role/company-specific questions. Format as markdown.

RESUME:
${tailoredResume}

JOB POSTING:
${jobPosting}

CANDIDATE REVIEW (gaps and strengths already identified):
${review}`,
      },
    ],
  });
  console.log(" done.");
  return response.content[0].text;
}

// ─── Agent 4: Study Plan ────────────────────────────────────────────────────────

async function studyPlan(jobPosting, review) {
  process.stdout.write("Building study plan...");
  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 3000,
    system: `You are a senior engineer who coaches candidates through technical interview prep. You give specific, actionable recommendations — not vague topic lists.`,
    messages: [
      {
        role: "user",
        content: `Based on this job posting and candidate review, create a targeted study plan. Include:

## Core concepts to review
Topics this role will almost certainly test, with a 1-2 sentence explanation of what depth is expected.

## LeetCode / coding problems
Specific problem titles or patterns (e.g. "sliding window", "LRU cache", "merge intervals") relevant to this role. For frontend/UI roles, include browser/JS-specific topics too. Rate each: High / Medium priority.

## System design topics
If the role involves design interviews, list specific system design patterns or example problems to prep. Skip if clearly not applicable.

## Resources
3-5 specific, high-quality links or resource names (books, docs, videos) matched to the gaps in this candidate review.

JOB POSTING:
${jobPosting}

CANDIDATE REVIEW:
${review}`,
      },
    ],
  });
  console.log(" done.");
  return response.content[0].text;
}

// ─── Save outputs ───────────────────────────────────────────────────────────────

function saveOutputs(slug, jobPosting, tailored, review, prep, study) {
  const dir = path.join(__dirname, "jobs", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "job-posting.txt"), jobPosting);
  fs.writeFileSync(path.join(dir, "tailored-resume.txt"), tailored);
  fs.writeFileSync(path.join(dir, "candidate-review.md"), review);
  fs.writeFileSync(path.join(dir, "interview-prep.md"), prep);
  fs.writeFileSync(path.join(dir, "study-plan.md"), study);
  return dir;
}

// ─── Main ───────────────────────────────────────────────────────────────────────

const jobPosting = await getJobPosting();
if (!jobPosting.trim()) {
  console.error("No job posting provided.");
  process.exit(1);
}

console.log("");

const [slug, tailored] = await Promise.all([
  deriveSlug(jobPosting),
  tailorResume(jobPosting),
]);

const review = await candidateReview(tailored, jobPosting);

const [prep, study] = await Promise.all([
  interviewPrep(tailored, jobPosting, review),
  studyPlan(jobPosting, review),
]);

const dir = saveOutputs(slug, jobPosting, tailored, review, prep, study);

console.log(`\nAll outputs saved to jobs/${slug}/`);
console.log(`  tailored-resume.txt`);
console.log(`  candidate-review.md`);
console.log(`  interview-prep.md`);
console.log(`  study-plan.md`);
console.log(`\nTo run a mock interview:  node interview.mjs jobs/${slug}/job-posting.txt`);
