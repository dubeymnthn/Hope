import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import ffmpegStatic from "ffmpeg-static";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

export interface HardwareReport {
  os: string;
  cpu: string;
  ram: string;
  gpu: string;
  vram: string;
  cuda: string;
  python: string;
  node: string;
  ffmpeg: string;
  ffprobe: string;
  hyperframes: string;
  timestamp: string;
}

export function runHardwareDiagnostics(): HardwareReport {
  // OS
  let os = process.platform + " " + process.arch;
  try {
    os = execSync("uname -srm", { encoding: "utf-8" }).trim();
  } catch {}

  // CPU
  let cpu = "Unknown CPU";
  try {
    const lscpu = execSync("lscpu", { encoding: "utf-8" });
    const modelMatch = lscpu.match(/Model name:\s+(.+)/);
    const coresMatch = lscpu.match(/CPU\(s\):\s+(\d+)/);
    if (modelMatch && coresMatch) {
      cpu = `${modelMatch[1].trim()} (${coresMatch[1]} cores)`;
    }
  } catch {}

  // RAM
  let ram = "Unknown RAM";
  try {
    const meminfo = readFileSync("/proc/meminfo", "utf-8");
    const totalMatch = meminfo.match(/MemTotal:\s+(\d+)\s+kB/);
    const availMatch = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/);
    if (totalMatch) {
      const totalGB = (parseInt(totalMatch[1], 10) / (1024 * 1024)).toFixed(1);
      const availGB = availMatch ? (parseInt(availMatch[1], 10) / (1024 * 1024)).toFixed(1) : "?";
      ram = `${totalGB} GiB total (${availGB} GiB available)`;
    }
  } catch {}

  // GPU & VRAM & CUDA
  let gpu = "None detected";
  let vram = "N/A";
  let cuda = "Unavailable";

  try {
    const lspci = execSync("lspci 2>/dev/null || true", { encoding: "utf-8" });
    const vgaMatch = lspci.match(/VGA compatible controller:\s+(.+)/);
    if (vgaMatch) {
      gpu = vgaMatch[1].trim();
    }
  } catch {}

  try {
    const smi = execSync("nvidia-smi 2>&1 || true", { encoding: "utf-8" });
    if (!smi.includes("not found") && !smi.includes("failed")) {
      cuda = "CUDA Driver present";
    } else {
      cuda = "No modern CUDA driver (Legacy GPU or CPU fallback)";
    }
  } catch {
    cuda = "No modern CUDA driver";
  }

  // Python
  let python = "Not found";
  try {
    python = execSync("python3 --version 2>&1", { encoding: "utf-8" }).trim();
  } catch {}

  // Node
  let node = process.version;

  // FFmpeg
  let ffmpeg = ffmpegStatic ? `ffmpeg-static (${ffmpegStatic})` : "Not found";
  try {
    const v = execSync(`"${ffmpegStatic}" -version`, { encoding: "utf-8" }).split("\n")[0];
    ffmpeg = v;
  } catch {}

  // FFprobe
  let ffprobe = ffprobeInstaller.path ? `ffprobe (${ffprobeInstaller.path})` : "Not found";
  try {
    const v = execSync(`"${ffprobeInstaller.path}" -version`, { encoding: "utf-8" }).split("\n")[0];
    ffprobe = v;
  } catch {}

  // HyperFrames
  let hyperframes = "Not found";
  try {
    hyperframes = execSync("npx hyperframes --version", { encoding: "utf-8" }).trim();
  } catch {}

  return {
    os,
    cpu,
    ram,
    gpu,
    vram,
    cuda,
    python,
    node,
    ffmpeg,
    ffprobe,
    hyperframes,
    timestamp: new Date().toISOString()
  };
}

if (process.argv[1]?.endsWith("hardware-diagnostics.ts") || process.argv[1]?.endsWith("hardware-diagnostics.js")) {
  console.log("==================================================================");
  console.log("HARDWARE DIAGNOSTICS & SYSTEM PROFILE REPORT");
  console.log("==================================================================\n");

  const report = runHardwareDiagnostics();
  console.log(`OS:           ${report.os}`);
  console.log(`CPU:          ${report.cpu}`);
  console.log(`RAM:          ${report.ram}`);
  console.log(`GPU:          ${report.gpu}`);
  console.log(`CUDA:         ${report.cuda}`);
  console.log(`Python:       ${report.python}`);
  console.log(`Node:         ${report.node}`);
  console.log(`FFmpeg:       ${report.ffmpeg}`);
  console.log(`FFprobe:      ${report.ffprobe}`);
  console.log(`HyperFrames:  v${report.hyperframes}`);
  console.log(`Timestamp:    ${report.timestamp}\n`);
  console.log("==================================================================");
}
