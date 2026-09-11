import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { PipelineStateManager } from "./pipeline-state.js";
import { assessDuration, DurationAssessment } from "./duration-gate.js";
import { AudioTimestamps, AudioTimestampsSchema } from "../schemas/timestamps.js";
import { StoryboardResult } from "../schemas/storyboard.js";
import { ChannelConfig, ChannelConfigSchema, resolvePlanningRate } from "../schemas/channel.js";
import { DesignDirectorAgent } from "../agents/design-director.js";
import { ResearchAgent } from "../agents/researcher.js";
import { ResearchPlannerAgent } from "../agents/research-planner.js";
import { EvidenceGraphAgent } from "../agents/evidence-graph.js";
import { VisualEvidenceMapperAgent } from "../agents/visual-evidence-mapper.js";
import { ArgumentAgent } from "../agents/argument.js";
import { ScriptAgent } from "../agents/script.js";
import { ScriptQAAgent, ScriptQAReport } from "../agents/script-qa.js";
import { VoiceAgent } from "../agents/voice.js";
import { VisualDirectorAgent } from "../agents/visual-director.js";
import { StoryboardAgent } from "../agents/storyboard.js";
import { VisualSceneAgent } from "../agents/visual-scene.js";
import { VisualStyleQAAgent, VisualStyleQAReport } from "../qa/visual-style.js";
import { HyperFramesRenderer } from "../renderers/hyperframes.js";
import { QAAgent, QAReport } from "../agents/qa.js";
import { FFmpegService } from "../media/ffmpeg.js";
import { isAgentTaskPending } from "../agents/agent-task.js";
import { preflight, RuntimeReport } from "../system/runtime.js";
import { computeResearchGaps, assessResearchCompleteness, generateResearchGapsMarkdown, CompletenessAssessment } from "../research/gap-detection.js";
import { ResearchCompleteness } from "../schemas/research-gaps.js";

/** A stage-boundary notification (V2.4: additive hook for a live jobs panel). Fired
 * alongside the existing console.log calls in `timed()`/`printStageReport()` — CLI
 * output and behavior are unchanged whether or not a caller supplies this. */
export interface StageEvent {
  type: "stage_started" | "stage_completed" | "stage_failed";
  stage: string;
  detail?: string;
}

export interface OrchestratorOptions {
  topic: string;
  outputDir?: string;
  /** Repository root, where node_modules and shared config live. */
  repoRoot?: string;
  /** Stop after the script QA gate, before the expensive TTS stage. */
  planOnly?: boolean;
  /** Skip the runtime preflight (tests that stub the environment). */
  skipPreflight?: boolean;
  /** Optional live progress hook (V2.4 studio jobs panel); never required by the CLI. */
  onEvent?: (event: StageEvent) => void;
}

/** One line of the stage report (spec V2.2 §21). */
export interface StageRecord {
  stage: string;
  status: "complete" | "cached" | "skipped" | "failed";
  durationMs: number;
  detail?: string;
}

export interface OrchestratorRunResult {
  finalVideoPath: string;
  qaReport: QAReport;
  scriptQAReport?: ScriptQAReport;
  visualQAReport?: VisualStyleQAReport;
  durationAssessment?: DurationAssessment;
  stages: StageRecord[];
  runtime?: RuntimeReport;
}

export class OrchestratorAgent {
  private stateManager: PipelineStateManager;
  private designDirector: DesignDirectorAgent;
  private researchAgent = new ResearchAgent();
  private researchPlannerAgent = new ResearchPlannerAgent();
  private evidenceGraphAgent = new EvidenceGraphAgent();
  private visualEvidenceMapperAgent = new VisualEvidenceMapperAgent();
  private argumentAgent = new ArgumentAgent();
  private scriptAgent = new ScriptAgent();
  private scriptQaAgent = new ScriptQAAgent();
  private voiceAgent: VoiceAgent | null = null;
  private visualDirector = new VisualDirectorAgent();
  private storyboardAgent = new StoryboardAgent();
  private visualSceneAgent = new VisualSceneAgent();
  private visualQaAgent = new VisualStyleQAAgent();
  private renderer = new HyperFramesRenderer();
  private qaAgent = new QAAgent();

  private stages: StageRecord[] = [];
  private onEvent?: (event: StageEvent) => void;

