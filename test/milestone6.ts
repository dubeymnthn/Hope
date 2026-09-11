import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { StoryboardResultSchema } from "../src/schemas/storyboard.js";
import { DesignDirectorAgent } from "../src/agents/design-director.js";
import { VisualSceneAgent } from "../src/agents/visual-scene.js";
import { SceneCompositionGenerator } from "../src/scenes/scene-generator.js";
import { PipelineStateManager } from "../src/orchestrator/pipeline-state.js";

async function verifyMilestone6(): Promise<void> {
  console.log("=== Verifying Milestone 6: Visual Scene Generation & Idempotency ===\n");

  const stateManager = new PipelineStateManager();
  const designDirector = new DesignDirectorAgent();
  const design = designDirector.getDesign();
  const designVersion = designDirector.getVersion();

  // 1. Load Storyboard
  console.log("[TEST 1/4] Loading Storyboard Artifacts...");
  const storyboardPath = resolve(process.cwd(), "storyboard/storyboard.json");
  if (!existsSync(storyboardPath)) {
    throw new Error("storyboard/storyboard.json missing. Complete Milestone 5 first.");
  }
  const storyboard = StoryboardResultSchema.parse(JSON.parse(readFileSync(storyboardPath, "utf-8")));
  console.log(`  ✓ Storyboard verified: ${storyboard.scenes.length} scenes (${storyboard.total_duration}s)\n`);

  // 2. Generate all visual scenes
  console.log("[TEST 2/4] Generating Scene Compositions & Master index.html...");
  const visualSceneAgent = new VisualSceneAgent();
  const results = await visualSceneAgent.generateAllScenes(storyboard, design, designVersion, process.cwd());

  console.log(`  ✓ Generated ${results.length} scene HTML files in compositions/`);
  for (const r of results) {
    if (!existsSync(r.htmlPath) || !existsSync(r.metaPath)) {
      throw new Error(`Scene ${r.sceneId} artifacts missing from disk!`);
    }
    const htmlSize = statSync(r.htmlPath).size;
    console.log(`    - Scene ${r.sceneId}: ${htmlSize} bytes, fingerprint: ${r.fingerprint.slice(0, 12)}...`);
  }

  const indexPath = resolve(process.cwd(), "index.html");
  if (!existsSync(indexPath) || statSync(indexPath).size < 100) {
    throw new Error("Master index.html missing or empty");
  }
  console.log(`  ✓ Master index.html verified (${statSync(indexPath).size} bytes)\n`);

  // 3. Verify Scene Idempotency & Caching
  console.log("[TEST 3/4] Testing Scene Idempotency & Cache Hit...");
  const generator = new SceneCompositionGenerator();
  const secondRun = await generator.generateScene(storyboard.scenes[0], {
    design,
    designVersion,
    outputDir: process.cwd()
  });

  if (!secondRun.reused) {
    throw new Error("Idempotency failed: Scene was not reused on identical input fingerprint!");
  }
  console.log(`  ✓ Idempotency Verified: Scene ${secondRun.sceneId} successfully reused cached composition.\n`);

  // 4. Update Pipeline State
  console.log("[TEST 4/4] Updating Pipeline State...");
  stateManager.setMilestone("milestone6", {
    status: "complete",
    artifact: "index.html",
    completedAt: new Date().toISOString(),
    validationVersion: "1.0.0",
    metadata: {
      sceneCount: results.length,
      compositionsDir: "compositions",
      scenesDir: "scenes"
    }
  });

  const state = stateManager.loadState();
  if (state.milestones["milestone6"]?.status !== "complete") {
    throw new Error("Failed to record milestone6 in pipeline-state.json");
  }
  console.log("  ✓ Milestone 6 successfully recorded in pipeline-state.json");

  console.log("\n==================================================================");
  console.log("🎉 ALL MILESTONE 6 VERIFICATION CHECKS PASSED!");
  console.log("==================================================================");
}

verifyMilestone6().catch((err) => {
  console.error("\n❌ Milestone 6 Verification Failed:", err);
  process.exit(1);
});
