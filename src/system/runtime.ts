import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FFMPEG_PATH, FFPROBE_PATH } from "../media/ffmpeg.js";

/**
 * Centralised runtime / environment resolver.
 *
 * Every external executable the factory depends on is resolved here, once, in a
 * platform-aware way, and reported before production begins. Nothing else in the
 * pipeline should construct interpreter or binary paths on its own (spec V2.2 §5).
 *
 * The resolver fails early with actionable diagnostics rather than letting a missing
 * dependency surface as an obscure spawn error three stages into a production.
 */

export type TtsDevice = "cpu" | "xpu" | "cuda" | "mps";

export interface RuntimeReport {
  platform: NodeJS.Platform;
  arch: string;
  node: string;
  ttsDevice: TtsDevice;
  /** How the device was chosen: env override, accelerator venv present, or default. */
  ttsDeviceSource: "TTS_DEVICE" | "accelerator-venv" | "default";
  /** Chatterbox classifier-free-guidance weight. 0.5 is the model's own default. */
  ttsCfgWeight: number;
  ttsCfgWeightSource: "TTS_CFG_WEIGHT" | "default";
  pythonExecutable: string | null;
  pythonVersion: string | null;
  pythonEnv: string | null;
  chatterboxVersion: string | null;
  torchVersion: string | null;
  hyperframesEntry: string | null;
  hyperframesVersion: string | null;
  ffmpeg: string | null;
  ffprobe: string | null;
  /** Coarse expectation from measured runs; never a promise. */
  performanceMode: string;
  problems: RuntimeProblem[];
}

export interface RuntimeProblem {
  component: string;
  message: string;
  fix: string;
  fatal: boolean;
}

/** Python versions Chatterbox's dependency tree ships wheels for. */
export const SUPPORTED_PYTHON = { min: [3, 10], max: [3, 12] } as const;

export const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";

export function venvPython(venvDir: string, baseDir: string = process.cwd()): string {
  return resolve(
    baseDir,
    process.platform === "win32" ? `${venvDir}/Scripts/python.exe` : `${venvDir}/bin/python`
  );
}

export function resolveTtsDevice(baseDir: string = process.cwd()): {
  device: TtsDevice;
  source: RuntimeReport["ttsDeviceSource"];
} {
  const requested = (process.env.TTS_DEVICE || "").trim().toLowerCase();
  if (requested) {
    if (!["cpu", "xpu", "cuda", "mps"].includes(requested)) {
      throw new Error(
        `TTS_DEVICE="${requested}" is not supported. Use one of: cpu, xpu, cuda, mps.`
      );
    }
    return { device: requested as TtsDevice, source: "TTS_DEVICE" };
  }
  // An accelerator venv exists only to be used, so its presence is an explicit opt-in.
  if (existsSync(venvPython(".venv-xpu", baseDir))) return { device: "xpu", source: "accelerator-venv" };
  return { device: "cpu", source: "default" };
}

/**
 * Chatterbox's T3 decode duplicates its token batch (and so roughly doubles that stage's
 * compute) whenever cfg_weight > 0 — see chatterbox/tts.py's generate(). 0.5 is the
 * library's own default and is left untouched unless explicitly overridden: this is a
 * real quality/speed trade-off (dropping classifier-free guidance changes the voice's
 * expressive character), never a silent default change.
 */
export function resolveTtsCfgWeight(): { cfgWeight: number; source: RuntimeReport["ttsCfgWeightSource"] } {
  const requested = (process.env.TTS_CFG_WEIGHT || "").trim();
  if (!requested) return { cfgWeight: 0.5, source: "default" };
  const parsed = Number(requested);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(
      `TTS_CFG_WEIGHT="${requested}" is not valid. Use a number between 0 and 1 (Chatterbox default: 0.5). ` +
        `0 disables classifier-free guidance in the T3 decode, which roughly halves that stage's compute at the cost of expressiveness.`
    );
  }
  return { cfgWeight: parsed, source: "TTS_CFG_WEIGHT" };
}

/** Interpreter search order for a device: accelerator venv first for non-CPU devices. */
export function resolvePythonForDevice(device: TtsDevice, baseDir: string = process.cwd()): string | null {
  const dirs = device === "cpu" ? [".venv"] : [".venv-xpu", ".venv"];
  for (const d of dirs) {
    const p = venvPython(d, baseDir);
    if (existsSync(p)) return p;
  }
  return null;
}