  constructor(options?: { stateFilePath?: string; designPath?: string; versionPath?: string }) {
    this.stateManager = new PipelineStateManager(options?.stateFilePath);
    this.designDirector = new DesignDirectorAgent({
      designPath: options?.designPath,
      versionPath: options?.versionPath
    });
  }

  async run(options: OrchestratorOptions): Promise<OrchestratorRunResult> {
    const { topic } = options;
    const projectDir = options.outputDir ? resolve(options.outputDir) : process.cwd();
    const repoRoot = options.repoRoot ? resolve(options.repoRoot) : process.cwd();
    const runStart = Date.now();
    this.stages = [];
    this.onEvent = options.onEvent;

    console.log("\n======================================================");
    console.log("[ORCHESTRATOR] V2.2 Autonomous Documentary Factory");
    console.log(`[ORCHESTRATOR] Topic: "${topic}"`);
    console.log(`[ORCHESTRATOR] Workspace: ${projectDir}`);
    console.log("======================================================\n");

    // ---- Stage 0: runtime preflight (spec V2.2 §5) ----
    let runtime: RuntimeReport | undefined;
    if (!options.skipPreflight) {
      runtime = await this.timed("runtime", async () => {
        // TTS is only required if we will get past the plan-only gate.
        const r = preflight({ baseDir: repoRoot, requireTts: !options.planOnly });
        return { value: r, status: "complete" as const, detail: `${r.ttsDevice} / ${r.pythonEnv ?? "no-python"}` };
      });
    }

    const design = this.designDirector.getDesign();
    const designVersion = this.designDirector.getVersion();
    const channelConfig = this.loadConfig(projectDir, repoRoot);
    const planningRate = resolvePlanningRate(channelConfig?.video);

    try {
      // ---- Stage 0b: Research Planner (Antigravity) — V2.3, categories + questions ----
      const planResult0 = await this.timed("research-planner", async () => {
        const p = await this.researchPlannerAgent.ensurePlan(topic, projectDir, { repoRoot });
        this.checkpoint("research_planner", "research/research-plan.json", p.artifactHash, {
          topic,
          selectedCategories: p.selectedCategories,
          rejectedCategories: p.rejectedCategories
        });
        return { value: p, status: "complete" as const, detail: `${p.selectedCategories} selected, ${p.rejectedCategories} rejected` };
      });
      const plan = planResult0.plan;

      const questionsResult = await this.timed("research-questions", async () => {
        const q = await this.researchPlannerAgent.ensureQuestions(topic, projectDir, plan, { repoRoot });
        this.checkpoint("research_questions", "research/research-questions.json", q.artifactHash, {
          topic,
          totalQuestions: q.totalQuestions
        });
        return { value: q, status: "complete" as const, detail: `${q.totalQuestions} questions` };
      });
      const questions = questionsResult.questions;

      // ---- Stage 1: Research (Antigravity, unchanged — now plan/questions-aware) ----
      const researchResult = await this.timed("research", async () => {
        const r = await this.researchAgent.ensure(topic, projectDir, {
          repoRoot,
          targetMinutes: channelConfig?.video?.targetDurationMinutes ?? 10,
          plan,
          questions
        });
        this.checkpoint("research", "research/research.json", r.artifactHash, {
          topic,
          facts: r.research.facts.length,
          statistics: r.research.statistics.length,
          distinctSources: r.sourceTraceability.distinctSources,
          supportedMinutes: r.evidenceDepth.estimatedSupportedMinutes
        });
        return { value: r, status: "complete" as const, detail: `${r.research.facts.length} facts, ${r.sourceTraceability.distinctSources} sources` };
      });
      const research = researchResult.research;

      // ---- Stage 1b: Evidence Graph (Antigravity) — V2.3, structured research ----
      const evidenceGraphResult = await this.timed("evidence-graph", async () => {
        const g = await this.evidenceGraphAgent.ensure(topic, projectDir, { plan, questions, research, repoRoot });
        this.checkpoint("evidence_graph", "research/evidence-graph.json", g.artifactHash, g.stats);
        return { value: g, status: "complete" as const, detail: `${g.stats.claims} claims, ${g.stats.sources} sources, ${g.stats.contradictions} contradictions` };
      });
      const evidenceGraph = evidenceGraphResult.graph;

      // ---- Stage 1c: Research completeness — V2.3, deterministic, not agent-gated ----
      let researchGaps: ResearchCompleteness;
      let completenessAssessment: CompletenessAssessment;
      {
        const t0 = Date.now();
        researchGaps = computeResearchGaps({ plan, questions, graph: evidenceGraph });
        const gapsDir = join(projectDir, "research");
        mkdirSync(gapsDir, { recursive: true });
        writeFileSync(join(gapsDir, "research-gaps.json"), JSON.stringify(researchGaps, null, 2), "utf-8");
        writeFileSync(join(gapsDir, "research-report.md"), generateResearchGapsMarkdown(researchGaps), "utf-8");
        completenessAssessment = assessResearchCompleteness(researchGaps, plan);
        const detail = `${researchGaps.overallCompletenessPercent}% complete, ${researchGaps.gaps.length} gap(s)`;
        this.stages.push({
          stage: "research-completeness",
          status: completenessAssessment.blocking ? "failed" : "complete",
          durationMs: Date.now() - t0,
          detail
        });
        this.onEvent?.({ type: completenessAssessment.blocking ? "stage_failed" : "stage_completed", stage: "research-completeness", detail });
        console.log(`[RESEARCH-COMPLETENESS] ${completenessAssessment.message}`);
        if (completenessAssessment.blocking) {
          this.printStageReport(runStart, { planningRate, channelConfig });
          throw new Error(`[ORCHESTRATOR] RESEARCH COMPLETENESS GATE: ${completenessAssessment.message}`);
        }
      }

      // ---- Stage 2: Argument (Antigravity, now evidence-graph-aware) ----
      const argumentResult = await this.timed("argument", async () => {
        const a = await this.argumentAgent.ensure(topic, projectDir, {
          research,
          config: channelConfig,
          repoRoot,
          evidenceGraph,
          researchGaps,
          plan,
          questions
        });
        this.checkpoint("argument", "argument/argument.json", a.artifactHash, {
          topic,
          resolvedDurationMinutes: a.resolvedDurationMinutes,
          supportingClaims: a.argument.supportingClaims.length
        });
        return { value: a, status: "complete" as const, detail: `${a.argument.narrativeProgression.length} phases, ${a.resolvedDurationMinutes} min` };
      });
      const argument = argumentResult.argument;

      // ---- Stage 3: Script (Antigravity, now evidence-graph-aware) ----
      const scriptResult = await this.timed("script", async () => {
        const s = await this.scriptAgent.ensure(topic, projectDir, { argument, config: channelConfig, repoRoot, evidenceGraph });
        this.checkpoint("script", "script/script.json", s.artifactHash, {
          topic,
          scenes: s.script.scenes.length,
          totalWords: s.totalWords,
          estimatedMinutes: s.estimatedMinutes,
          planningWordsPerMinute: planningRate.wordsPerMinute,
          planningRateSource: planningRate.source,
          scriptGeneratorVersion: channelConfig?.versions?.scriptGenerator
        });
        return { value: s, status: "complete" as const, detail: `${s.script.scenes.length} scenes, ${s.totalWords} words, ~${s.estimatedMinutes} min @ ${planningRate.wordsPerMinute} wpm (${planningRate.source})` };
      });
      const script = scriptResult.script;

      // ---- Stage 4: Script QA / claim gate (now checks scriptClaims -> evidence graph traceability) ----
      const scriptQAReport = await this.timed("claim-gate", async () => {
        const r = await this.scriptQaAgent.evaluate({ script, research, argument, config: channelConfig, outputDir: projectDir, evidenceGraph });
        if (r.status === "FAIL") {
          throw new Error(
            `[ORCHESTRATOR] SCRIPT QA GATE FAILED — script rejected before synthesis.\n` +
              `No TTS time will be spent on this script. Errors:\n` +
              r.errors.map((e) => `  - ${e}`).join("\n") +
              `\n\nRevise script/script.json and re-run.`
          );
        }
        return { value: r, status: "complete" as const, detail: r.status };
      });

      // ---- Stage 4b: Visual Evidence Map (Antigravity) — V2.3, claim -> visual reasoning ----
      const visualEvidenceMapResult = await this.timed("visual-evidence-map", async () => {
        const v = await this.visualEvidenceMapperAgent.ensure(topic, projectDir, { script, evidenceGraph, repoRoot });
        this.checkpoint("visual_evidence_map", "visual-evidence/visual-evidence-map.json", v.artifactHash, {
          opportunityCount: v.opportunityCount
        });
        return { value: v, status: "complete" as const, detail: `${v.opportunityCount} visual opportunities` };
      });
      const visualEvidenceMap = visualEvidenceMapResult.map;

      if (options.planOnly) {
        console.log("\n[ORCHESTRATOR] --plan-only set: stopping before TTS as requested.");
        this.printStageReport(runStart, { planningRate, channelConfig });
        throw new Error("PLAN_ONLY_COMPLETE");
      }

      // ---- Stage 5: TTS narration (local Chatterbox, scene-level resume) ----
      const audio = await this.timed("tts", async () => {
        const before = this.readCachedSceneCount(projectDir);
        const a = await this.synthesize(script, projectDir, planningRate);
        const m = a.measurement;
        this.checkpoint("voice", "audio/timestamps.json", undefined, {
          totalDuration: a.totalDuration,
          scenes: a.sentences.length,
          measurement: m
        });
        const detail = m
          ? `${m.scenesReused}/${a.sentences.length} cached, ${m.scenesSynthesized} generated on ${m.device}; ${m.measuredWordsPerMinute} wpm measured`
          : `${before} cached (alignment reused)`;
        return { value: a, status: (m && m.scenesSynthesized > 0 ? "complete" : "cached") as StageRecord["status"], detail };
      });

      // ---- Stage 5b: duration gate — measured, never padded (spec V2.2 §3) ----
      const durationAssessment = assessDuration({
        audio,
        video: channelConfig?.video,
        targetMinutesOverride: argumentResult.resolvedDurationMinutes,
        totalWords: scriptResult.totalWords
      });
      this.stages.push({
        stage: "duration-gate",
        status: durationAssessment.blocking ? "failed" : "complete",
        durationMs: 0,
        detail: `${durationAssessment.actualMinutes.toFixed(1)} min vs target ${durationAssessment.targetMinutes} (${durationAssessment.verdict})`
      });
      console.log(`[DURATION] ${durationAssessment.message}`);
      if (durationAssessment.rateDriftPercent !== null && Math.abs(durationAssessment.rateDriftPercent) > 10) {
        console.warn(
          `[DURATION] Measured rate ${durationAssessment.measuredWordsPerMinute} wpm drifts ${durationAssessment.rateDriftPercent}% from the planning rate ` +
            `${durationAssessment.planningWordsPerMinute} wpm (${durationAssessment.planningRateSource}). Consider recalibrating config.video.calibration.`
        );
      }
      if (durationAssessment.blocking) {
        this.printStageReport(runStart, { planningRate, channelConfig, audio, durationAssessment });
        throw new Error(`[ORCHESTRATOR] DURATION GATE: ${durationAssessment.message}`);
      }

      // ---- Stage 6: Visual direction (Antigravity, now visual-evidence-map/evidence-graph-aware) ----
      const planResult = await this.timed("visual-director", async () => {
        const p = await this.visualDirector.ensure({
          topic,
          script,
          audio,
          research,
          outputDir: projectDir,
          config: channelConfig,
          repoRoot,
          visualEvidenceMap,
          evidenceGraph
        });
        this.checkpoint("visual_direction", "storyboard/visual-plan.json", p.artifactHash, {
          scenes: p.plan.scenes.length,
          tracedDataPoints: p.dataIntegrity.tracedDataPoints,
          totalDataPoints: p.dataIntegrity.totalDataPoints
        });
        return { value: p, status: "complete" as const, detail: `${p.plan.scenes.length} scenes, ${p.dataIntegrity.tracedDataPoints}/${p.dataIntegrity.totalDataPoints} data points traced` };
      });

      // ---- Stage 7: Storyboard assembly (deterministic) ----
      const storyboard = await this.timed("alignment", async () => {
        const sb: StoryboardResult = this.storyboardAgent.assemble({ script, audio, plan: planResult.plan, outputDir: projectDir, design, research });
        this.checkpoint("storyboard", "storyboard/storyboard.json", undefined, {
          scenes: sb.scenes.length,
          totalDuration: sb.total_duration,
          storyboardGeneratorVersion: channelConfig?.versions?.storyboardGenerator
        });
        return { value: sb, status: "complete" as const, detail: `${sb.scenes.length} scenes aligned to ${sb.total_duration}s` };
      });

      // ---- Stage 8: Visual scene rendering ----
      const sceneResults = await this.timed("compositions", async () => {
        const results = await this.visualSceneAgent.generateAllScenes(storyboard, design, designVersion, projectDir, repoRoot);
        const reused = results.filter((r) => r.reused).length;
        this.checkpoint("visuals", "index.html", undefined, {
          scenes: results.length,
          reused,
          degraded: results.filter((r) => r.degraded).length,
          visualGeneratorVersion: channelConfig?.versions?.visualGenerator
        });
        return {
          value: results,
          status: (reused === results.length ? "cached" : "complete") as StageRecord["status"],
          detail: `${reused}/${results.length} cached, ${results.length - reused} rebuilt`
        };
      });

      // ---- Stage 9: Visual rhythm & anti-repetition QA ----
      const visualQAReport = await this.timed("visual-qa", async () => {
        const r = this.visualQaAgent.evaluate({
          storyboard,
          config: channelConfig,
          outputDir: projectDir,
          verifiedDataPointCount: planResult.dataIntegrity.tracedDataPoints
        });
        if (r.status === "FAIL") {
          console.warn(`[ORCHESTRATOR] Visual QA reported errors:\n` + r.errors.map((e) => `  - ${e}`).join("\n"));
        }
        const v = r.videoMetrics;
        return {
          value: r,
          status: "complete" as const,
          detail: `${r.status}; ${v.visualModeCount} modes, ${v.layoutSignatureCount} layouts, longest static ${v.longestStaticInterval}s, first30 ${v.first30.visualChangeCount} changes`
        };
      });

      // ---- Stage 10: HyperFrames check + render ----
      const rawVideoPath = join(projectDir, "renders/final-hyperframes.mp4");
      const renderMetaPath = join(projectDir, "renders/render.meta.json");
      let hfCheckResult: any;

      // The render is keyed to the exact compositions it was built from, so bumping the
      // visual generator or design version invalidates the video without touching the
      // research, argument, script or narration checkpoints (spec §30 / V2.2 §2E).
      const renderFingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            scenes: sceneResults.map((r) => [r.sceneId, r.fingerprint]).sort(),
            designVersion,
            fps: design.canvas.fps,
            totalDuration: storyboard.total_duration
          })
        )
        .digest("hex");

      const renderIsCurrent =
        existsSync(rawVideoPath) &&
        existsSync(renderMetaPath) &&
        (() => {
          try {
            return JSON.parse(readFileSync(renderMetaPath, "utf-8")).fingerprint === renderFingerprint;
          } catch {
            return false;
          }
        })();

      await this.timed("hyperframes", async () => {
        if (renderIsCurrent) {
          return { value: null, status: "cached" as const, detail: `render current at ${rawVideoPath}` };
        }
        if (existsSync(rawVideoPath)) console.log("  Visual artifacts changed since the last render; re-rendering.");
        try {
          hfCheckResult = await this.renderer.check(projectDir, { snapshots: true });
        } catch (err: any) {
          console.warn(`  HyperFrames check notice: ${err.message}`);
        }
        const res = await this.renderer.render(projectDir, { output: rawVideoPath, fps: design.canvas.fps, quality: "high" });
        mkdirSync(dirname(renderMetaPath), { recursive: true });
        writeFileSync(renderMetaPath, JSON.stringify({ fingerprint: renderFingerprint, renderedAt: new Date().toISOString() }, null, 2), "utf-8");
        // A fresh render makes any previously muxed deliverable stale.
        const staleFinal = join(projectDir, "final.mp4");
        if (existsSync(staleFinal)) rmSync(staleFinal, { force: true });
        this.checkpoint("render", "renders/final-hyperframes.mp4", undefined, { fps: design.canvas.fps, designVersion, renderTimeMs: res.renderTimeMs });
        return { value: res, status: "complete" as const, detail: `${res.width}x${res.height}@${res.fps} ${res.duration.toFixed(1)}s in ${(res.renderTimeMs / 1000).toFixed(0)}s` };
      });

      // ---- Stage 11: Mux ----
      const finalVideoPath = join(projectDir, "final.mp4");
      await this.timed("ffmpeg", async () => {
        if (existsSync(finalVideoPath)) return { value: null, status: "cached" as const, detail: "final.mp4 present" };
        await FFmpegService.muxAudioAndVideo(rawVideoPath, audio.audioPath, finalVideoPath);
        return { value: null, status: "complete" as const, detail: "h264 + aac muxed" };
      });

      // ---- Stage 12: Media QA ----
      const qaReport = await this.timed("media-qa", async () => {
        const r = await this.qaAgent.evaluate({
          videoPath: finalVideoPath,
          audioPath: audio.audioPath,
          srtPath: join(projectDir, "audio/captions.srt"),
          storyboard,
          script,
          outputDir: projectDir,
          hfCheckResult
        });
        this.checkpoint("qa", "final.mp4", undefined, { qaStatus: r.status });
        return { value: r, status: (r.status === "PASS" ? "complete" : "failed") as StageRecord["status"], detail: `${r.status} (${r.errors.length} errors, ${r.warnings.length} warnings)` };
      });

      this.printStageReport(runStart, { planningRate, channelConfig, audio, durationAssessment, visualQAReport });

      console.log(`[ORCHESTRATOR] Deliverable: ${finalVideoPath}`);
      return { finalVideoPath, qaReport, scriptQAReport, visualQAReport, durationAssessment, stages: this.stages, runtime };
    } catch (err) {
      // An agent-task halt is not a failure; still print what completed so the operator
      // sees where the pipeline is waiting.
      if (isAgentTaskPending(err) && this.stages.length > 0) {
        this.printStageReport(runStart, { planningRate, channelConfig });
      }
      throw err;
    }
  }

  /** Runs a stage, records wall-clock and status, and rethrows on failure. */
  private async timed<T>(
    stage: string,
    fn: () => Promise<{ value: T; status: StageRecord["status"]; detail?: string }>
  ): Promise<T> {
    const t0 = Date.now();
    console.log(`\n[${stage.toUpperCase()}] starting`);
    this.onEvent?.({ type: "stage_started", stage });
    try {
      const { value, status, detail } = await fn();
      this.stages.push({ stage, status, durationMs: Date.now() - t0, detail });
      console.log(`[${stage.toUpperCase()}] ${status}${detail ? ` — ${detail}` : ""} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      this.onEvent?.({ type: "stage_completed", stage, detail });
      return value;
    } catch (err: any) {
      const pending = isAgentTaskPending(err);
      const detail = pending ? "awaiting agent" : String(err?.message ?? err).split("\n")[0].slice(0, 160);
      this.stages.push({
        stage,
        status: pending ? "skipped" : "failed",
        durationMs: Date.now() - t0,
        detail
      });
      this.onEvent?.({ type: "stage_failed", stage, detail });
      throw err;
    }
  }

  /** Stage report with timings and measured rates (spec V2.2 §21). */
  private printStageReport(
    runStart: number,
    ctx: {
      planningRate: ReturnType<typeof resolvePlanningRate>;
      channelConfig?: ChannelConfig;
      audio?: AudioTimestamps;
      durationAssessment?: DurationAssessment;
      visualQAReport?: VisualStyleQAReport;
    }
  ): void {
    const pad = (s: string, n: number) => s.padEnd(n);
    console.log("\n======================================================");
    console.log("[ORCHESTRATOR] Stage report");
    for (const s of this.stages) {
      const secs = s.durationMs >= 1000 ? `${(s.durationMs / 1000).toFixed(1)}s` : `${s.durationMs}ms`;
      console.log(`  [${pad(s.stage.toUpperCase(), 16)}] ${pad(s.status, 9)} ${pad(secs, 9)} ${s.detail ?? ""}`);
    }
    const total = ((Date.now() - runStart) / 1000).toFixed(1);
    console.log(`  total wall-clock: ${total}s`);

    const m = ctx.audio?.measurement;
    const target = ctx.durationAssessment?.targetMinutes ?? ctx.channelConfig?.video?.targetDurationMinutes;
    console.log("\n[ORCHESTRATOR] Measurements");
    console.log(`  planning rate:   ${ctx.planningRate.wordsPerMinute} wpm (${ctx.planningRate.source})`);
    if (m) {
      console.log(`  measured rate:   ${m.measuredWordsPerMinute} wpm over ${m.totalWords} words`);
      console.log(`  tts device:      ${m.device} (${m.scenesReused} cached, ${m.scenesSynthesized} generated${m.realtimeFactor ? `, ${m.realtimeFactor}x real-time` : ""})`);
    }
    if (ctx.audio) {
      console.log(`  target duration: ${target ?? "?"} min`);
      console.log(`  actual duration: ${(ctx.audio.totalDuration / 60).toFixed(2)} min (${ctx.audio.totalDuration}s)${ctx.durationAssessment ? ` — ${ctx.durationAssessment.verdict}` : ""}`);
    }
    if (ctx.visualQAReport) {
      const v = ctx.visualQAReport.videoMetrics;
      console.log(`  visual rhythm:   ${v.totalBeats} beats, longest static ${v.longestStaticInterval}s (${v.longestStaticSceneId}), first30: ${v.first30.visualChangeCount} changes / ${v.first30.uniqueVisualStates} states / ${v.first30.narrativeReveals} reveals`);
      console.log(`  visual variety:  ${v.visualModeCount} modes, ${v.layoutSignatureCount} layouts, ${v.chapterCount} chapters, ${v.verifiedDataPointCount}/${v.dataPointCount} data points verified`);
    }
    console.log("======================================================\n");
  }

  private readCachedSceneCount(projectDir: string): number {
    const p = join(projectDir, "audio/tts-cache.json");
    if (!existsSync(p)) return 0;
    try {
      return Object.keys(JSON.parse(readFileSync(p, "utf-8"))).length;
    } catch {
      return 0;
    }
  }

  /**
   * Reuses existing narration when the alignment covers exactly the current script's
   * scenes and the WAV is present; otherwise runs the resumable VoiceAgent, which itself
   * reuses every valid checkpointed scene.
   */
  private async synthesize(
    script: any,
    projectDir: string,
    planningRate: ReturnType<typeof resolvePlanningRate>
  ): Promise<AudioTimestamps> {
    const timestampsPath = join(projectDir, "audio/timestamps.json");
    const narrationWavPath = join(projectDir, "audio/narration.wav");

    if (existsSync(timestampsPath) && existsSync(narrationWavPath)) {
      try {
        const cached = AudioTimestampsSchema.parse(JSON.parse(readFileSync(timestampsPath, "utf-8")));
        const cachedIds = cached.sentences.map((s) => s.sceneId).join(",");
        const scriptIds = script.scenes.map((s: any) => s.id).join(",");
        if (cachedIds === scriptIds) {
          console.log("  [checkpoint] Narration and alignment already complete. Reusing.");
          return cached;
        }
        console.log("  Script scenes changed since last narration; re-running resumable TTS.");
      } catch {
        console.log("  Existing alignment unreadable; re-running resumable TTS.");
      }
    }

    // The VoiceAgent constructs the TTS client, which resolves device and interpreter;
    // construct lazily so plan-only runs never require a Python environment.
    if (!this.voiceAgent) this.voiceAgent = new VoiceAgent();
    return this.voiceAgent.generate(script.scenes, projectDir, {
      wordsPerMinute: planningRate.wordsPerMinute,
      source: planningRate.source
    });
  }

  private loadConfig(projectDir: string, repoRoot: string): ChannelConfig | undefined {
    for (const dir of [projectDir, repoRoot]) {
      const p = join(dir, "config/channel.json");
      if (existsSync(p)) {
        try {
          return ChannelConfigSchema.parse(JSON.parse(readFileSync(p, "utf-8")));
        } catch (err: any) {
          console.warn(`[ORCHESTRATOR] Ignoring invalid config at ${p}: ${err.message}`);
        }
      }
    }
    return undefined;
  }

  private checkpoint(stage: string, artifact: string, artifactHash: string | undefined, metadata: Record<string, any>): void {
    try {
      this.stateManager.setMilestone(stage, {
        status: "complete",
        artifact,
        artifactHash,
        completedAt: new Date().toISOString(),
        validationVersion: "2.2.0",
        metadata
      });
    } catch (err: any) {
      console.warn(`[ORCHESTRATOR] Could not write checkpoint for "${stage}": ${err.message}`);
    }
  }
}

export { isAgentTaskPending };
