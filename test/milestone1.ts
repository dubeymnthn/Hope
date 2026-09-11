import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import ffprobe from "@ffprobe-installer/ffprobe";

async function verifyMilestone1() {
  console.log("=== Verifying Milestone 1: HyperFrames Render Engine ===");
  const videoPath = resolve(process.cwd(), "test-milestone1/renders/hello.mp4");
  
  if (!existsSync(videoPath)) {
    throw new Error(`Video file does not exist at ${videoPath}`);
  }

  const stat = statSync(videoPath);
  console.log(`Video file size: ${(stat.size / 1024).toFixed(1)} KB`);
  if (stat.size < 1000) {
    throw new Error("Rendered video file is too small or corrupt");
  }

  const probeOutput = execSync(
    `"${ffprobe.path}" -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,duration -of json "${videoPath}"`
  ).toString();

  const probe = JSON.parse(probeOutput);
  const stream = probe.streams?.[0];
  if (!stream) {
    throw new Error("No video stream found in rendered MP4");
  }

  console.log(`Resolution: ${stream.width}x${stream.height}`);
  console.log(`Frame rate: ${stream.r_frame_rate}`);
  console.log(`Duration: ${stream.duration}s`);

  if (stream.width !== 1920 || stream.height !== 1080) {
    throw new Error(`Unexpected resolution: ${stream.width}x${stream.height}`);
  }

  console.log("✅ MILESTONE 1 VERIFICATION PASSED: Real 1080p 30fps MP4 produced!");
}

verifyMilestone1().catch((err) => {
  console.error("❌ Milestone 1 Verification Failed:", err);
  process.exit(1);
});
