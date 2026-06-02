import dotenv from "dotenv";
dotenv.config({ override: true });
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { createInterface } from "readline/promises";
import { fileURLToPath } from "url";

const client = new Anthropic();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Input ─────────────────────────────────────────────────────────────────────

function loadJobFiles() {
  const jobArg = process.argv[2];
  if (!jobArg) {
    console.error("Usage: node interview.mjs <job-folder | job-posting-file>");
    console.error("  node interview.mjs jobs/stripe-senior-engineer");
    console.error("  node interview.mjs jobs/stripe-senior-engineer/job-posting.txt");
    process.exit(1);
  }

  let jobDir, postingPath, resumePath;

  const stat = fs.statSync(jobArg, { throwIfNoEntry: false });
  if (stat?.isDirectory()) {
    jobDir = jobArg;
    postingPath = path.join(jobArg, "job-posting.txt");
    resumePath = path.join(jobArg, "tailored-resume.txt");
  } else {
    jobDir = path.dirname(jobArg);
    postingPath = jobArg;
    resumePath = path.join(path.dirname(jobArg), "tailored-resume.txt");
  }

  if (!fs.existsSync(postingPath)) {
    console.error(`Job posting not found: ${postingPath}`);
    process.exit(1);
  }

  const jobPosting = fs.readFileSync(postingPath, "utf-8");
  const resume = fs.existsSync(resumePath)
    ? fs.readFileSync(resumePath, "utf-8")
    : fs.readFileSync(path.join(__dirname, "resume.txt"), "utf-8");

  return { jobPosting, resume, jobDir };
}

// ─── Mock Interview ─────────────────────────────────────────────────────────────

async function runInterview(resume, jobPosting, jobDir) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const systemPrompt = `You are a senior hiring manager conducting a technical phone screen for the following role.

JOB POSTING:
${jobPosting}

CANDIDATE RESUME:
${resume}

How to run this interview:
- Treat this resume as-submitted — you have no reason to doubt it
- Ask probing questions about specific claims on the resume, one at a time
- Cover at least two technical areas and one behavioral or process question before wrapping up
- After at least 5 substantive exchanges, use the conclude_interview tool to deliver your honest verdict
- Be direct. If something on the resume doesn't hold up under questioning, say so`;

  const tools = [
    {
      name: "conclude_interview",
      description: "End the interview and record your hiring recommendation. Call this after at least 5 exchanges.",
      input_schema: {
        type: "object",
        properties: {
          recommendation: {
            type: "string",
            enum: ["Strong Hire", "Hire", "On the Fence", "No Hire"],
          },
          reasoning: {
            type: "string",
            description: "Honest assessment: what impressed you, what concerned you, and why you landed where you did",
          },
        },
        required: ["recommendation", "reasoning"],
      },
    },
  ];

  const messages = [{ role: "user", content: "Start the interview." }];

  console.log("\n" + "─".repeat(60));
  console.log("MOCK INTERVIEW");
  console.log("─".repeat(60) + "\n");

  while (true) {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1000,
      system: systemPrompt,
      tools,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (toolUse?.name === "conclude_interview") {
      const { recommendation, reasoning } = toolUse.input;
      console.log("\n" + "─".repeat(60));
      console.log("VERDICT");
      console.log("─".repeat(60));
      console.log(`\nRecommendation: ${recommendation}\n`);
      console.log(reasoning + "\n");

      const notesPath = path.join(jobDir, "interview-notes.md");
      const timestamp = new Date().toISOString().split("T")[0];
      const entry = `\n---\n\n## Session ${timestamp}\n\n**Verdict: ${recommendation}**\n\n${reasoning}\n`;
      fs.appendFileSync(notesPath, entry);
      console.log(`Notes appended to ${notesPath}`);

      rl.close();
      return;
    }

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    console.log(`Hiring Manager: ${text}\n`);

    const answer = await rl.question("You: ");
    console.log("");
    messages.push({ role: "user", content: answer });
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────────

const { jobPosting, resume, jobDir } = loadJobFiles();
await runInterview(resume, jobPosting, jobDir);
