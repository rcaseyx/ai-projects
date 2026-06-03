// track.mjs — manage job application status
import fs from "fs";
import path from "path";
import { createInterface } from "readline/promises";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATUS_FILE = path.join(__dirname, "status.json");

const STAGES = [
  "applied",
  "recruiter_screen",
  "hm_screen",
  "technical",
  "onsite",
  "offer",
  "rejected",
  "ghosted",
  "withdrew",
];

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

function load() {
  if (!fs.existsSync(STATUS_FILE)) return [];
  return JSON.parse(fs.readFileSync(STATUS_FILE, "utf-8"));
}

function save(apps) {
  fs.writeFileSync(STATUS_FILE, JSON.stringify(apps, null, 2) + "\n");
}

function daysSince(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr)) / 86_400_000);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function printTable(apps) {
  if (!apps.length) {
    console.log("  No applications tracked yet.\n");
    return;
  }
  console.log();
  apps.forEach((app, i) => {
    const days = daysSince(app.last_activity);
    const stale = ACTIVE_STAGES.has(app.stage) && days >= GHOST_DAYS;
    const flag = stale ? "  ⚠ stale" : "";
    const label = STAGE_LABELS[app.stage] || app.stage;
    const co = app.company.slice(0, 14).padEnd(14);
    const role = app.role.slice(0, 36).padEnd(36);
    const stage = label.padEnd(18);
    console.log(`  ${String(i + 1).padStart(2)}. ${co}  ${role}  ${stage}  ${days}d${flag}`);
    if (app.notes) {
      console.log(`      ${app.notes.slice(0, 70)}`);
    }
  });
  console.log();
}

async function pickStage(rl, current) {
  console.log();
  STAGES.forEach((s, i) => {
    const mark = s === current ? " ←" : "";
    console.log(`  ${String(i + 1).padStart(2)}. ${STAGE_LABELS[s]}${mark}`);
  });
  console.log();
  const ans = await rl.question("New stage: ");
  const idx = parseInt(ans.trim()) - 1;
  return (isNaN(idx) || idx < 0 || idx >= STAGES.length) ? null : STAGES[idx];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const apps = load();
console.log(`\nApplication tracker — ${apps.length} application${apps.length !== 1 ? "s" : ""}`);
printTable(apps);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const action = await rl.question("Pick a number to update, (a)dd new, or (q)uit: ");
const cmd = action.trim().toLowerCase();

if (!cmd || cmd === "q") {
  rl.close();
  process.exit(0);
}

// ─── Add ──────────────────────────────────────────────────────────────────────

if (cmd === "a") {
  const company  = (await rl.question("Company: ")).trim();
  const role     = (await rl.question("Role: ")).trim();
  const url      = (await rl.question("URL (optional): ")).trim();
  const dateIn   = (await rl.question(`Date applied (YYYY-MM-DD, enter for today): `)).trim();
  const applied  = dateIn || today();

  apps.push({ company, role, url, applied, stage: "applied", last_activity: applied, notes: "" });
  save(apps);
  console.log(`\nAdded: ${role} @ ${company} (${applied})\n`);
  rl.close();
  process.exit(0);
}

// ─── Update ───────────────────────────────────────────────────────────────────

const idx = parseInt(cmd) - 1;
if (isNaN(idx) || idx < 0 || idx >= apps.length) {
  console.error("Invalid selection.");
  rl.close();
  process.exit(1);
}

const app = apps[idx];
console.log(`\n${app.role} @ ${app.company}`);
console.log(`Current stage: ${STAGE_LABELS[app.stage]}  (${daysSince(app.last_activity)}d ago)`);
if (app.notes) console.log(`Notes: ${app.notes}`);

const newStage = await pickStage(rl, app.stage);
if (!newStage) {
  console.log("No change.");
  rl.close();
  process.exit(0);
}

const notes = (await rl.question("Notes (optional, enter to keep current): ")).trim();
app.stage = newStage;
app.last_activity = today();
if (notes) app.notes = notes;

save(apps);
console.log(`\nUpdated: ${app.role} @ ${app.company} → ${STAGE_LABELS[newStage]}\n`);
rl.close();
