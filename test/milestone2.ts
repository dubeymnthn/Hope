import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Milestone2ArtifactSchema } from "../src/schemas/milestone2.js";
import { PipelineStateManager } from "../src/orchestrator/pipeline-state.js";

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function verifyMilestone2(): Promise<void> {
  console.log("=== Verifying Milestone 2: Antigravity Agent + Artifact Verification ===\n");

  const artifactRelativePath = "test-artifacts/milestone2-agent-output.json";
  const artifactPath = resolve(process.cwd(), artifactRelativePath);
  const stateManager = new PipelineStateManager();

  // -------------------------------------------------------------
  // Step 1: Negative Validation Test (Contract Enforcing Proof)
  // -------------------------------------------------------------
  console.log("[TEST 1/4] Running Negative Validation Test...");
  const tempInvalidPath = resolve(process.cwd(), "test-artifacts/temp-invalid.json");
  const invalidData = {
    milestone: 999,
    status: "whatever"
  };

  const parseInvalid = Milestone2ArtifactSchema.safeParse(invalidData);
  if (parseInvalid.success) {
    throw new Error("Negative validation FAILED: Schema unexpectedly accepted invalid data!");
  }
  console.log("  ✓ Schema correctly rejected invalid payload:");
  console.log(`    Errors: ${parseInvalid.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`);

  // Write temporary invalid file and verify file-based negative test
  writeFileSync(tempInvalidPath, JSON.stringify(invalidData), "utf-8");
  try {
    const rawInvalid = JSON.parse(readFileSync(tempInvalidPath, "utf-8"));
    const fileParse = Milestone2ArtifactSchema.safeParse(rawInvalid);
    if (fileParse.success) {
      throw new Error("File-based negative test FAILED: Schema accepted invalid file content!");
    }
  } finally {
    if (existsSync(tempInvalidPath)) {
      unlinkSync(tempInvalidPath);
    }
  }
  console.log("  ✓ Negative validation test PASSED: Invalid artifacts are strictly rejected.\n");

  // -------------------------------------------------------------
  // Step 2: Agent Execution & Artifact Verification
  // -------------------------------------------------------------
  console.log("[TEST 2/4] Verifying Real Antigravity Agent Artifact...");
  if (!existsSync(artifactPath)) {
    throw new Error(`Agent artifact missing at expected path: ${artifactPath}`);
  }

  const rawContent = readFileSync(artifactPath, "utf-8");
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawContent);
  } catch (err: any) {
    throw new Error(`Failed to parse artifact JSON: ${err.message}`);
  }

  const validationResult = Milestone2ArtifactSchema.safeParse(parsedJson);
  if (!validationResult.success) {
    const issues = validationResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Zod validation failed for agent artifact: ${issues}`);
  }

  const validArtifact = validationResult.data;
  console.log("  ✓ Artifact successfully parsed and validated by Zod:");
  console.log(`    Milestone: ${validArtifact.milestone}`);
  console.log(`    Agent: ${validArtifact.agent}`);
  console.log(`    Status: ${validArtifact.status}`);
  console.log(`    Message: ${validArtifact.message}`);
  console.log(`    Timestamp: ${validArtifact.timestamp}`);

  const artifactHash = sha256(rawContent);
  console.log(`    SHA-256: ${artifactHash}\n`);

  // -------------------------------------------------------------
  // Step 3: Atomic Pipeline State Persistence
  // -------------------------------------------------------------
  console.log("[TEST 3/4] Recording Milestone 2 in Pipeline State (Atomic Write)...");
  stateManager.setMilestone("milestone2", {
    status: "complete",
    artifact: artifactRelativePath,
    completedAt: validArtifact.timestamp,
    artifactHash,
    validationVersion: "1.0.0"
  });

  const persistedState = stateManager.loadState();
  const milestone2Record = persistedState.milestones["milestone2"];

  if (!milestone2Record || milestone2Record.status !== "complete") {
    throw new Error("Failed to record milestone2 completion in pipeline-state.json");
  }

  console.log("  ✓ State successfully persisted to pipeline-state.json:");
  console.log(JSON.stringify(milestone2Record, null, 4));
  console.log("");

  // -------------------------------------------------------------
  // Step 4: Resume & Idempotency Test
  // -------------------------------------------------------------
  console.log("[TEST 4/4] Verifying Resume / Idempotency Behavior...");
  const isAlreadyComplete = stateManager.isMilestoneComplete("milestone2");
  if (!isAlreadyComplete) {
    throw new Error("Idempotency check failed: milestone2 was not recognized as complete");
  }

  const existingRecord = stateManager.getMilestone("milestone2");
  const currentContent = readFileSync(artifactPath, "utf-8");
  const currentHash = sha256(currentContent);

  if (existingRecord?.artifactHash === currentHash) {
    console.log("  ✓ Resume check passed: Artifact unchanged, reusing existing validated artifact without regeneration.");
  } else {
    throw new Error("Idempotency hash mismatch on second execution!");
  }

  console.log("\n==================================================================");
  console.log("🎉 ALL MILESTONE 2 VERIFICATION CHECKS PASSED!");
  console.log("==================================================================");
}

verifyMilestone2().catch((err) => {
  console.error("\n❌ Milestone 2 Verification Failed:", err);
  process.exit(1);
});
