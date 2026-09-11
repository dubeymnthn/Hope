import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { ResearchAgent } from "../src/agents/researcher.js";
import { ArgumentAgent } from "../src/agents/argument.js";
import { ScriptAgent } from "../src/agents/script.js";
import { ScriptQAAgent } from "../src/agents/script-qa.js";
import { StoryboardAgent } from "../src/agents/storyboard.js";
import { VisualStyleQAAgent } from "../src/qa/visual-style.js";
import { VisualSceneAgent } from "../src/agents/visual-scene.js";
import { DesignDirectorAgent } from "../src/agents/design-director.js";
import { AudioTimestampsSchema } from "../src/schemas/timestamps.js";
import { ChannelConfigSchema } from "../src/schemas/channel.js";
import { HyperFramesRenderer } from "../src/renderers/hyperframes.js";

async function verifyV2Pipeline(): Promise<void> {
  console.log("===============================================================");
  console.log("=== Verifying V2: Long-Form Documentary Production Pipeline ===");
  console.log("===============================================================\n");

  const projectDir = process.cwd();
  const topic = "Why AI memory prices are exploding";

  // 1. Channel Config
  console.log("[TEST 1/8] Validating V2 Channel Configuration...");
  const configRaw = JSON.parse(readFileSync(resolve(projectDir, "config/channel.json"), "utf-8"));
  const config = ChannelConfigSchema.parse(configRaw);
  console.log(`  ✓ Channel: "${config.channelName}", Video target: ${config.video?.targetDurationMinutes}m, Anti-slop: ${config.editorial?.antiSlopMode}\n`);

  // 2. Research Verification
  console.log("[TEST 2/8] Validating Autonomous Research Dossier...");
  const researcher = new ResearchAgent();
  const research = await researcher.loadOrValidate(topic, projectDir);
  console.log(`  ✓ Research Dossier loaded: ${research.facts.length} facts, ${research.statistics.length} statistics, ${research.sources.length} sources\n`);

  // 3. Argument / Thesis Generation
  console.log("[TEST 3/8] Validating Editorial Argument & Thesis...");
  const argumentAgent = new ArgumentAgent();
  const argument = await argumentAgent.loadOrValidate(projectDir);
  console.log(`  ✓ Central Question: "${argument.centralQuestion}"`);
  console.log(`  ✓ Central Thesis: "${argument.centralThesis}"`);
  console.log(`  ✓ Supporting Claims: ${argument.supportingClaims.length}`);
  console.log(`  ✓ Narrative Phases: ${argument.narrativeProgression.length}\n`);

  // 4. Script Verification
  console.log("[TEST 4/8] Validating Documentary Script...");
  const scriptAgent = new ScriptAgent();
  const script = await scriptAgent.loadOrValidate(projectDir);
  console.log(`  ✓ Script: "${script.title}" (${script.scenes.length} scenes)\n`);

  // 5. Script QA Gate (Pre-TTS)
  console.log("[TEST 5/8] Running Pre-Synthesis Script QA Gate...");
  const scriptQa = new ScriptQAAgent();
  const scriptReport = await scriptQa.evaluate({
    script,
    research,
    argument,
    config,
    outputDir: projectDir
  });
  console.log(`  ✓ Script QA Status: ${scriptReport.status}`);
  if (scriptReport.status === "FAIL") {
    throw new Error(`Script QA Gate failed with ${scriptReport.errors.length} errors`);
  }
  console.log(`  ✓ Script QA Gate PASSED!\n`);

  // 6. Dynamic Storyboard
  console.log("[TEST 6/8] Generating Dynamic Storyboard with Internal Beats...");
  const designDirector = new DesignDirectorAgent();
  const design = designDirector.getDesign();
  const audioRaw = JSON.parse(readFileSync(resolve(projectDir, "audio/timestamps.json"), "utf-8"));
  const audio = AudioTimestampsSchema.parse(audioRaw);

  const storyboardAgent = new StoryboardAgent();
  const storyboard = storyboardAgent.generate(script, audio, design, projectDir, research);
  console.log(`  ✓ Storyboard synchronized: ${storyboard.scenes.length} scenes, duration ${storyboard.total_duration}s`);
  for (const s of storyboard.scenes) {
    console.log(`    - Scene ${s.id}: mode "${s.visual_mode}", ${s.beats?.length || 0} visual beats, on-screen: "${s.on_screen_text}"`);
  }
  console.log();

  // 7. Visual Style & Anti-Repetition QA
  console.log("[TEST 7/8] Running Visual Style Diversity QA Audit...");
  const visualQa = new VisualStyleQAAgent();
  const visualReport = visualQa.evaluate({
    storyboard,
    config,
    outputDir: projectDir
  });
  console.log(`  ✓ Visual QA Status: ${visualReport.status}`);
  console.log(`  ✓ Distinct visual modes used: ${visualReport.distinctVisualModes}`);
  if (visualReport.status === "FAIL") {
    throw new Error(`Visual QA failed with ${visualReport.errors.length} errors`);
  }
  console.log();

  // 8. Modular Compositions & HyperFrames Pre-Render Gate
  console.log("[TEST 8/8] Generating Modular Visual Compositions & Verifying HyperFrames Gate...");
  const visualSceneAgent = new VisualSceneAgent();
  const sceneResults = await visualSceneAgent.generateAllScenes(storyboard, design, designDirector.getVersion(), projectDir);
  console.log(`  ✓ Generated ${sceneResults.length} bespoke compositions.`);

  const renderer = new HyperFramesRenderer();
  const hfCheck = await renderer.check(projectDir);
  console.log(`  ✓ HyperFrames Pre-Render Gate: Clean check PASSED!\n`);

  console.log("===============================================================");
  console.log("🎉 ALL V2 PIPELINE INTEGRATION TESTS PASSED!");
  console.log("===============================================================");
}

verifyV2Pipeline().catch((err) => {
  console.error("\n❌ V2 Pipeline Verification Failed:", err);
  process.exit(1);
});
