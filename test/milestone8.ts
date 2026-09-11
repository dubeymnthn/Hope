import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { FFmpegService } from "../src/media/ffmpeg.js";
import { QAAgent } from "../src/agents/qa.js";
import { StoryboardResultSchema } from "../src/schemas/storyboard.js";
import { ScriptResultSchema } from "../src/schemas/script.js";
import { PipelineStateManager } from "../src/orchestrator/pipeline-state.js";

async function verifyMilestone8(): Promise<void> {
  console.log("=== Verifying Milestone 8: FFmpeg Assembly, Subtitles & QA Audit ===\n");

  const stateManager = new PipelineStateManager();
  const projectDir = process.cwd();

  const rawVideoPath = resolve(projectDir, "renders/final-hyperframes.mp4");
  const audioPath = resolve(projectDir, "audio/narration.wav");
  const srtPath = resolve(projectDir, "audio/captions.srt");
  const finalVideoPath = resolve(projectDir, "final.mp4");

  if (!existsSync(rawVideoPath) || !existsSync(audioPath)) {
    throw new Error("Missing rendered video or audio narration. Complete Milestones 4 & 7 first.");
  }

  // 1. FFmpeg Muxing
  console.log("[TEST 1/3] Muxing HyperFrames Video with Narration Audio into final.mp4...");
  await FFmpegService.muxAudioAndVideo(rawVideoPath, audioPath, finalVideoPath);

  if (!existsSync(finalVideoPath) || statSync(finalVideoPath).size < 1000) {
    throw new Error("Muxed final.mp4 missing or empty");
  }
  console.log(`  ✓ final.mp4 successfully created (${(statSync(finalVideoPath).size / 1024).toFixed(1)} KB)\n`);

  // 2. Subtitles Check
  console.log("[TEST 2/3] Verifying Subtitles Sidecar (captions.srt)...");
  if (!existsSync(srtPath) || statSync(srtPath).size < 50) {
    throw new Error("captions.srt missing or empty");
  }
  console.log(`  ✓ captions.srt verified (${statSync(srtPath).size} bytes)\n`);

  // 3. QA Audit
  console.log("[TEST 3/3] Running Comprehensive Structural and Content QA...");
  const script = ScriptResultSchema.parse(JSON.parse(readFileSync(resolve(projectDir, "script/script.json"), "utf-8")));
  const storyboard = StoryboardResultSchema.parse(JSON.parse(readFileSync(resolve(projectDir, "storyboard/storyboard.json"), "utf-8")));

  const qaAgent = new QAAgent();
  const qaReport = await qaAgent.evaluate({
    videoPath: finalVideoPath,
    audioPath,
    srtPath,
    storyboard,
    script,
    outputDir: projectDir
  });

  const reportJsonPath = resolve(projectDir, "qa/report.json");
  const reportMdPath = resolve(projectDir, "qa/report.md");

  if (!existsSync(reportJsonPath) || !existsSync(reportMdPath)) {
    throw new Error("QA report files were not written to disk");
  }

  console.log(`\n  ✓ QA Status: ${qaReport.status}`);
  console.log(`  ✓ Critical Errors: ${qaReport.errors.length}`);
  console.log(`  ✓ Warnings: ${qaReport.warnings.length}`);

  if (qaReport.status !== "PASS") {
    throw new Error(`QA Audit failed! Review qa/report.md for details: ${qaReport.errors.join("; ")}`);
  }

  // 4. Update Pipeline State
  stateManager.setMilestone("milestone8", {
    status: "complete",
    artifact: "final.mp4",
    completedAt: new Date().toISOString(),
    validationVersion: "1.0.0",
    metadata: {
      qaStatus: qaReport.status,
      qaReportArtifact: "qa/report.json",
      finalVideoSize: statSync(finalVideoPath).size
    }
  });

  const state = stateManager.loadState();
  if (state.milestones["milestone8"]?.status !== "complete") {
    throw new Error("Failed to record milestone8 in pipeline-state.json");
  }
  console.log("  ✓ Milestone 8 successfully recorded in pipeline-state.json");

  console.log("\n==================================================================");
  console.log("🎉 ALL MILESTONE 8 VERIFICATION CHECKS PASSED!");
  console.log("==================================================================");
}

verifyMilestone8().catch((err) => {
  console.error("\n❌ Milestone 8 Verification Failed:", err);
  process.exit(1);
});
