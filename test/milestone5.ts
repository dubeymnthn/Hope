import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { ScriptResultSchema } from "../src/schemas/script.js";
import { AudioTimestampsSchema } from "../src/schemas/timestamps.js";
import { ChannelDesignSchema } from "../src/schemas/design.js";
import { StoryboardResultSchema } from "../src/schemas/storyboard.js";
import { StoryboardAgent } from "../src/agents/storyboard.js";
import { DesignDirectorAgent } from "../src/agents/design-director.js";
import { PipelineStateManager } from "../src/orchestrator/pipeline-state.js";

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function verifyMilestone5(): Promise<void> {
  console.log("=== Verifying Milestone 5: Storyboard & Design System ===\n");

  const stateManager = new PipelineStateManager();
  const designDirector = new DesignDirectorAgent();

  // 1. Verify Design Specification
  console.log("[TEST 1/4] Validating Channel Design Specification...");
  const design = designDirector.getDesign();
  const designVersion = designDirector.getVersion();
  console.log(`  ✓ Design System: "${design.name}" (v${designVersion})`);
  console.log(`  ✓ Resolution: ${design.canvas.width}x${design.canvas.height} @ ${design.canvas.fps}fps`);
  console.log(`  ✓ Palette: Primary ${design.colors.primary}, Accent ${design.colors.accent}, Background ${design.colors.background}\n`);

  // 2. Load script and audio timestamps
  console.log("[TEST 2/4] Loading Upstream Script and Audio Timestamps...");
  const scriptPath = resolve(process.cwd(), "script/script.json");
  const timestampsPath = resolve(process.cwd(), "audio/timestamps.json");

  if (!existsSync(scriptPath) || !existsSync(timestampsPath)) {
    throw new Error("Missing script/script.json or audio/timestamps.json. Complete Milestones 3 & 4 first.");
  }

  const script = ScriptResultSchema.parse(JSON.parse(readFileSync(scriptPath, "utf-8")));
  const audio = AudioTimestampsSchema.parse(JSON.parse(readFileSync(timestampsPath, "utf-8")));
  console.log(`  ✓ Script scenes: ${script.scenes.length}`);
  console.log(`  ✓ Authoritative audio duration: ${audio.totalDuration}s\n`);

  // 3. Generate and Validate Storyboard
  console.log("[TEST 3/4] Generating and Validating Audio-Synchronized Storyboard...");
  const storyboardAgent = new StoryboardAgent();
  const storyboard = storyboardAgent.generate(script, audio, design, process.cwd());

  const storyboardPath = resolve(process.cwd(), "storyboard/storyboard.json");
  const rawStoryboard = readFileSync(storyboardPath, "utf-8");
  const validatedStoryboard = StoryboardResultSchema.parse(JSON.parse(rawStoryboard));

  console.log(`  ✓ Total Storyboard Scenes: ${validatedStoryboard.scenes.length}`);
  console.log(`  ✓ Total Video Duration: ${validatedStoryboard.total_duration}s`);

  // Verify critical constraint: Storyboard timing follows actual audio timing
  for (let i = 0; i < validatedStoryboard.scenes.length; i++) {
    const scene = validatedStoryboard.scenes[i];
    const audioSent = audio.sentences.find((s) => s.sceneId === scene.id);
    if (!audioSent) {
      throw new Error(`Storyboard scene ${scene.id} has no matching audio sentence timestamp!`);
    }
    if (Math.abs(scene.duration - audioSent.duration) > 0.05) {
      throw new Error(`Scene ${scene.id} duration drift: Storyboard (${scene.duration}s) vs Audio (${audioSent.duration}s)`);
    }
  }
  console.log("  ✓ Critical Timing Gate PASSED: All storyboard scene durations strictly match authoritative audio.\n");

  // 4. Update Pipeline State
  console.log("[TEST 4/4] Updating Pipeline State...");
  stateManager.setMilestone("milestone5", {
    status: "complete",
    artifact: "storyboard/storyboard.json",
    completedAt: new Date().toISOString(),
    artifactHash: sha256(rawStoryboard),
    validationVersion: "1.0.0",
    metadata: {
      designVersion,
      sceneCount: validatedStoryboard.scenes.length,
      totalDuration: validatedStoryboard.total_duration
    }
  });

  const state = stateManager.loadState();
  if (state.milestones["milestone5"]?.status !== "complete") {
    throw new Error("Failed to record milestone5 in pipeline-state.json");
  }
  console.log("  ✓ Milestone 5 successfully recorded in pipeline-state.json");

  console.log("\n==================================================================");
  console.log("🎉 ALL MILESTONE 5 VERIFICATION CHECKS PASSED!");
  console.log("==================================================================");
}

verifyMilestone5().catch((err) => {
  console.error("\n❌ Milestone 5 Verification Failed:", err);
  process.exit(1);
});
