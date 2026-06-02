// find.mjs — discover matching job postings and pipe into apply pipeline
import dotenv from "dotenv";
dotenv.config({ override: true });
import fs from "fs";
import os from "os";
import path from "path";
import { createInterface } from "readline/promises";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID;
const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY;

if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) {
  console.error("Missing ADZUNA_APP_ID or ADZUNA_APP_KEY — copy .env.example to .env and fill in values.");
  process.exit(1);
}

const STACK = [
  "typescript", "javascript", "react", "next.js", "nextjs", "node.js", "nodejs",
  "node", "php", "graphql", "css", "less", "sass", "scss", "jest",
  "contentful", "optimizely", "a/b test", "accessibility", "wcag",
];

// Confirmed on Greenhouse: Anthropic, Stripe, Reddit, Vercel, Figma
// Others (Netflix, NVIDIA, Adobe, GitHub, Slack, Apple) use Workday/own systems —
// fetchGreenhouse returns [] on 404 so they fail silently; Adzuna covers them.
const WATCHLIST = [
  { name: "Anthropic", slug: "anthropic" },
  { name: "Stripe",    slug: "stripe" },
  { name: "Reddit",    slug: "reddit" },
  { name: "Vercel",    slug: "vercel" },
  { name: "Figma",     slug: "figma" },
  { name: "Netflix",   slug: "netflix" },
  { name: "NVIDIA",    slug: "nvidia" },
  { name: "Adobe",     slug: "adobe" },
  { name: "GitHub",    slug: "github" },
  { name: "Slack",     slug: "slack" },
  { name: "Apple",     slug: "apple" },
];

const WATCHLIST_NAMES = new Set(WATCHLIST.map(c => c.name.toLowerCase()));

const TITLE_RE    = /frontend|front.end|ui engineer|ui developer|fullstack|full.stack|software engineer|software developer/i;
const EXCLUDE_RE  = /\bmanager\b|\bdirector\b|\bvp\b|\bhead of\b|\brecruit/i;
const SENIOR_RE   = /\b(senior|sr\.?|staff|principal|lead)\b/i;
const LOCATION_RE = /remote|work from home|wfh|distributed|anywhere|worldwide|atlanta|hybrid/i;
const NON_US_RE   = /\b(uk|united kingdom|london|england|ireland|dublin|germany|berlin|canada|toronto|australia|sydney|europe|emea)\b/i;

function stripHtml(html = "") {
  return html.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
}

function stackScore(body) {
  const lower = body.toLowerCase();
  return STACK.filter(k => lower.includes(k)).length;
}

function passes(title, location, body) {
  if (!TITLE_RE.test(title)) return false;
  if (EXCLUDE_RE.test(title)) return false;
  if (NON_US_RE.test(location)) return false;
  if (!SENIOR_RE.test(title + " " + body.slice(0, 600))) return false;
  if (!LOCATION_RE.test(location + " " + body.slice(0, 2000))) return false;
  return true;
}

async function fetchGreenhouse(company) {
  try {
    const r = await fetch(
      `https://boards-api.greenhouse.io/v1/boards/${company.slug}/jobs?content=true`
    );
    if (!r.ok) return [];
    const data = await r.json();
    return (data.jobs || []).map(j => ({
      id: `gh:${j.id}`,
      title: j.title,
      company: company.name,
      location: j.location?.name || "",
      url: j.absolute_url,
      body: stripHtml(j.content || ""),
      source: "watchlist",
    }));
  } catch { return []; }
}

async function fetchAdzuna(what) {
  try {
    const params = new URLSearchParams({
      app_id: ADZUNA_APP_ID,
      app_key: ADZUNA_APP_KEY,
      what,
      results_per_page: "50",
      full_time: "1",
    });
    const r = await fetch(`https://api.adzuna.com/v1/api/jobs/us/search/1?${params}`);
    if (!r.ok) return [];
    const data = await r.json();
    return (data.results || []).map(j => ({
      id: `az:${j.id}`,
      title: j.title,
      company: j.company?.display_name || "Unknown",
      location: j.location?.display_name || "",
      url: j.redirect_url,
      body: j.description || "",
      source: "adzuna",
    }));
  } catch { return []; }
}

// ─── Fetch ──────────────────────────────────────────────────────────────────

process.stdout.write("Polling watchlist...");
const watchlistRaw = (await Promise.all(WATCHLIST.map(fetchGreenhouse))).flat();
console.log(` ${watchlistRaw.length} jobs.`);

process.stdout.write("Querying Adzuna...");
const [az1, az2, az3] = await Promise.all([
  fetchAdzuna("senior frontend engineer"),
  fetchAdzuna("senior software engineer remote"),
  fetchAdzuna("senior ui engineer react typescript"),
]);
const adzunaRaw = [...az1, ...az2, ...az3].filter(
  j => !WATCHLIST_NAMES.has(j.company.toLowerCase())
);
console.log(` ${adzunaRaw.length} jobs.\n`);

// ─── Deduplicate + filter + score ───────────────────────────────────────────

const seenUrl = new Set();
const seenTitleCo = new Set();
const matches = [...watchlistRaw, ...adzunaRaw]
  .filter(j => {
    if (!j.url || seenUrl.has(j.url)) return false;
    const titleCoKey = `${j.company.toLowerCase()}:${j.title.toLowerCase()}`;
    if (seenTitleCo.has(titleCoKey)) return false;
    seenUrl.add(j.url);
    seenTitleCo.add(titleCoKey);
    return true;
  })
  .filter(j => passes(j.title, j.location, j.body))
  .map(j => ({ ...j, score: stackScore(j.body) }))
  .sort((a, b) => {
    if (a.source !== b.source) return a.source === "watchlist" ? -1 : 1;
    return b.score - a.score;
  });

if (!matches.length) {
  console.log("No matching jobs found.");
  process.exit(0);
}

// ─── Display ────────────────────────────────────────────────────────────────

console.log(`${matches.length} match${matches.length === 1 ? "" : "es"} found:\n`);

let lastSource = null;
matches.forEach((j, i) => {
  if (j.source !== lastSource) {
    lastSource = j.source;
    if (i > 0) console.log();
    console.log(j.source === "watchlist" ? "── WATCHLIST ──" : "── ADZUNA ─────");
  }
  const bar = "█".repeat(Math.min(j.score, 5)).padEnd(5, "░");
  const company = j.company.slice(0, 12).padEnd(12);
  const loc = (j.location || "location unspecified").slice(0, 35);
  console.log(`  ${String(i + 1).padStart(2)}. [${company}]  ${j.title}`);
  console.log(`      ${loc}  ${bar}  ${j.url}`);
});

console.log();

// ─── Pick + pipe to apply.mjs ───────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stdout });
const pick = await rl.question("Pick a number to run through apply pipeline (q to quit): ");
rl.close();

if (!pick.trim() || pick.trim().toLowerCase() === "q") process.exit(0);

const idx = parseInt(pick.trim()) - 1;
if (isNaN(idx) || idx < 0 || idx >= matches.length) {
  console.error("Invalid selection.");
  process.exit(1);
}

const job = matches[idx];
console.log(`\n→ ${job.title} @ ${job.company}\n`);

const tmp = path.join(os.tmpdir(), `find_job_${Date.now()}.txt`);
fs.writeFileSync(tmp, [job.title, job.company, job.url, "", job.body].join("\n"));

const result = spawnSync("node", [path.join(__dirname, "apply.mjs"), tmp], {
  cwd: __dirname,
  stdio: "inherit",
});

fs.unlinkSync(tmp);
process.exit(result.status ?? 0);
