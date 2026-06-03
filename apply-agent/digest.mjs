// digest.mjs — fetch top 3 job matches and email them via Resend
import dotenv from "dotenv";
dotenv.config({ override: true });
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Resend } from "resend";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID;
const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY;
const TO_EMAIL = "rcaseyx@gmail.com";

if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) {
  console.error("Missing ADZUNA_APP_ID or ADZUNA_APP_KEY — check .env or GitHub secrets.");
  process.exit(1);
}
const FROM_EMAIL = "onboarding@resend.dev"; // swap for verified domain if you add one

const STACK = [
  "typescript", "javascript", "react", "next.js", "nextjs", "node.js", "nodejs",
  "node", "php", "graphql", "css", "less", "sass", "scss", "jest",
  "contentful", "optimizely", "a/b test", "accessibility", "wcag",
];

const WATCHLIST = [
  { name: "Anthropic", slug: "anthropic" },
  { name: "Stripe",    slug: "stripe" },
  { name: "Reddit",    slug: "reddit" },
  { name: "Vercel",    slug: "vercel" },
  { name: "Figma",     slug: "figma" },
  { name: "Airbnb",    slug: "airbnb" },
  { name: "Calendly",  slug: "calendly" },
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
      app_id: ADZUNA_APP_ID, app_key: ADZUNA_APP_KEY,
      what, results_per_page: "50", full_time: "1",
    });
    const r = await fetch(`https://api.adzuna.com/v1/api/jobs/us/search/1?${params}`);
    if (!r.ok) return [];
    const data = await r.json();
    return (data.results || []).map(j => ({
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

const [watchlistRaw, az1, az2, az3] = await Promise.all([
  Promise.all(WATCHLIST.map(fetchGreenhouse)).then(r => r.flat()),
  fetchAdzuna("senior frontend engineer"),
  fetchAdzuna("senior software engineer remote"),
  fetchAdzuna("senior ui engineer react typescript"),
]);

const adzunaRaw = [...az1, ...az2, ...az3].filter(
  j => !WATCHLIST_NAMES.has(j.company.toLowerCase())
);

// ─── Deduplicate + filter + rank ────────────────────────────────────────────

const seenUrl = new Set();
const seenTitleCo = new Set();
const top3 = [...watchlistRaw, ...adzunaRaw]
  .filter(j => {
    if (!j.url || seenUrl.has(j.url)) return false;
    const key = `${j.company.toLowerCase()}:${j.title.toLowerCase()}`;
    if (seenTitleCo.has(key)) return false;
    seenUrl.add(j.url);
    seenTitleCo.add(key);
    return true;
  })
  .filter(j => passes(j.title, j.location, j.body))
  .map(j => ({ ...j, score: stackScore(j.body) }))
  .sort((a, b) => {
    if (a.source !== b.source) return a.source === "watchlist" ? -1 : 1;
    return b.score - a.score;
  })
  .slice(0, 3);

if (!top3.length) {
  console.log("No matches found — skipping email.");
  process.exit(0);
}

// ─── In-flight applications ──────────────────────────────────────────────────

const STAGE_LABELS = {
  applied:          "Applied",
  recruiter_screen: "Recruiter screen",
  hm_screen:        "HM screen",
  technical:        "Technical",
  onsite:           "Onsite",
  offer:            "Offer",
  rejected:         "Rejected",
  ghosted:          "Ghosted",
  withdrew:         "Withdrew",
};

const ACTIVE_STAGES = new Set(["applied", "recruiter_screen", "hm_screen", "technical", "onsite"]);
const GHOST_DAYS = 21;

function daysSince(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr)) / 86_400_000);
}

const statusFile = path.join(__dirname, "status.json");
const inFlight = fs.existsSync(statusFile)
  ? JSON.parse(fs.readFileSync(statusFile, "utf-8")).filter(a => ACTIVE_STAGES.has(a.stage))
  : [];

// ─── Build email ─────────────────────────────────────────────────────────────

const dateLabel = new Date().toLocaleDateString("en-US", {
  weekday: "long", month: "long", day: "numeric",
});

const scoreBar = score =>
  "█".repeat(Math.min(score, 5)) + "░".repeat(Math.max(0, 5 - score));

const cardHtml = (job, i) => `
  <div style="border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin:12px 0;background:#fff;">
    <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:#6b7280;letter-spacing:.05em;margin-bottom:6px;">
      ${i + 1} of ${top3.length} &nbsp;·&nbsp; ${job.source === "watchlist" ? "WATCHLIST" : "ADZUNA"}
    </div>
    <div style="font-size:17px;font-weight:600;color:#111827;margin-bottom:4px;">${job.title}</div>
    <div style="color:#374151;margin-bottom:8px;">${job.company} &nbsp;·&nbsp; ${job.location || "location unspecified"}</div>
    <div style="font-family:monospace;font-size:13px;color:#374151;margin-bottom:12px;">
      Stack match: ${scoreBar(job.score)} (${job.score} keyword${job.score !== 1 ? "s" : ""})
    </div>
    <a href="${job.url}" style="color:#2563eb;font-weight:500;text-decoration:none;">View posting →</a>
  </div>`;

const inFlightHtml = inFlight.length ? `
  <div style="margin-bottom:32px;">
    <h3 style="font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin:0 0 12px;">In flight</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      ${inFlight.map(app => {
        const days = daysSince(app.last_activity);
        const stale = days >= GHOST_DAYS;
        const staleStyle = stale ? "color:#ef4444;" : "color:#6b7280;";
        return `<tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:8px 0;font-weight:500;color:#111827;">${app.company}</td>
          <td style="padding:8px 4px;color:#374151;">${app.role}</td>
          <td style="padding:8px 0;white-space:nowrap;color:#374151;">${STAGE_LABELS[app.stage] || app.stage}</td>
          <td style="padding:8px 0 8px 8px;white-space:nowrap;${staleStyle}">${days}d${stale ? " ⚠" : ""}</td>
        </tr>`;
      }).join("")}
    </table>
  </div>` : "";

const html = `
<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;padding:32px 16px;margin:0;">
  <div style="max-width:560px;margin:0 auto;">
    <h2 style="font-size:20px;font-weight:700;color:#111827;margin:0 0 4px;">Job digest</h2>
    <p style="color:#6b7280;margin:0 0 24px;">${dateLabel}</p>
    ${inFlightHtml}
    <h3 style="font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin:0 0 12px;">New picks</h3>
    <p style="color:#6b7280;font-size:13px;margin:0 0 12px;">${top3.length} picks from ${watchlistRaw.length + adzunaRaw.length} total matches</p>
    ${top3.map(cardHtml).join("")}
    <p style="color:#9ca3af;font-size:12px;margin-top:24px;">
      Run <code style="background:#f3f4f6;padding:2px 5px;border-radius:3px;">node find.mjs</code> to see all matches and pipe one into the apply pipeline.
      Run <code style="background:#f3f4f6;padding:2px 5px;border-radius:3px;">node track.mjs</code> to update application status.
    </p>
  </div>
</body>
</html>`;

// ─── Send ─────────────────────────────────────────────────────────────────────

const resend = new Resend(process.env.RESEND_API_KEY);
const { data, error } = await resend.emails.send({
  from: FROM_EMAIL,
  to: TO_EMAIL,
  subject: `Top job matches — ${dateLabel}`,
  html,
});

if (error) {
  console.error("Email failed:", error);
  process.exit(1);
}

console.log(`Digest sent to ${TO_EMAIL} (id: ${data.id})`);
console.log(`Top picks: ${top3.map(j => `${j.title} @ ${j.company}`).join(" | ")}`);
