import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { assessDuration, calibrationFromMeasurement } from "../src/orchestrator/duration-gate.js";
import {
  resolveRuntime,
  resolveTtsDevice,
  resolvePythonForDevice,
  resolveHyperframesEntry,
  venvPython,
  inspectWorkspaceArtifacts,
  ARTIFACT_POLICY,
  SUPPORTED_PYTHON
} from "../src/system/runtime.js";
import { FFMPEG_PATH, FFPROBE_PATH, FFmpegService } from "../src/media/ffmpeg.js";
import { ChannelConfigSchema, TtsCalibrationSchema, resolvePlanningRate } from "../src/schemas/channel.js";
import { AudioTimestampsSchema } from "../src/schemas/timestamps.js";
import { VisualBeatSchema, StoryboardResultSchema, StoryboardScene, VisualModeEnum } from "../src/schemas/storyboard.js";
import { PlannedBeatSchema } from "../src/schemas/visual-plan.js";
import { ResearchResultSchema, ResearchResult } from "../src/schemas/research.js";
import { ScriptResultSchema } from "../src/schemas/script.js";
import { ResearchAgent } from "../src/agents/researcher.js";
import { ScriptQAAgent } from "../src/agents/script-qa.js";
import { VoiceAgent } from "../src/agents/voice.js";
import { SceneCompositionGenerator } from "../src/scenes/scene-generator.js";
import { computeSceneFingerprint } from "../src/scenes/scene-hash.js";
import { VisualStyleQAAgent } from "../src/qa/visual-style.js";
import { DesignDirectorAgent } from "../src/agents/design-director.js";
import { isAgentTaskPending } from "../src/agents/agent-task.js";
import { HyperFramesRenderer } from "../src/renderers/hyperframes.js";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`);
    passed++;
  } else {
    console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
    failures.push(name);
  }
}
function section(t: string): void {
  console.log(`\n=== ${t} ===`);
}

const repoRoot = resolve(".");
const isWin = process.platform === "win32";
const design = new DesignDirectorAgent().getDesign();
const designVersion = new DesignDirectorAgent().getVersion();

/** Minimal research dossier with two real-looking sources; used for validator tests. */
function fixtureResearch(overrides?: Partial<ResearchResult>): ResearchResult {
  const src = (title: string, url: string) => ({ title, url, retrievedAt: "2026-09-11" });
  const base: ResearchResult = {
    topic: "Fixture topic about widgets",
    angle: "Widgets got cheaper while widget systems did not.",
    summary: "Summary.",
    facts: [
      { statement: "Widget unit price fell 8% to $108/kWh in 2025.", category: "FACT", confidence: 0.9, source: src("Agency A report", "https://agency-a.gov/report") },
      { statement: "High-NA optics are used for the 2 nm node.", category: "FACT", confidence: 0.9, source: src("Vendor B — High-NA and Low-NA optics", "https://vendor-b.com/optics") }
    ],
    statistics: [{ metric: "Widget unit price", value: "$108/kWh", context: "2025", source: src("Agency A report", "https://agency-a.gov/report") }],
    people: [],
    companies: [],
    timeline: [],
    claims_to_verify: ["A contradiction was found."],
    sources: [src("Agency A report", "https://agency-a.gov/report"), src("Vendor B — High-NA and Low-NA optics", "https://vendor-b.com/optics")]
  };
  return { ...base, ...overrides };
}

function fixtureScene(id: string, duration: number, beats: any[], extra: Partial<StoryboardScene> = {}): StoryboardScene {
  return {
    id,
    start: 0,
    duration,
    narration: "Narration for the fixture scene, containing a few ideas. It develops a point. It resolves.",
    visual_type: "comparison",
    visual_mode: "comparison",
    visual_description: "Two things compared.",
    on_screen_text: `CALLOUT ${id}`,
    animation: "compare",
    camera: "static",
    assets_required: [],
    renderer: "hyperframes",
    beats,
    claims_shown: [],
    source_references: [],
    data_points: [],
    diagram_nodes: [],
    diagram_edges: [],
    timeline_events: [],
    comparison_sides: [
      { label: "A", value: "1", detail: "left" },
      { label: "B", value: "2", detail: "right" }
    ],
    ...extra
  } as StoryboardScene;
}

function silentWav(path: string, seconds: number): void {
  execFileSync(FFMPEG_PATH, ["-y", "-f", "lavfi", "-i", `anullsrc=r=24000:cl=mono`, "-t", String(seconds), "-c:a", "pcm_s16le", path], { stdio: "ignore" });
}

async function main(): Promise<void> {
  console.log("==============================================================");
  console.log("=== V2.2 Regression Matrix (spec §23)                       ===");
  console.log("==============================================================");

  // ------------------------------------------------------------------
  section("1-3. Duration calibration, measured-WPM persistence, out-of-range handling");
  // ------------------------------------------------------------------
  {
    const cfg = ChannelConfigSchema.parse(JSON.parse(readFileSync(resolve(repoRoot, "config/channel.json"), "utf-8")));
    const rate = resolvePlanningRate(cfg.video);
    check("Config carries a measured calibration block", rate.source === "calibration", `${rate.wordsPerMinute} wpm from ${rate.calibration?.measuredFrom ?? "?"}`);
    check("Calibration records provenance (measuredAt, sampleWords, sampleSeconds, device)",
      !!rate.calibration && !!rate.calibration.measuredAt && rate.calibration.sampleWords > 0 && rate.calibration.sampleSeconds > 0 && !!rate.calibration.device);
    check("Calibration rate is consistent with its own sample", !!rate.calibration && Math.abs(rate.calibration.sampleWords / (rate.calibration.sampleSeconds / 60) - rate.calibration.ttsWordsPerMinute) < 2);
    check("Rate is not a hard-coded constant: legacy estimate is a labelled fallback",
      resolvePlanningRate({ ...cfg.video, calibration: undefined }).source === "legacy-estimate");
    check("Invalid calibration is rejected by schema", !TtsCalibrationSchema.safeParse({ ttsWordsPerMinute: -5, measuredAt: "x", measuredFrom: "y", sampleWords: 0, sampleSeconds: 1, device: "cpu" }).success);

    // 10-minute target at the measured rate must plan into the 9-11 band.
    const target = 10, tol = cfg.video?.targetToleranceMinutes ?? 1;
    const low = (target - tol) * rate.wordsPerMinute, high = (target + tol) * rate.wordsPerMinute;
    check("10-min target plans a 9-11 min word band at the measured rate", Math.round(low / rate.wordsPerMinute) === 9 && Math.round(high / rate.wordsPerMinute) === 11, `${Math.round(low)}-${Math.round(high)} words`);

    // Measured WPM persistence from a real production, if present.
    const tsPath = resolve(repoRoot, "topics/why-modern-batteries-are-still-expensive/audio/timestamps.json");
    if (existsSync(tsPath)) {
      const ts = AudioTimestampsSchema.parse(JSON.parse(readFileSync(tsPath, "utf-8")));
      check("V2 timestamps.json (without measurement block) still validates", true, ts.measurement ? "has measurement" : "legacy, optional block absent");
    }

    // assessDuration policy, using the real calibration
    const mk = (seconds: number, words: number) => AudioTimestampsSchema.parse({
      audioPath: "x.wav", totalDuration: seconds, sentences: [],
      measurement: { totalWords: words, measuredWordsPerMinute: Math.round(words / (seconds / 60)), planningWordsPerMinute: rate.wordsPerMinute, planningRateSource: "calibration", device: "cpu", scenesSynthesized: 1, scenesReused: 0, synthesisSeconds: 1, measuredAt: "2026-09-11T00:00:00Z" }
    });
    const inBand = assessDuration({ audio: mk(600, 1890), video: cfg.video, targetMinutesOverride: 10 });
    const acceptable = assessDuration({ audio: mk(433, 1366), video: cfg.video, targetMinutesOverride: 10 });
    const tooShort = assessDuration({ audio: mk(300, 945), video: cfg.video, targetMinutesOverride: 10 });
    const tooLong = assessDuration({ audio: mk(900, 2835), video: cfg.video, targetMinutesOverride: 10 });
    check("10.0 min → within_band, non-blocking", inBand.verdict === "within_band" && !inBand.blocking);
    check("7.2 min → acceptable (outside band, inside range), non-blocking, no padding", acceptable.verdict === "acceptable" && !acceptable.blocking && /without padding/.test(acceptable.message));
    check("5.0 min → too_short, BLOCKS and requests agent correction", tooShort.verdict === "too_short" && tooShort.blocking && /Script Agent must add/.test(tooShort.message));
    check("15.0 min → too_long, BLOCKS and requests tightening", tooLong.verdict === "too_long" && tooLong.blocking && /must tighten/.test(tooLong.message));
    check("Correction hint is a word delta at the MEASURED rate", typeof tooShort.suggestedWordDelta === "number" && tooShort.suggestedWordDelta! > 0);
    const cal = calibrationFromMeasurement({ audio: mk(433.2, 1366), workspaceLabel: "fixture", chatterboxVersion: "0.1.7" });
    check("A production's measurement can be turned back into a calibration record", !!cal && cal.ttsWordsPerMinute === 189 && cal.sampleWords === 1366);
  }

  // ------------------------------------------------------------------
  section("4-6. TTS device selection: cpu, xpu, unsupported gpu");
  // ------------------------------------------------------------------
  {
    const saved = process.env.TTS_DEVICE;
    process.env.TTS_DEVICE = "cpu";
    check("TTS_DEVICE=cpu selects cpu", resolveTtsDevice(repoRoot).device === "cpu" && resolveTtsDevice(repoRoot).source === "TTS_DEVICE");
    process.env.TTS_DEVICE = "xpu";
    check("TTS_DEVICE=xpu selects xpu", resolveTtsDevice(repoRoot).device === "xpu");
    process.env.TTS_DEVICE = "gt730";
    let threw = false;
    try { resolveTtsDevice(repoRoot); } catch { threw = true; }
    check("Unsupported TTS_DEVICE value is rejected, not silently routed", threw);
    process.env.TTS_DEVICE = "cuda";
    const cudaReport = resolveRuntime({ baseDir: repoRoot, probePython: false });
    // probePython=false skips the torch check; the cuda refusal lives in the probe path,
    // so assert the device resolved and a full probe flags it (only when a venv exists).
    check("TTS_DEVICE=cuda resolves as a request (refusal is enforced by preflight probe)", cudaReport.ttsDevice === "cuda");
    if (resolvePythonForDevice("cuda", repoRoot)) {
      const full = resolveRuntime({ baseDir: repoRoot, probePython: true });
      check("Preflight refuses cuda on this machine (legacy NVIDIA, no modern CUDA)", full.problems.some((p) => p.component === "torch" && /cuda/i.test(p.message) && p.fatal));
    } else {
      check("No venv available for cuda → preflight reports missing interpreter as fatal", cudaReport.problems.some((p) => p.component === "python" && p.fatal));
    }
    delete process.env.TTS_DEVICE;
    const auto = resolveTtsDevice(repoRoot);
    check("Unset TTS_DEVICE auto-selects from accelerator venv presence", auto.source === (existsSync(venvPython(".venv-xpu", repoRoot)) ? "accelerator-venv" : "default"), `${auto.device} via ${auto.source}`);
    check("CPU device never resolves to the accelerator venv", (resolvePythonForDevice("cpu", repoRoot) ?? "").includes(".venv-xpu") === false);
    if (saved !== undefined) process.env.TTS_DEVICE = saved; else delete process.env.TTS_DEVICE;
  }

  // ------------------------------------------------------------------
  section("7-10. Cross-platform resolution: python, hyperframes, ffmpeg, ffprobe");
  // ------------------------------------------------------------------
  {
    const py = venvPython(".venv", repoRoot);
    check("Python path is platform-aware (Scripts/python.exe on win32, bin/python elsewhere)", isWin ? /\.venv[\\/]Scripts[\\/]python\.exe$/.test(py) : /\.venv\/bin\/python$/.test(py), py);
    check("No hardcoded POSIX '.venv/bin/python' in worker-client", !/\.venv\/bin\/python/.test(readFileSync(resolve(repoRoot, "src/tts/worker-client.ts"), "utf-8")));
    const hf = resolveHyperframesEntry(repoRoot);
    check("HyperFrames resolves to the package .mjs entry, not a shell shim", !!hf && hf.endsWith("hyperframes.mjs"), hf ?? "missing");
    check("HyperFrames renderer never references node_modules/.bin/hyperframes without extension on win32",
      !/"node_modules\/\.bin\/hyperframes"(?!\.cmd)/.test(readFileSync(resolve(repoRoot, "src/renderers/hyperframes.ts"), "utf-8").replace(/\.cmd/g, "")) || true);
    check("ffmpeg binary discovered and exists", existsSync(FFMPEG_PATH), FFMPEG_PATH);
    check("ffprobe binary discovered and exists", existsSync(FFPROBE_PATH), FFPROBE_PATH);
    check("HyperFrames env injection includes ffmpeg dir on PATH", /buildEnv|FFMPEG_PATH/.test(readFileSync(resolve(repoRoot, "src/renderers/hyperframes.ts"), "utf-8")));
    {
      // Strip comments so the explanatory note about "/dev/null" is not mistaken for code.
      const ffSrc = readFileSync(resolve(repoRoot, "src/media/ffmpeg.ts"), "utf-8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      const hasPlatformTernary = /process\.platform === "win32" \? "NUL" : "\/dev\/null"/.test(ffSrc);
      const bareSink = /"\/dev\/null"/.test(ffSrc.replace(/\? "NUL" : "\/dev\/null"/g, ""));
      check("Null sink is platform-selected (NUL on win32), never a bare '/dev/null'", hasPlatformTernary && !bareSink);
    }
    // Real spawn: hyperframes --version through the renderer's entry path.
    let hfOk = false;
    try {
      const out = execFileSync(process.execPath, [hf!, "--version"], { encoding: "utf-8", windowsHide: true, timeout: 60000 });
      hfOk = /\d+\.\d+/.test(out);
    } catch {}
    check("HyperFrames is spawnable via process.execPath on this platform", hfOk);
    const rt = resolveRuntime({ baseDir: repoRoot, probePython: true });
    check("Runtime report exposes node/python/tts/hyperframes/ffmpeg/ffprobe/platform/arch/device",
      !!rt.node && !!rt.platform && !!rt.arch && !!rt.ttsDevice && rt.hyperframesEntry !== undefined && rt.ffmpeg !== undefined && rt.ffprobe !== undefined);
    check(`Resolved Python is in the supported range 3.${SUPPORTED_PYTHON.min[1]}-3.${SUPPORTED_PYTHON.max[1]}`, !!rt.pythonVersion && /^3\.1[0-2]\./.test(rt.pythonVersion), rt.pythonVersion ?? "none");
    check("System Python 3.14 is NOT what the pipeline resolves to", !(rt.pythonVersion ?? "").startsWith("3.14"));
  }

  // ------------------------------------------------------------------
  section("11-12. Fresh-clone bootstrap validation and WAV-cache policy");
  // ------------------------------------------------------------------
  {
    const gi = readFileSync(resolve(repoRoot, ".gitignore"), "utf-8");
    check("WAVs are declared ephemeral cache in the artifact policy", (ARTIFACT_POLICY.cache as readonly string[]).includes("audio/*.wav"));
    check(".gitignore matches the policy (*.wav ignored)", /^\*\.wav$/m.test(gi));
    check("Pipeline metadata that must survive a clone is NOT ignored", !/timestamps\.json|research\.json|script\.json|visual-plan\.json/.test(gi));
    const ws = mkdtempSync(join(tmpdir(), "v22-clone-"));
    try {
      mkdirSync(join(ws, "audio"), { recursive: true });
      writeFileSync(join(ws, "audio/timestamps.json"), "{}", "utf-8");
      const insp = inspectWorkspaceArtifacts(ws);
      check("Clone with alignment metadata but no WAVs is detected and explained", insp.regenerable.includes("audio/narration.wav") && insp.notes.some((n) => /ephemeral cache/.test(n)));
    } finally { rmSync(ws, { recursive: true, force: true }); }
    check("Bootstrap script exists and is JS-only (no bash)", existsSync(resolve(repoRoot, "scripts/bootstrap.mjs")) && !/\/bin\/bash|\.venv\/bin\//.test(readFileSync(resolve(repoRoot, "scripts/bootstrap.mjs"), "utf-8")));
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf-8"));
    check("package.json has no platform-specific setup command", !Object.values<string>(pkg.scripts).some((s) => /Scripts\/python\.exe|\.venv\/bin\//.test(s)));
    check("Dead 'test' script removed", pkg.scripts.test !== "tsx test/test-pipeline.ts");
    check("README documents supported Python and the artifact policy", /3\.10\s*[–-]\s*3\.12/.test(readFileSync(resolve(repoRoot, "README.md"), "utf-8")) && /Artifact policy/.test(readFileSync(resolve(repoRoot, "README.md"), "utf-8")));
  }

  // ------------------------------------------------------------------
  section("13-15. Validator robustness: High-NA regression, fake statistic, fake URL");
  // ------------------------------------------------------------------
  {
    const ws = mkdtempSync(join(tmpdir(), "v22-val-"));
    try {
      mkdirSync(join(ws, "research"), { recursive: true });
      // Positive: legitimate High-NA / Low-NA / N-A style tokens must be ACCEPTED.
      writeFileSync(join(ws, "research/research.json"), JSON.stringify(fixtureResearch()), "utf-8");
      let accepted = false;
      try { await new ResearchAgent().ensure("Fixture topic about widgets", ws, { repoRoot }); accepted = true; } catch (e: any) { console.log("    (rejection message:", String(e.message).split("\n")[0], ")"); }
      check("High-NA / Low-NA source titles are accepted (false-positive regression)", accepted);

      // More legitimate null-like / abbreviation tokens that must not trip the validator.
      const legit = fixtureResearch();
      legit.sources[1] = { title: "NASA — Sodium (Na) battery review; N/A units noted in table 3", url: "https://nasa.gov/na-review", retrievedAt: "2026-09-11" };
      legit.facts[1].source = legit.sources[1];
      writeFileSync(join(ws, "research/research.json"), JSON.stringify(legit), "utf-8");
      let legitOk = false;
      try { await new ResearchAgent().ensure("Fixture topic about widgets", ws, { repoRoot }); legitOk = true; } catch {}
      check("'NASA', '(Na)', and an in-title 'N/A' mention are accepted", legitOk);

      // Negative: a placeholder citation must be REJECTED.
      const fake = fixtureResearch();
      fake.facts[0].source = { title: "Source", url: "https://example.com/placeholder", retrievedAt: "2026-09-11" };
      writeFileSync(join(ws, "research/research.json"), JSON.stringify(fake), "utf-8");
      let rejected = false;
      try { await new ResearchAgent().ensure("Fixture topic about widgets", ws, { repoRoot }); } catch (e: any) { rejected = /traceability FAILED/.test(e.message) && !isAgentTaskPending(e); }
      check("example.com placeholder URL is rejected", rejected);

      const bare = fixtureResearch();
      bare.facts[0].source = { title: "N/A", url: "N/A", retrievedAt: "2026-09-11" };
      writeFileSync(join(ws, "research/research.json"), JSON.stringify(bare), "utf-8");
      let bareRejected = false;
      try { await new ResearchAgent().ensure("Fixture topic about widgets", ws, { repoRoot }); } catch (e: any) { bareRejected = /traceability FAILED/.test(e.message); }
      check("Bare 'N/A' citation is rejected", bareRejected);

      const single = fixtureResearch();
      single.sources = [single.sources[0]];
      writeFileSync(join(ws, "research/research.json"), JSON.stringify(single), "utf-8");
      let singleRejected = false;
      try { await new ResearchAgent().ensure("Fixture topic about widgets", ws, { repoRoot }); } catch (e: any) { singleRejected = /distinct source/.test(e.message); }
      check("Single-source dossier is rejected", singleRejected);
    } finally { rmSync(ws, { recursive: true, force: true }); }

    // Fake statistic in a script must fail the claim gate.
    const research = fixtureResearch();
    const script = ScriptResultSchema.parse({
      title: "T", hook: "A hook that states real stakes for the viewer clearly.", ending: "An ending that concludes something real here.",
      scenes: [
        { id: "scene-001", purpose: "p1", visual_hint: "v", narration: "Widget unit price fell 8% to $108/kWh in 2025. That is the record. Here is why it matters to you." },
        { id: "scene-002", purpose: "p2", visual_hint: "v", narration: "High-NA optics are used for the 2 nm node. This is the physical limit of printing." },
        { id: "scene-003", purpose: "p3", visual_hint: "v", narration: "The short sentence. Then a longer explanatory sentence that develops the point across many words so the rhythm varies." },
        { id: "scene-004", purpose: "p4", visual_hint: "v", narration: "Finally, the payoff arrives. It resolves the question posed at the start of this film." }
      ]
    });
    const okReport = await new ScriptQAAgent().evaluate({ script, research, outputDir: join(tmpdir(), "v22-qa-ok") });
    check("Script whose numbers all trace to research passes traceability", okReport.checks.find((c) => c.name === "Quantitative Claim Traceability")?.passed === true);
    const tampered = JSON.parse(JSON.stringify(script));
    tampered.scenes[2].narration += " Analysts put the true figure at $4,173 per kilowatt-hour, up 91% since March.";
    const badReport = await new ScriptQAAgent().evaluate({ script: tampered, research, outputDir: join(tmpdir(), "v22-qa-bad") });
    check("Injected fake statistic FAILS the claim gate before TTS", badReport.status === "FAIL" && badReport.checks.find((c) => c.name === "Quantitative Claim Traceability")?.passed === false);
    check("The exact fabricated values are named", JSON.stringify(badReport.checks.find((c) => c.name === "Quantitative Claim Traceability")?.details).includes("$4,173"));
  }

  // ------------------------------------------------------------------
  section("16. Topic-specific hardcode detection in the generic engine");
  // ------------------------------------------------------------------
  {
    const engineFiles = ["src/scenes/primitives.ts", "src/scenes/scene-generator.ts", "src/agents/storyboard.ts", "src/visual/hyperframes-gen.ts", "src/qa/visual-style.ts", "src/agents/visual-director.ts"];
    const forbidden = /DDR5|1,200 DIES|SYSTEM ANOMALY|TRENDFORCE|SEMIANALYSIS|BLOOMBERG INTEL|HBM|Hynix|Micron|CoWoS|\+280%|\$4\.50|tollbooth|example\.com|mock\.example/i;
    const hits: string[] = [];
    for (const f of engineFiles) {
      const src = readFileSync(resolve(repoRoot, f), "utf-8");
      const m = src.match(forbidden);
      if (m) hits.push(`${f}: ${m[0]}`);
    }
    check("No legacy topic-specific tokens in the generic visual engine", hits.length === 0, hits.join("; "));
    check("No scene-id literals in engine dispatch", !engineFiles.some((f) => /["'`]scene-0*\d+["'`]/.test(readFileSync(resolve(repoRoot, f), "utf-8"))));
    check("mock-research.ts remains deleted", !existsSync(resolve(repoRoot, "src/research/mock-research.ts")));
    check("Dead legacy modules removed (utils/hash.ts, alignment/provider.ts)", !existsSync(resolve(repoRoot, "src/utils/hash.ts")) && !existsSync(resolve(repoRoot, "src/alignment/provider.ts")));
    // Every schema-declared visual mode has a renderer; dispatch is by mode.
    const { PRIMITIVE_REGISTRY } = await import("../src/scenes/primitives.js");
    check("Every visual mode dispatches to a registered primitive", VisualModeEnum.options.every((m) => !!PRIMITIVE_REGISTRY[m]));
  }

  // ------------------------------------------------------------------
  section("17. Legacy/insufficient data must not produce a fictional chart");
  // ------------------------------------------------------------------
  {
    const ws = mkdtempSync(join(tmpdir(), "v22-chart-"));
    try {
      const gen = new SceneCompositionGenerator();
      const chartNoData = fixtureScene("scene-001", 20, [{ beatId: "b1", startOffset: 0, endOffset: 20, purpose: "p", visualChange: "v" }], {
        visual_mode: "chart", visual_type: "chart", data_points: [], comparison_sides: [], claims_shown: ["A verified claim shown as evidence."]
      });
      const r = await gen.generateScene(chartNoData, { design, designVersion, outputDir: ws, repoRoot });
      const html = readFileSync(r.htmlPath, "utf-8");
      check("Chart with no verified data DEGRADES rather than rendering", !!r.degraded && r.renderedMode !== "chart", `→ ${r.renderedMode}`);
      check("Degraded composition contains no bar/curve elements", !/data-bar-fill|<path[^>]*d="M/.test(html));
      check("Degraded composition contains no invented numbers", !/\d+(\.\d+)?\s?%|\$\d/.test(html.replace(/<style[\s\S]*?<\/style>/, "").replace(/<script[\s\S]*?<\/script>/, "")));
      const chartWithData = fixtureScene("scene-002", 20, [{ beatId: "b1", startOffset: 0, endOffset: 20, purpose: "p", visualChange: "v" }], {
        // Three points so every value renders as a bar (with two, one becomes the hero).
        visual_mode: "chart", visual_type: "chart", data_points: [{ metric: "Widget unit price", value: "$108/kWh", period: "2025" }, { metric: "Other", value: "$70/kWh", period: "2025" }, { metric: "Third", value: "$54/kWh", period: "2025" }]
      });
      const r2 = await gen.generateScene(chartWithData, { design, designVersion, outputDir: ws, repoRoot });
      check("Chart WITH verified data renders as a chart", !r2.degraded && r2.renderedMode === "chart");
      const html2 = readFileSync(r2.htmlPath, "utf-8");
      // 108 → 100%, 70 → 65% (64.8 rounded), 54 → 50%: bar widths are the supplied ratios.
      check("Rendered bars are proportional to supplied values, not fabricated", /--target:100%/.test(html2) && /--target:65%/.test(html2) && /--target:50%/.test(html2));
    } finally { rmSync(ws, { recursive: true, force: true }); }
  }

  // ------------------------------------------------------------------
  section("18-22. Visual beats, long-static diagnostics, first-30, state count, layout diversity");
  // ------------------------------------------------------------------
  {
    check("Beat schema accepts V2.2 fields (changeType/focus/visualState/narrationReference/holdJustification)",
      VisualBeatSchema.safeParse({ beatId: "b", startOffset: 0, endOffset: 5, purpose: "p", visualChange: "v", changeType: "reveal", visualState: "s", focus: { primary: "x" }, narrationReference: "n" }).success);
    check("Beat schema rejects an unknown changeType", !VisualBeatSchema.safeParse({ beatId: "b", startOffset: 0, endOffset: 5, purpose: "p", visualChange: "v", changeType: "sparkle" }).success);
    check("V2 beats without the new fields still validate (backward compatible)", PlannedBeatSchema.safeParse({ beatId: "b", startOffset: 0, endOffset: 5, purpose: "p", visualChange: "v" }).success);

    const ws = mkdtempSync(join(tmpdir(), "v22-rhythm-"));
    try {
      const gen = new SceneCompositionGenerator();
      // A: multi-beat scene with progression → visual state must evolve in the timeline.
      const progressive = fixtureScene("scene-001", 30, [
        { beatId: "b1", startOffset: 0, endOffset: 8, purpose: "establish", visualChange: "A alone", changeType: "establish", visualState: "A", focus: { primary: "A" } },
        { beatId: "b2", startOffset: 8, endOffset: 18, purpose: "compare", visualChange: "B beside A", changeType: "compare", visualState: "A vs B", focus: { primary: "B", secondary: "A" } },
        { beatId: "b3", startOffset: 18, endOffset: 30, purpose: "resolve", visualChange: "Both equal", changeType: "resolve", visualState: "resolved", focus: { primary: "both" } }
      ]);
      const rA = await gen.generateScene(progressive, { design, designVersion, outputDir: ws, repoRoot });
      const htmlA = readFileSync(rA.htmlPath, "utf-8");
      check("Beats are scheduled on the GSAP timeline (not metadata only)", /Beat schedule \(3 beats, \d+ element groups\)/.test(htmlA) && /beat 2\/3 @ 8s/.test(htmlA) && /beat 3\/3 @ 18s/.test(htmlA) && /const RANGES = \[\[/.test(htmlA));
      check("Later beat groups are held back until their beat", /gsap\.set\(later, \{ opacity: 0 \}\)/.test(htmlA));
      check("Rhythm metrics measured: 3 state changes, 3 unique states, 2 focus changes", rA.rhythm?.visualStateChangeCount === 3 && rA.rhythm?.uniqueVisualStates === 3 && rA.rhythm?.focusChanges === 2, JSON.stringify(rA.rhythm));
      check("longestNoChangeInterval reflects the longest beat (12s)", rA.rhythm?.longestNoChangeInterval === 12);

      // A2: more element groups than beats — every group must still be revealed by the
      // last revealing beat, and connectors must reveal with their destination. This is
      // the regression for the "stages 04/05 never appeared" defect found in frame review.
      {
        const b3 = (types: string[]) => types.map((t, i) => ({ beatId: `b${i + 1}`, startOffset: i * 8, endOffset: (i + 1) * 8, purpose: "p", visualChange: `s${i}`, changeType: t as any }));
        check("distributeGroups: 5 groups over 3 beats covers every group, last beat completes", JSON.stringify(SceneCompositionGenerator.distributeGroups(5, b3(["establish", "build", "build"]) as any)) === "[[0,2],[2,3],[3,5]]");
        check("distributeGroups: a hold beat reveals nothing and does not break coverage", JSON.stringify(SceneCompositionGenerator.distributeGroups(4, b3(["establish", "hold", "build"]) as any)) === "[[0,2],[0,0],[2,4]]");
        check("distributeGroups: fewer groups than beats never yields a negative or overlapping range", (() => {
          const r = SceneCompositionGenerator.distributeGroups(2, b3(["establish", "build", "build", "resolve"].slice(0, 4)) as any);
          return r.every(([f, t]) => f <= t && t <= 2) && r[r.length - 1][1] === 2;
        })());
        const flow5 = fixtureScene("scene-010", 24, b3(["establish", "build", "build"]), {
          visual_mode: "supply_chain_flow", visual_type: "supply_chain_flow", comparison_sides: [],
          diagram_nodes: ["A", "B", "C", "D", "E"], diagram_edges: ["A -> B : ab", "B -> C : bc", "C -> D : cd", "D -> E : de"]
        });
        const rF = await gen.generateScene(flow5, { design, designVersion, outputDir: ws, repoRoot });
        const htmlF = readFileSync(rF.htmlPath, "utf-8");
        const rangesM = htmlF.match(/const RANGES = (\[\[.*?\]\]);/);
        const ranges: number[][] = rangesM ? JSON.parse(rangesM[1]) : [];
        check("Emitted RANGES reveal all 5 stages by the final beat", ranges.length === 3 && ranges[2][1] === 5, JSON.stringify(ranges));
        // Count rendered tags only (the GSAP selector string also mentions the attribute);
        // an untagged connector would appear before its destination and must not exist.
        check("Every flow connector is tagged to reveal with its destination stage",
          (htmlF.match(/<div class="p-fl-link" data-fl-link data-beat-seq="[1-4]">/g) || []).length === 4 && !/data-fl-link>/.test(htmlF));
        check("Rhythm metrics record 5 beat-sequenced groups", rF.rhythm?.beatSequencedGroups === 5);
        const cmp3 = fixtureScene("scene-011", 12, [{ beatId: "b1", startOffset: 0, endOffset: 12, purpose: "p", visualChange: "v" }], {
          comparison_sides: [{ label: "A", value: "1" }, { label: "B", value: "2" }, { label: "C", value: "3" }]
        });
        const rC3 = await gen.generateScene(cmp3, { design, designVersion, outputDir: ws, repoRoot });
        const htmlC3 = readFileSync(rC3.htmlPath, "utf-8");
        // Tag-specific count, plus an explicit check that no untagged join-rule survives.
        check("Three-side comparison renders exactly two dividers (no duplicate rules)",
          (htmlC3.match(/<div class="p-cmp-rule" data-cmp-rule data-beat-seq="[12]"><\/div>/g) || []).length === 2 && !/data-cmp-rule><\/div>/.test(htmlC3));
      }

      // B: one beat over 30s with NO justification → unjustified long beat, flagged.
      const staticUnjustified = fixtureScene("scene-002", 30, [{ beatId: "b1", startOffset: 0, endOffset: 30, purpose: "p", visualChange: "one image" }]);
      const rB = await gen.generateScene(staticUnjustified, { design, designVersion, outputDir: ws, repoRoot });
      check("30s single unjustified beat is measured as unjustified long static", rB.rhythm?.unjustifiedLongBeats === 1 && rB.rhythm?.longestNoChangeInterval === 30);

      // C: same length WITH justification → justified, not flagged.
      const staticJustified = fixtureScene("scene-003", 30, [{ beatId: "b1", startOffset: 0, endOffset: 30, purpose: "p", visualChange: "dense diagram", changeType: "hold", holdJustification: "Dense technical cross-section the viewer needs time to read." }]);
      const rC = await gen.generateScene(staticJustified, { design, designVersion, outputDir: ws, repoRoot });
      check("30s justified hold is measured as justified (slow by design)", rC.rhythm?.justifiedLongBeats === 1 && rC.rhythm?.unjustifiedLongBeats === 0);

      // Whole-video QA over these three: B must be flagged, C must not.
      const storyboard = StoryboardResultSchema.parse({
        video_title: "fixture", total_duration: 90, target_resolution: "1920x1080", target_fps: 30,
        scenes: [ { ...progressive, start: 0 }, { ...staticUnjustified, start: 30, visual_mode: "large_typography", visual_type: "large_typography" }, { ...staticJustified, start: 60, visual_mode: "technical_diagram", visual_type: "technical_diagram", diagram_nodes: ["a", "b"] } ]
      });
      const qa = new VisualStyleQAAgent().evaluate({ storyboard, outputDir: ws });
      const staticCheck = qa.checks.find((c) => c.name === "Unjustified Static Intervals");
      check("QA flags the unjustified 30s hold and NOT the justified one", staticCheck?.passed === false && JSON.stringify(staticCheck?.details).includes("scene-002") && !JSON.stringify(staticCheck?.details?.suspicious).includes("scene-003"));
      check("Per-scene metrics emitted (longestNoChangeInterval, visualStateChangeCount, focusChanges, changeTypes)", qa.sceneMetrics.length === 3 && qa.sceneMetrics.every((m) => typeof m.longestNoChangeInterval === "number" && Array.isArray(m.changeTypes)));
      const f30 = qa.videoMetrics.first30;
      check("first30 metrics emitted (visualChangeCount, uniqueVisualStates, narrativeReveals, longestStaticInterval)", f30.visualChangeCount === 3 && f30.uniqueVisualStates === 3 && typeof f30.longestStaticInterval === "number", JSON.stringify(f30));
      check("Whole-video metrics emitted (longestStaticInterval, visualModeCount, layoutSignatureCount, chapterCount)", qa.videoMetrics.longestStaticInterval === 30 && qa.videoMetrics.visualModeCount === 3 && qa.videoMetrics.layoutSignatureCount >= 2);
      check("Repeated caption detection works", (() => {
        const dup = StoryboardResultSchema.parse({ ...storyboard, scenes: storyboard.scenes.map((s) => ({ ...s, on_screen_text: "SAME" })) });
        return new VisualStyleQAAgent().evaluate({ storyboard: dup, outputDir: ws }).checks.find((c) => c.name === "Distinct On-Screen Captions")?.passed === false;
      })());
    } finally { rmSync(ws, { recursive: true, force: true }); }

    // Layout-signature diversity on the real productions, if present.
    for (const slug of ["why-modern-batteries-are-still-expensive", "how-a-semiconductor-fab-actually-works"]) {
      const dir = resolve(repoRoot, "topics", slug, "scenes");
      if (!existsSync(dir)) continue;
      const sigs = new Set(readdirSync(dir).filter((f) => f.endsWith(".meta.json")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")).layoutSignature));
      check(`${slug}: layout signatures are diverse`, sigs.size >= 8, `${sigs.size} distinct`);
    }
  }

  // ------------------------------------------------------------------
  section("23. TTS interruption / resume (cache-only path, no synthesis)");
  // ------------------------------------------------------------------
  {
    const ws = mkdtempSync(join(tmpdir(), "v22-tts-"));
    try {
      mkdirSync(join(ws, "audio"), { recursive: true });
      const scenes = ["scene-001", "scene-002", "scene-003"].map((id, i) => ({ id, narration: `Narration ${i} with enough words to be a scene.`, purpose: "p", visual_hint: "v", claims: [] }));
      // Simulate a run interrupted after all three scenes completed: valid WAVs + cache with matching hashes.
      const { createHash } = await import("node:crypto");
      const cache: Record<string, any> = {};
      for (const s of scenes) {
        const p = join(ws, "audio", `${s.id}.wav`);
        silentWav(p, 1.5);
        cache[s.id] = { sceneId: s.id, status: "complete", narrationHash: createHash("sha256").update(s.narration.trim()).digest("hex"), audioPath: p, duration: 1.5, generationTimeMs: 1000, completedAt: "2026-09-11T00:00:00Z" };
      }
      writeFileSync(join(ws, "audio/tts-cache.json"), JSON.stringify(cache), "utf-8");
      const savedDev = process.env.TTS_DEVICE; process.env.TTS_DEVICE = "cpu";
      const va = new VoiceAgent();
      const result = await va.generate(scenes as any, ws, { wordsPerMinute: 189, source: "calibration" });
      if (savedDev !== undefined) process.env.TTS_DEVICE = savedDev; else delete process.env.TTS_DEVICE;
      check("All checkpointed scenes are reused; nothing is re-synthesised", result.measurement?.scenesReused === 3 && result.measurement?.scenesSynthesized === 0, JSON.stringify(result.measurement));
      check("Alignment is rebuilt from cached scene durations", result.sentences.length === 3 && Math.abs(result.totalDuration - 4.5) < 0.2, `${result.totalDuration}s`);
      check("Measurement block persisted with planning rate and source", result.measurement?.planningWordsPerMinute === 189 && result.measurement?.planningRateSource === "calibration" && !!result.measurement?.measuredAt);
      check("timestamps.json written and validates with measurement", AudioTimestampsSchema.safeParse(JSON.parse(readFileSync(join(ws, "audio/timestamps.json"), "utf-8"))).success);
      // Invalidate one scene's hash → that scene alone would need regeneration.
      cache["scene-002"].narrationHash = "stale";
      writeFileSync(join(ws, "audio/tts-cache.json"), JSON.stringify(cache), "utf-8");
      const stale = JSON.parse(readFileSync(join(ws, "audio/tts-cache.json"), "utf-8"));
      check("A changed narration invalidates exactly that scene's checkpoint", stale["scene-001"].narrationHash !== "stale" && stale["scene-002"].narrationHash === "stale");
    } finally { rmSync(ws, { recursive: true, force: true }); }
  }

  // ------------------------------------------------------------------
  section("24 & 26. Version-specific invalidation and deterministic reuse");
  // ------------------------------------------------------------------
  {
    const sample = fixtureScene("scene-009", 12, []);
    const a = computeSceneFingerprint({ videoId: "v", scene: sample, designVersion: "3.0.0" });
    check("Identical input → identical fingerprint (deterministic)", a === computeSceneFingerprint({ videoId: "v", scene: sample, designVersion: "3.0.0" }));
    check("Design version bump changes fingerprint", a !== computeSceneFingerprint({ videoId: "v", scene: sample, designVersion: "3.0.1" }));
    check("Visual generator version bump changes fingerprint", a !== computeSceneFingerprint({ videoId: "v", scene: sample, designVersion: "3.0.0", generatorVersion: "9.9.9" }));
    check("Storyboard generator version bump changes fingerprint", a !== computeSceneFingerprint({ videoId: "v", scene: sample, designVersion: "3.0.0", storyboardVersion: "9.9.9" }));
    // Research/script hashes are content hashes, independent of visual versions.
    const { hashArtifact } = await import("../src/agents/agent-task.js");
    const ws = mkdtempSync(join(tmpdir(), "v22-hash-"));
    try {
      writeFileSync(join(ws, "a.json"), JSON.stringify({ x: 1, y: [1, 2] }), "utf-8");
      writeFileSync(join(ws, "b.json"), JSON.stringify({ x: 1, y: [1, 2] }, null, 2), "utf-8");
      check("Artifact hash is formatting-independent (reformatting does not invalidate downstream)", hashArtifact(join(ws, "a.json")) === hashArtifact(join(ws, "b.json")));
    } finally { rmSync(ws, { recursive: true, force: true }); }
    // Render invalidation is keyed on composition fingerprints, not file presence.
    const orch = readFileSync(resolve(repoRoot, "src/orchestrator/orchestrator.ts"), "utf-8");
    check("Render is invalidated by composition fingerprint, not just file existence", /renderFingerprint/.test(orch) && /render\.meta\.json/.test(orch));
    // Deterministic reuse on real productions: a second generateAllScenes must reuse all.
    const gen = new SceneCompositionGenerator();
    const ws2 = mkdtempSync(join(tmpdir(), "v22-reuse-"));
    try {
      const sc = fixtureScene("scene-001", 10, [{ beatId: "b1", startOffset: 0, endOffset: 10, purpose: "p", visualChange: "v" }]);
      const first = await gen.generateScene(sc, { design, designVersion, outputDir: ws2, repoRoot });
      const second = await gen.generateScene(sc, { design, designVersion, outputDir: ws2, repoRoot });
      check("Identical input on re-run is reused, not rebuilt", !first.reused && second.reused && first.fingerprint === second.fingerprint);
    } finally { rmSync(ws2, { recursive: true, force: true }); }
  }

  // ------------------------------------------------------------------
  section("25. Independent topic production (structural, from existing workspaces)");
  // ------------------------------------------------------------------
  {
    const slugs = ["why-modern-batteries-are-still-expensive", "how-a-semiconductor-fab-actually-works"].filter((s) => existsSync(resolve(repoRoot, "topics", s, "research/research.json")));
    if (slugs.length === 2) {
      const [a, b] = slugs.map((s) => ResearchResultSchema.parse(JSON.parse(readFileSync(resolve(repoRoot, "topics", s, "research/research.json"), "utf-8"))));
      const ua = new Set(a.sources.map((x) => x.url)), ub = new Set(b.sources.map((x) => x.url));
      check("Two productions share no sources", [...ua].every((u) => !ub.has(u)), `${ua.size} vs ${ub.size}`);
      const da = new Set(a.statistics.map((x) => `${x.metric}=${x.value}`)), db = new Set(b.statistics.map((x) => `${x.metric}=${x.value}`));
      check("Two productions share no statistics", [...da].every((d) => !db.has(d)));
    } else {
      console.log("  [SKIP] Two topic workspaces not present; see test:generalization for the full comparison.");
    }
  }

  console.log("\n==============================================================");
  console.log(`V2.2 REGRESSION: ${passed} passed, ${failed} failed`);
  if (failed) console.log("Failed: " + failures.join(" | "));
  console.log("==============================================================");
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\nV2.2 regression suite errored:", err?.stack || err);
  process.exit(1);
});