export function resolveHyperframesEntry(baseDir: string = process.cwd()): string | null {
  const entry = join(baseDir, "node_modules/hyperframes/bin/hyperframes.mjs");
  return existsSync(entry) ? entry : null;
}

function tryExec(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 30000 }).trim();
  } catch {
    return null;
  }
}

function pythonVersionOf(py: string): string | null {
  return tryExec(py, ["-c", "import sys;print('.'.join(map(str,sys.version_info[:3])))"]);
}

function pythonPackageVersion(py: string, pkg: string): string | null {
  return tryExec(py, ["-c", `import importlib.metadata as m;print(m.version('${pkg}'))`]);
}

function pythonVersionSupported(v: string | null): boolean {
  if (!v) return false;
  const [maj, min] = v.split(".").map(Number);
  if (maj !== 3) return false;
  return min >= SUPPORTED_PYTHON.min[1] && min <= SUPPORTED_PYTHON.max[1];
}

/**
 * Resolves the full runtime. Cheap checks only (existence + version probes); it never
 * loads a model. Set `probePython: false` to skip spawning the interpreter.
 */
export function resolveRuntime(options?: { baseDir?: string; probePython?: boolean }): RuntimeReport {
  const baseDir = options?.baseDir ?? process.cwd();
  const probePython = options?.probePython ?? true;
  const problems: RuntimeProblem[] = [];

  // --- node_modules ---
  if (!existsSync(join(baseDir, "node_modules"))) {
    problems.push({
      component: "node_modules",
      message: "Dependencies are not installed.",
      fix: "Run: npm install",
      fatal: true
    });
  }

  // --- TTS device + python ---
  let device: TtsDevice = "cpu";
  let source: RuntimeReport["ttsDeviceSource"] = "default";
  try {
    ({ device, source } = resolveTtsDevice(baseDir));
  } catch (err: any) {
    problems.push({ component: "TTS_DEVICE", message: err.message, fix: "Unset TTS_DEVICE or set it to cpu/xpu.", fatal: true });
  }

  let cfgWeight = 0.5;
  let cfgWeightSource: RuntimeReport["ttsCfgWeightSource"] = "default";
  try {
    ({ cfgWeight, source: cfgWeightSource } = resolveTtsCfgWeight());
  } catch (err: any) {
    problems.push({ component: "TTS_CFG_WEIGHT", message: err.message, fix: "Unset TTS_CFG_WEIGHT or set it to a number between 0 and 1.", fatal: true });
  }

  const py = resolvePythonForDevice(device, baseDir);
  let pyVersion: string | null = null;
  let chatterbox: string | null = null;
  let torch: string | null = null;
  let pyEnv: string | null = null;

  if (!py) {
    problems.push({
      component: "python",
      message: `No virtual environment found for TTS device "${device}".`,
      fix:
        device === "cpu"
          ? "Run: npm run setup:tts   (creates .venv with Python 3.12 + chatterbox-tts)"
          : "Run: npm run setup:tts:xpu   (creates .venv-xpu with the Intel XPU torch build), or set TTS_DEVICE=cpu",
      fatal: true
    });
  } else {
    pyEnv = py.includes(".venv-xpu") ? ".venv-xpu" : ".venv";
    if (probePython) {
      pyVersion = pythonVersionOf(py);
      if (!pythonVersionSupported(pyVersion)) {
        problems.push({
          component: "python",
          message: `Python ${pyVersion ?? "(unknown)"} at ${py} is outside the supported range 3.${SUPPORTED_PYTHON.min[1]}-3.${SUPPORTED_PYTHON.max[1]}.`,
          fix: "Chatterbox's dependency tree has no wheels for newer Python. Recreate the venv: npm run setup:tts",
          fatal: true
        });
      }
      chatterbox = pythonPackageVersion(py, "chatterbox-tts");
      torch = pythonPackageVersion(py, "torch");
      if (!chatterbox) {
        problems.push({
          component: "chatterbox-tts",
          message: `chatterbox-tts is not installed in ${pyEnv}.`,
          fix: "Run: npm run setup:tts",
          fatal: true
        });
      }
      if (device === "xpu" && torch && !torch.includes("xpu")) {
        problems.push({
          component: "torch",
          message: `TTS_DEVICE=xpu but ${pyEnv} has a non-XPU torch build (${torch}).`,
          fix: "Run: npm run setup:tts:xpu, or set TTS_DEVICE=cpu",
          fatal: true
        });
      }
      if (device === "cuda") {
        problems.push({
          component: "torch",
          message: "TTS_DEVICE=cuda requested. This machine's NVIDIA adapter is a legacy part without a modern CUDA runtime.",
          fix: "Use TTS_DEVICE=cpu (reference path) or TTS_DEVICE=xpu.",
          fatal: true
        });
      }
    }
  }

  // --- HyperFrames ---
  const hfEntry = resolveHyperframesEntry(baseDir);
  let hfVersion: string | null = null;
  if (!hfEntry) {
    problems.push({
      component: "hyperframes",
      message: "HyperFrames CLI entry (node_modules/hyperframes/bin/hyperframes.mjs) not found.",
      fix: "Run: npm install",
      fatal: true
    });
  } else {
    try {
      hfVersion = JSON.parse(readFileSync(join(baseDir, "node_modules/hyperframes/package.json"), "utf-8")).version ?? null;
    } catch {
      hfVersion = null;
    }
  }

  // --- ffmpeg / ffprobe ---
  const ffmpegOk = existsSync(FFMPEG_PATH);
  const ffprobeOk = existsSync(FFPROBE_PATH);
  if (!ffmpegOk) {
    problems.push({
      component: "ffmpeg",
      message: `ffmpeg binary not found at ${FFMPEG_PATH}.`,
      fix: "Run: npm install   (ffmpeg-static's install script downloads the binary; ensure install scripts are allowed)",
      fatal: true
    });
  }
  if (!ffprobeOk) {
    problems.push({
      component: "ffprobe",
      message: `ffprobe binary not found at ${FFPROBE_PATH}.`,
      fix: "Run: npm install   (@ffprobe-installer/ffprobe provides the binary)",
      fatal: true
    });
  }

  // Performance expectation: taken from measured runs in this repository; reported, not promised.
  const performanceMode =
    device === "xpu"
      ? "accelerated (measured ~3.1x real-time in pipeline; ~2.1x isolated)"
      : device === "cpu"
        ? "reference (measured ~4.0-4.5x real-time)"
        : "unmeasured";

  return {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    ttsDevice: device,
    ttsDeviceSource: source,
    ttsCfgWeight: cfgWeight,
    ttsCfgWeightSource: cfgWeightSource,
    pythonExecutable: py,
    pythonVersion: pyVersion,
    pythonEnv: pyEnv,
    chatterboxVersion: chatterbox,
    torchVersion: torch,
    hyperframesEntry: hfEntry,
    hyperframesVersion: hfVersion,
    ffmpeg: ffmpegOk ? FFMPEG_PATH : null,
    ffprobe: ffprobeOk ? FFPROBE_PATH : null,
    performanceMode,
    problems
  };
}

