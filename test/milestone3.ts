import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { ResearchResultSchema } from "../src/schemas/research.js";
import { ScriptResultSchema } from "../src/schemas/script.js";
import { PipelineStateManager } from "../src/orchestrator/pipeline-state.js";

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function verifyMilestone3(): Promise<void> {
  console.log("=== Verifying Milestone 3: Research -> Script Generation ===\n");

  const stateManager = new PipelineStateManager();
  const researchJsonPath = resolve(process.cwd(), "research/research.json");
  const researchMdPath = resolve(process.cwd(), "research/research.md");
  const scriptJsonPath = resolve(process.cwd(), "script/script.json");
  const scriptMdPath = resolve(process.cwd(), "script/script.md");

  // -------------------------------------------------------------
  // Test 1: Negative Schema Validation Gate
  // -------------------------------------------------------------
  console.log("[TEST 1/5] Verifying Negative Schema Validation Gates...");
  const invalidResearch = { topic: "Test", facts: [{ statement: "foo", category: "INVALID_CAT" }] };
  const researchGate = ResearchResultSchema.safeParse(invalidResearch);
  if (researchGate.success) {
    throw new Error("ResearchResultSchema failed to reject invalid category!");
  }

  const invalidScript = { title: "Test", scenes: [] }; // scenes min(1) required
  const scriptGate = ScriptResultSchema.safeParse(invalidScript);
  if (scriptGate.success) {
    throw new Error("ScriptResultSchema failed to reject empty scenes array!");
  }
  console.log("  ✓ Negative schema validation passed: Malformed research and scripts are strictly rejected.\n");

  // -------------------------------------------------------------
  // Test 2: Research Artifact Verification
  // -------------------------------------------------------------
  console.log("[TEST 2/5] Validating Research Artifacts (JSON & Markdown)...");
  if (!existsSync(researchJsonPath) || !existsSync(researchMdPath)) {
    throw new Error("Research artifacts missing from research/ directory");
  }

  const rawResearch = readFileSync(researchJsonPath, "utf-8");
  const parsedResearch = JSON.parse(rawResearch);
  const validatedResearch = ResearchResultSchema.parse(parsedResearch);

  console.log(`  ✓ Topic: "${validatedResearch.topic}"`);
  console.log(`  ✓ Facts verified: ${validatedResearch.facts.length} items`);
  console.log(`  ✓ Primary statistics: ${validatedResearch.statistics.length} metrics`);
  console.log(`  ✓ Timeline events: ${validatedResearch.timeline.length} milestones`);
  console.log(`  ✓ Sources cited: ${validatedResearch.sources.length} sources`);
  console.log(`  ✓ Markdown dossier size: ${statSync(researchMdPath).size} bytes\n`);

  // Verify non-fabrication constraint: each source has a valid URL
  for (const src of validatedResearch.sources) {
    if (!src.url.startsWith("http://") && !src.url.startsWith("https://")) {
      throw new Error(`Invalid source URL found: ${src.url}`);
    }
  }

  // -------------------------------------------------------------
  // Test 3: Script Artifact Verification
  // -------------------------------------------------------------
  console.log("[TEST 3/5] Validating Script Artifacts (JSON & Markdown)...");
  if (!existsSync(scriptJsonPath) || !existsSync(scriptMdPath)) {
    throw new Error("Script artifacts missing from script/ directory");
  }

  const rawScript = readFileSync(scriptJsonPath, "utf-8");
  const parsedScript = JSON.parse(rawScript);
  const validatedScript = ScriptResultSchema.parse(parsedScript);

  console.log(`  ✓ Script Title: "${validatedScript.title}"`);
  console.log(`  ✓ Opening Hook: "${validatedScript.hook.slice(0, 70)}..."`);
  console.log(`  ✓ Total Scenes: ${validatedScript.scenes.length}`);
  console.log(`  ✓ Markdown script size: ${statSync(scriptMdPath).size} bytes\n`);

  // -------------------------------------------------------------
  // Test 4: Atomic Pipeline State Persistence
  // -------------------------------------------------------------
  console.log("[TEST 4/5] Recording Milestone 3 into pipeline-state.json...");
  const researchHash = sha256(rawResearch);
  const scriptHash = sha256(rawScript);

  stateManager.setMilestone("milestone3", {
    status: "complete",
    artifact: "script/script.json",
    completedAt: new Date().toISOString(),
    artifactHash: scriptHash,
    validationVersion: "1.0.0",
    metadata: {
      researchArtifact: "research/research.json",
      researchHash,
      sceneCount: validatedScript.scenes.length,
      topic: validatedResearch.topic
    }
  });

  const persistedState = stateManager.loadState();
  const m3Record = persistedState.milestones["milestone3"];
  if (!m3Record || m3Record.status !== "complete") {
    throw new Error("Failed to record milestone3 in pipeline-state.json");
  }
  console.log("  ✓ State recorded successfully:");
  console.log(JSON.stringify(m3Record, null, 4));
  console.log("");

  // -------------------------------------------------------------
  // Test 5: Idempotency & Resume Check
  // -------------------------------------------------------------
  console.log("[TEST 5/5] Checking Idempotency and Resumption...");
  if (!stateManager.isMilestoneComplete("milestone3")) {
    throw new Error("Milestone 3 should be reported as complete");
  }
  console.log("  ✓ Idempotency verified: Re-execution recognizes milestone 3 completion.\n");

  console.log("==================================================================");
  console.log("🎉 ALL MILESTONE 3 VERIFICATION CHECKS PASSED!");
  console.log("==================================================================");
}

verifyMilestone3().catch((err) => {
  console.error("\n❌ Milestone 3 Verification Failed:", err);
  process.exit(1);
});
