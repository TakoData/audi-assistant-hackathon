import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const allQueries = [
  "What is the weather in Wolfsburg today?",
  "Will it rain in Wolfsburg tomorrow?",
  "How did Volkswagen stock perform this month?",
  "What is Nvidia's current stock price?",
  "Compare Volkswagen and Toyota annual revenue",
  "What is Volkswagen's market capitalization?",
  "How many electric vehicles were sold in Europe last year?",
  "Compare EV sales in Europe and the United States",
  "What is Germany's current inflation rate?",
  "What is the current price of Brent crude oil?",
  "When is the next San Francisco 49ers game?",
  "Who leads the Bundesliga table?",
  "What was the latest Formula One race result?",
  "What is the population of Wolfsburg?",
  "How many employees does Volkswagen have?",
  "What was Volkswagen's latest annual revenue?",
  "What is the current euro to US dollar exchange rate?",
  "Who is the current CEO of Volkswagen?",
  "What were global car sales last year?",
  "Summarize the latest major Volkswagen news",
];

const smoke = process.argv.includes("--full") ? allQueries : allQueries.slice(0, 5);
const relayUrl = (process.env.VW_DEMO_RELAY_URL || "https://vw-assistant-demo.vercel.app").replace(/\/$/, "");
let token = process.env.DEMO_ACCESS_TOKEN || "";
if (!token && process.platform === "darwin") {
  try {
    token = execFileSync("security", ["find-generic-password", "-s", "com.tako.vw-demo.access-token", "-w"], { encoding: "utf8" }).trim();
  } catch {}
}
if (!token) {
  console.error("DEMO_ACCESS_TOKEN is required. On the demo Mac it can be read from Keychain automatically.");
  process.exit(2);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactDir = path.resolve("artifacts", `query-regression-${timestamp}`);
await mkdir(artifactDir, { recursive: true });
const results = [];

for (const query of smoke) {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${relayUrl}/answer`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-VW-Client-Version": "rehearsal" },
      body: JSON.stringify({ query, effort:"fast", location:{latitude:52.4227,longitude:10.7865}, country_code:"DE",locale:"en-US",timezone:"Europe/Berlin",output_settings:{image_dark_mode:true}, ...(/\b(weather|rain)\b/i.test(query) ? {sources:{data:{count:10},web:{count:10}}} : {}) }),
      signal: AbortSignal.timeout(35_000),
    });
    const payload = await response.json().catch(() => null);
    const elapsedMs = Date.now() - startedAt;
    const passed = response.ok && typeof payload?.answer === "string" && payload.answer.trim().length > 0;
    const needsReview = passed && /can[’']?t|cannot|couldn[’']?t|unable|unavailable|no (?:reliable|current|recent)|not (?:available|enough)|could not/i.test(payload.answer);
    results.push({ query, passed, needsReview, answer:payload?.answer, cardDetails:payload?.cards, status: response.status, elapsedMs, cards: Array.isArray(payload?.cards) ? payload.cards.length : 0, requestId: payload?.request_id || response.headers.get("x-request-id"), error: passed ? undefined : payload?.error || "Missing answer" });
    console.log(`${passed ? "PASS" : "FAIL"}  ${(elapsedMs / 1000).toFixed(1)}s  ${query}`);
  } catch (error) {
    results.push({ query, passed: false, elapsedMs: Date.now() - startedAt, cards: 0, error: error instanceof Error ? error.message : String(error) });
    console.log(`FAIL  ${query}`);
  }
}

const passed = results.filter((result) => result.passed).length;
const cardCount = results.reduce((total, result) => total + result.cards, 0);
const report = [
  "# Audi Assistant query regression",
  "",
  `- Run: ${new Date().toISOString()}`,
  `- Relay: ${relayUrl}`,
  `- Passed: ${passed}/${results.length}`,
  `- Cards returned: ${cardCount}`,
  `- Answers flagged for content review: ${results.filter(r=>r.needsReview).length}`,
  "- PASS means a non-empty API answer, not independently verified factual accuracy. Full answers are saved in results.json for review.",
  "",
  "| Result | Seconds | Cards | Query | Request |",
  "|---|---:|---:|---|---|",
  ...results.map((result) => `| ${result.passed ? "PASS" : "FAIL"} | ${(result.elapsedMs / 1000).toFixed(1)} | ${result.cards} | ${result.query.replaceAll("|", "\\|")} | ${result.requestId || result.error || "—"} |`),
  "",
].join("\n");

await writeFile(path.join(artifactDir, "report.md"), report);
await writeFile(path.join(artifactDir, "results.json"), JSON.stringify(results, null, 2));
console.log(`\nReport: ${path.join(artifactDir, "report.md")}`);
if (passed !== results.length) process.exit(1);