export function formatRuntimeReport(r: RuntimeReport): string {
  const line = (k: string, v: string | null) => `  ${k.padEnd(14)} ${v ?? "—"}`;
  const lines = [
    "[RUNTIME] Environment",
    line("platform", `${r.platform} ${r.arch}`),
    line("node", r.node),
    line("tts device", `${r.ttsDevice} (via ${r.ttsDeviceSource})`),
    line(
      "tts cfg_weight",
      r.ttsCfgWeightSource === "default"
        ? `${r.ttsCfgWeight} (default)`
        : `${r.ttsCfgWeight} (via TTS_CFG_WEIGHT — CFG guidance ${r.ttsCfgWeight > 0 ? "on" : "off, voice character will differ"})`
    ),
    line("python", r.pythonExecutable ? `${r.pythonExecutable}${r.pythonVersion ? ` (${r.pythonVersion})` : ""}` : null),
    line("python env", r.pythonEnv),
    line("chatterbox", r.chatterboxVersion),
    line("torch", r.torchVersion),
    line("hyperframes", r.hyperframesVersion ? `${r.hyperframesVersion} (${r.hyperframesEntry})` : null),
    line("ffmpeg", r.ffmpeg),
    line("ffprobe", r.ffprobe),
    line("performance", r.performanceMode)
  ];
  if (r.problems.length > 0) {
    lines.push("", "[RUNTIME] Problems");
    for (const p of r.problems) {
      lines.push(`  ${p.fatal ? "FATAL" : "WARN "} ${p.component}: ${p.message}`);
      lines.push(`        fix: ${p.fix}`);
    }
  }
  return lines.join("\n");
}

