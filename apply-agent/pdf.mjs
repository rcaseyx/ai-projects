// pdf.mjs — generate a styled PDF from a tailored resume using the rcaseyx.dev layout
import dotenv from "dotenv";
dotenv.config({ override: true });
import Anthropic from "@anthropic-ai/sdk";
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.resolve(__dirname, "../../rcaseyx.dev");
const OVERRIDE_FILE = path.join(SITE_DIR, "resume-override.json");
const DEV_URL = "http://localhost:3000/resume";

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: node pdf.mjs <job-slug>  (e.g. node pdf.mjs reddit-senior-frontend-engineer)");
  process.exit(1);
}

const jobDir = path.join(__dirname, "jobs", slug);
const resumeTxt = path.join(jobDir, "tailored-resume.txt");
const resumeJson = path.join(jobDir, "tailored-resume.json");
const pdfOut = path.join(jobDir, "tailored-resume.pdf");

if (!fs.existsSync(resumeTxt)) {
  console.error(`No tailored resume found at jobs/${slug}/tailored-resume.txt`);
  process.exit(1);
}

// ─── Step 1: Get structured resume data ──────────────────────────────────────

let resumeData;

if (fs.existsSync(resumeJson)) {
  resumeData = JSON.parse(fs.readFileSync(resumeJson, "utf-8"));
  console.log("Using cached resume JSON.");
} else {
  process.stdout.write("Parsing resume structure...");
  const client = new Anthropic();
  const resumeText = fs.readFileSync(resumeTxt, "utf-8");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4000,
    system: `Extract the resume into a JSON object with this exact structure. Return only valid JSON, no markdown fences, no explanation.

{
  "experience": [
    { "company": string, "location": string, "role": string, "period": string, "bullets": string[], "note": string | null }
  ],
  "skills": [
    { "label": string, "items": string }
  ],
  "projects": [
    { "name": string, "period": string, "description": string }
  ],
  "education": [
    { "school": string, "detail": string }
  ]
}`,
    messages: [{ role: "user", content: resumeText }],
  });

  try {
    resumeData = JSON.parse(response.content[0].text.trim());
  } catch {
    console.error("\nFailed to parse resume JSON from model response.");
    process.exit(1);
  }

  fs.writeFileSync(resumeJson, JSON.stringify(resumeData, null, 2) + "\n");
  console.log(" done.");
}

// ─── Step 2: Write override file ─────────────────────────────────────────────

fs.writeFileSync(OVERRIDE_FILE, JSON.stringify(resumeData, null, 2) + "\n");

// ─── Step 3: Ensure dev server is running ────────────────────────────────────

async function isServerReady() {
  try {
    const res = await fetch(DEV_URL);
    return res.ok;
  } catch { return false; }
}

let devServer = null;

if (!(await isServerReady())) {
  process.stdout.write("Starting dev server...");
  devServer = spawn("npm", ["run", "dev"], { cwd: SITE_DIR, stdio: "pipe" });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 600));
    if (await isServerReady()) break;
  }

  if (!(await isServerReady())) {
    devServer.kill();
    fs.unlinkSync(OVERRIDE_FILE);
    console.error("\nDev server did not start in time.");
    process.exit(1);
  }
  console.log(" ready.");
} else {
  console.log("Dev server already running.");
}

// ─── Step 4: Generate PDF ────────────────────────────────────────────────────

process.stdout.write("Generating PDF...");

let browser;
try {
  browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(DEV_URL, { waitUntil: "networkidle0" });
  await page.pdf({
    path: pdfOut,
    format: "Letter",
    printBackground: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
  });
  console.log(" done.");
} finally {
  await browser?.close();
  fs.unlinkSync(OVERRIDE_FILE);
  devServer?.kill();
}

console.log(`\nPDF saved to jobs/${slug}/tailored-resume.pdf`);
