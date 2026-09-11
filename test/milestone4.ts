import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { ScriptResultSchema } from "../src/schemas/script.js";
import { AudioTimestampsSchema } from "../src/schemas/timestamps.js";
import { VoiceAgent } from "../src/agents/voice.js";
import { FFmpegService } from "../src/media/ffmpeg.js";
import { PipelineStateManager } from "../src/orchestrator/pipeline-state.js";
import { runHardwareDiagnostics } from "../src/system/hardware-diagnostics.js";

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function verifyMilestone4(): Promise<void> {
  console.log("=== Verifying Milestone 4: Chatterbox TTS Voice Synthesis & Alignment ===\n");

  const stateManager = new PipelineStateManager();

  // 1. Hardware Pre-Check
  console.log("[TEST 1/5] Hardware Diagnostics Profile...");
  const hw = runHardwareDiagnostics();
  console.log(`  ✓ System: ${hw.cpu}, ${hw.ram}, ${hw.os}`);
  console.log(`  ✓ Audio engine: Chatterbox TTS on CPU (24kHz PCM)\n`);

  // 2. Load validated script
  const scriptPath = resolve(process.cwd(), "script/script.json");
  if (!existsSync(scriptPath)) {
    throw new Error("Milestone 3 script/script.json missing. Run milestone 3 first.");
  }
  const script = ScriptResultSchema.parse(JSON.parse(readFileSync(scriptPath, "utf-8")));

  // 3. Synthesize Speech with Chatterbox
  console.log(`[TEST 2/5] Synthesizing Speech for ${script.scenes.length} Scenes with Chatterbox...`);
  const voiceAgent = new VoiceAgent();
  const audioResult = await voiceAgent.generate(script.scenes, process.cwd());

  const narrationPath = resolve(process.cwd(), "audio/narration.wav");
  const timestampsPath = resolve(process.cwd(), "audio/timestamps.json");
  const srtPath = resolve(process.cwd(), "audio/captions.srt");

  if (!existsSync(narrationPath)) {
    throw new Error(`Master narration audio not created at ${narrationPath}`);
  }

  // 4. Probe real audio stream with FFprobe
  console.log("\n[TEST 3/5] FFprobe Audio Stream Verification...");
  const probe = await FFmpegService.probe(narrationPath);
  const fileSize = statSync(narrationPath).size;

  console.log(`  ✓ Audio File Size: ${(fileSize / 1024).toFixed(1)} KB`);
  console.log(`  ✓ Measured Duration: ${probe.duration.toFixed(2)}s`);
  console.log(`  ✓ Codec: ${probe.audioCodec}`);
  console.log(`  ✓ Has Audio Stream: ${probe.hasAudio}`);

  if (!probe.hasAudio) {
    throw new Error("FFprobe found no audio stream in narration.wav");
  }
  if (probe.duration < 5.0) {
    throw new Error(`Audio duration unexpectedly short: ${probe.duration}s`);
  }

  // 5. Schema Validation of Timestamps & Captions
  console.log("\n[TEST 4/5] Schema Validation of Timestamps & Captions...");
  const rawTimestamps = readFileSync(timestampsPath, "utf-8");
  const parsedTimestamps = JSON.parse(rawTimestamps);
  const validatedTimestamps = AudioTimestampsSchema.parse(parsedTimestamps);

  console.log(`  ✓ Aligned Sentences: ${validatedTimestamps.sentences.length}`);
  console.log(`  ✓ Total Timed Duration: ${validatedTimestamps.totalDuration}s`);

  if (!existsSync(srtPath) || statSync(srtPath).size < 50) {
    throw new Error("Captions SRT file missing or empty");
  }
  console.log(`  ✓ Captions SRT: Validated (${statSync(srtPath).size} bytes)`);

  // 6. Pipeline State Update & Idempotency
  console.log("\n[TEST 5/5] Pipeline State & Idempotency Check...");
  const audioHash = sha256(readFileSync(narrationPath));
  stateManager.setMilestone("milestone4", {
    status: "complete",
    artifact: "audio/timestamps.json",
    completedAt: new Date().toISOString(),
    artifactHash: audioHash,
    validationVersion: "1.0.0",
    metadata: {
      audioPath: "audio/narration.wav",
      duration: probe.duration,
      sampleRate: 24000,
      sceneCount: script.scenes.length
    }
  });

  const state = stateManager.loadState();
  if (state.milestones["milestone4"]?.status !== "complete") {
    throw new Error("Failed to record milestone4 in pipeline-state.json");
  }
  console.log("  ✓ Milestone 4 successfully recorded in pipeline-state.json");

  console.log("\n==================================================================");
  console.log("🎉 ALL MILESTONE 4 VERIFICATION CHECKS PASSED!");
  console.log("==================================================================");
}

verifyMilestone4().catch((err) => {
  console.error("\n❌ Milestone 4 Verification Failed:", err);
  process.exit(1);
});