/**
 * Preflight for a production run. Prints the report and throws on any fatal problem so
 * a missing dependency is caught before research, not after 40 minutes of TTS.
 */
export function preflight(options?: { baseDir?: string; requireTts?: boolean }): RuntimeReport {
  const report = resolveRuntime({ baseDir: options?.baseDir });
  console.log(formatRuntimeReport(report));
  const fatal = report.problems.filter(
    (p) =>
      p.fatal &&
      (options?.requireTts !== false ||
        !["python", "chatterbox-tts", "torch", "TTS_DEVICE", "TTS_CFG_WEIGHT"].includes(p.component))
  );
  if (fatal.length > 0) {
    throw new Error(
      `[RUNTIME] ${fatal.length} fatal environment problem(s). Fix them and re-run:\n` +
        fatal.map((p) => `  - ${p.component}: ${p.message}\n    ${p.fix}`).join("\n")
    );
  }
  return report;
}

/**
 * Repository artifact policy (spec V2.2 §6).
 *
 * SOURCE and CONFIGURATION are committed. PIPELINE METADATA (checkpoints, hashes, QA
 * reports) is committed so a clone can see what was produced. CACHE (scene WAVs, the
 * concatenated narration, tts-cache.json) and GENERATED MEDIA (renders, final.mp4,
 * snapshots) are deliberately ephemeral: they are large, fully regenerable from the
 * committed artifacts, and the pipeline resumes from whatever survives.
 */
export const ARTIFACT_POLICY = {
  source: ["src/", "test/", "package.json", "tsconfig.json"],
  configuration: ["config/", "design/"],
  pipelineMetadata: [
    "research/research.json",
    "argument/argument.json",
    "script/script.json",
    "storyboard/visual-plan.json",
    "storyboard/storyboard.json",
    "audio/timestamps.json",
    "audio/captions.srt",
    "pipeline-state.json",
    "qa/*.json"
  ],
  cache: ["audio/*.wav", "audio/tts-cache.json", "compositions/", "scenes/*.meta.json"],
  generatedMedia: ["renders/", "final.mp4", "qa/snapshots/"]
} as const;

/**
 * Checks a workspace for the artifacts a fresh clone must be able to regenerate versus
 * those it must already have. Returns what is present and what will be regenerated.
 */
export function inspectWorkspaceArtifacts(workspaceDir: string): {
  present: string[];
  regenerable: string[];
  notes: string[];
} {
  const present: string[] = [];
  const regenerable: string[] = [];
  const notes: string[] = [];

  const check = (rel: string, kind: "metadata" | "cache" | "media") => {
    const abs = join(workspaceDir, rel);
    if (existsSync(abs)) {
      present.push(rel);
    } else if (kind !== "metadata") {
      regenerable.push(rel);
    }
  };

  check("research/research.json", "metadata");
  check("argument/argument.json", "metadata");
  check("script/script.json", "metadata");
  check("storyboard/visual-plan.json", "metadata");
  check("audio/timestamps.json", "metadata");
  check("audio/narration.wav", "cache");
  check("audio/tts-cache.json", "cache");
  check("renders/final-hyperframes.mp4", "media");
  check("final.mp4", "media");

  if (present.includes("audio/timestamps.json") && !present.includes("audio/narration.wav")) {
    notes.push(
      "Alignment metadata exists but narration WAVs are absent (WAVs are ephemeral cache). " +
        "TTS will regenerate scene audio; timings may shift slightly, and downstream visuals will be rebuilt."
    );
  }
  return { present, regenerable, notes };
}

if (process.argv[1]?.endsWith("runtime.ts") || process.argv[1]?.endsWith("runtime.js")) {
  const report = resolveRuntime();
  console.log(formatRuntimeReport(report));
  process.exit(report.problems.some((p) => p.fatal) ? 1 : 0);
}
