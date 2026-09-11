import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PipelineStateManager } from "./pipeline-state.js";
import { ResearchResult, ResearchResultSchema } from "../schemas/research.js";
import { ScriptResult, ScriptResultSchema } from "../schemas/script.js";
import { AudioTimestamps, AudioTimestampsSchema } from "../schemas/timestamps.js";
import { StoryboardResult, StoryboardResultSchema } from "../schemas/storyboard.js";
import { ChannelDesign } from "../schemas/design.js";
import { ChannelConfig, ChannelConfigSchema } from "../schemas/channel.js";
import { DesignDirectorAgent } from "../agents/design-director.js";
import { ResearchAgent } from "../agents/researcher.js";
import { ArgumentAgent } from "../agents/argument.js";
import { ScriptAgent } from "../agents/script.js";
import { ScriptQAAgent, ScriptQAReport } from "../agents/script-qa.js";
import { VoiceAgent } from "../agents/voice.js";
import { StoryboardAgent } from "../agents/storyboard.js";
import { VisualSceneAgent } from "../agents/visual-scene.js";
import { VisualStyleQAAgent, VisualStyleQAReport } from "../qa/visual-style.js";
import { HyperFramesRenderer } from "../renderers/hyperframes.js";
import { QAAgent, QAReport } from "../agents/qa.js";
import { FFmpegService } from "../media/ffmpeg.js";

export interface OrchestratorOptions {
  topic: string;
  outputDir?: string;
}

export interface OrchestratorRunResult {
  finalVideoPath: string;
  qaReport: QAReport;
  scriptQAReport?: ScriptQAReport;
  visualQAReport?: VisualStyleQAReport;
}

export class OrchestratorAgent {
  private stateManager: PipelineStateManager;
  private designDirector: DesignDirectorAgent;
  private researchAgent: ResearchAgent;
  private argumentAgent: ArgumentAgent;
  private scriptAgent: ScriptAgent;
  private scriptQaAgent: ScriptQAAgent;
  private voiceAgent: VoiceAgent;
  private storyboardAgent: StoryboardAgent;
  private visualSceneAgent: VisualSceneAgent;
  private visualQaAgent: VisualStyleQAAgent;
  private renderer: HyperFramesRenderer;
  private qaAgent: QAAgent;

  constructor(options?: { stateFilePath?: string }) {
    this.stateManager = new PipelineStateManager(options?.stateFilePath);
    this.designDirector = new DesignDirectorAgent();
    this.researchAgent = new ResearchAgent();
    this.argumentAgent = new ArgumentAgent();
    this.scriptAgent = new ScriptAgent();
    this.scriptQaAgent = new ScriptQAAgent();
    this.voiceAgent = new VoiceAgent();
    this.storyboardAgent = new StoryboardAgent();
    this.visualSceneAgent = new VisualSceneAgent();
    this.visualQaAgent = new VisualStyleQAAgent();
    this.renderer = new HyperFramesRenderer();
    this.qaAgent = new QAAgent();
  }

  async run(options: OrchestratorOptions): Promise<OrchestratorRunResult> {
    const { topic } = options;
    const projectDir = options.outputDir ? resolve(options.outputDir) : process.cwd();

    console.log("\n======================================================");
    console.log("[ORCHESTRATOR] Starting V2 Autonomous Documentary Factory");
    console.log(`[ORCHESTRATOR] Topic: "${topic}"`);
    console.log("======================================================\n");

    const design = this.designDirector.getDesign();
    const designVersion = this.designDirector.getVersion();

    // Load channel configuration
    const configPath = join(projectDir, "config/channel.json");
    let channelConfig: ChannelConfig | undefined;
    if (existsSync(configPath)) {
      try {
        channelConfig = ChannelConfigSchema.parse(JSON.parse(readFileSync(configPath, "utf-8")));
      } catch {
        // fallback
      }
    }

    // 1. Stage: Research Dossier Verification
    console.log("[ORCHESTRATOR] Stage 1: Research Dossier Verification...");
    const research = await this.researchAgent.loadOrValidate(topic, projectDir);

    // 2. Stage: Argument / Thesis Generation
    console.log("[ORCHESTRATOR] Stage 2: Editorial Argument & Thesis Verification...");
    let argument: any = null;
    const argumentJsonPath = join(projectDir, "argument/argument.json");
    if (existsSync(argumentJsonPath)) {
      argument = await this.argumentAgent.loadOrValidate(projectDir);
    } else if (channelConfig?.editorial?.requireThesis) {
      console.warn(`[ORCHESTRATOR] Notice: argument/argument.json not found. To enforce full V2 rigor, ensure ArgumentAgent generates the thesis.`);
    }

    // 3. Stage: Script Verification
    console.log("[ORCHESTRATOR] Stage 3: Long-Form Documentary Script Verification...");
    const script = await this.scriptAgent.loadOrValidate(projectDir);

    // 4. Stage: SCRIPT QA GATE (Pre-TTS Protection)
    console.log("[ORCHESTRATOR] Stage 4: Script QA Gate (Evidence, Editorial, Anti-Slop)...");
    const scriptQAReport = await this.scriptQaAgent.evaluate({
      script,
      research,
      argument: argument || undefined,
      config: channelConfig,
      outputDir: projectDir
    });

    if (scriptQAReport.status === "FAIL") {
      throw new Error(`[ORCHESTRATOR] SCRIPT QA GATE FAILED: Script rejected before synthesis.\nErrors:\n${scriptQAReport.errors.map(e => `  - ${e}`).join("\n")}`);
    }
    console.log(`  ✓ Script QA Gate PASSED with status: ${scriptQAReport.status}\n`);

    // 5. Stage: Voice Narration & Audio Alignment (Resumable)
    console.log("[ORCHESTRATOR] Stage 5: Chatterbox TTS Voice Synthesis (Resumable Mode)...");
    let audio: AudioTimestamps;
    const timestampsPath = join(projectDir, "audio/timestamps.json");
    const narrationWavPath = join(projectDir, "audio/narration.wav");

    if (existsSync(timestampsPath) && existsSync(narrationWavPath)) {
      console.log("  ✓ [Checkpoint] Voice narration and timestamps already verified on disk. Loading cached audio.");
      audio = AudioTimestampsSchema.parse(JSON.parse(readFileSync(timestampsPath, "utf-8")));
    } else {
      audio = await this.voiceAgent.generate(script.scenes, projectDir);
    }

    // 6. Stage: Dynamic Storyboard Generation
    console.log("[ORCHESTRATOR] Stage 6: Dynamic Visual Storyboard Planning...");
    let storyboard: StoryboardResult;
    const storyboardPath = join(projectDir, "storyboard/storyboard.json");

    if (existsSync(storyboardPath)) {
      console.log("  ✓ [Checkpoint] Storyboard already exists on disk. Loading cached storyboard.");
      storyboard = StoryboardResultSchema.parse(JSON.parse(readFileSync(storyboardPath, "utf-8")));
    } else {
      storyboard = this.storyboardAgent.generate(script, audio, design, projectDir, research);
    }

    // 7. Stage: Visual Scenes (Idempotent modular compositions)
    console.log("[ORCHESTRATOR] Stage 7: Modular Visual Scene Generation...");
    await this.visualSceneAgent.generateAllScenes(storyboard, design, designVersion, projectDir);

    // 8. Stage: Visual Style & Repetition QA
    console.log("[ORCHESTRATOR] Stage 8: Visual Style Diversity & Anti-Repetition QA...");
    const visualQAReport = this.visualQaAgent.evaluate({
      storyboard,
      config: channelConfig,
      outputDir: projectDir
    });
    if (visualQAReport.status === "FAIL") {
      console.warn(`[ORCHESTRATOR] Visual Style QA reported errors:\n${visualQAReport.errors.map(e => `  - ${e}`).join("\n")}`);
    }

    // 9. Stage: HyperFrames Check & Render
    console.log("[ORCHESTRATOR] Stage 9: HyperFrames Pre-Render Gate & Rendering...");
    const rawVideoPath = join(projectDir, "renders/final-hyperframes.mp4");
    let hfCheckResult: any;

    if (!existsSync(rawVideoPath)) {
      console.log("  Running HyperFrames check gate...");
      try {
        hfCheckResult = await this.renderer.check(projectDir, { snapshots: true });
      } catch (err: any) {
        console.warn(`  HyperFrames check notice: ${err.message}`);
      }

      await this.renderer.render(projectDir, {
        output: rawVideoPath,
        fps: design.canvas.fps,
        quality: "high"
      });
    } else {
      console.log(`  ✓ [Checkpoint] HyperFrames video already rendered at ${rawVideoPath}`);
    }

    // 10. Stage: Final FFmpeg Assembly & Muxing
    console.log("[ORCHESTRATOR] Stage 10: Final Video Assembly (FFmpeg Broadcast AAC Muxing)...");
    const finalVideoPath = join(projectDir, "final.mp4");
    if (!existsSync(finalVideoPath)) {
      await FFmpegService.muxAudioAndVideo(rawVideoPath, audio.audioPath, finalVideoPath);
      console.log(`  ✓ Audio and visuals muxed into: ${finalVideoPath}`);
    } else {
      console.log(`  ✓ [Checkpoint] Final muxed video already exists at: ${finalVideoPath}`);
    }

    // 11. Stage: Structural & Content QA
    console.log("[ORCHESTRATOR] Stage 11: Final Media QA & Frame Inspection Audit...");
    const srtPath = join(projectDir, "audio/captions.srt");
    const qaReport = await this.qaAgent.evaluate({
      videoPath: finalVideoPath,
      audioPath: audio.audioPath,
      srtPath,
      storyboard,
      script,
      outputDir: projectDir,
      hfCheckResult
    });

    console.log("\n======================================================");
    console.log(`[ORCHESTRATOR] V2 Pipeline Complete with Media QA Status: ${qaReport.status}`);
    console.log(`[ORCHESTRATOR] Deliverable: ${finalVideoPath}`);
    console.log("======================================================\n");

    return {
      finalVideoPath,
      qaReport,
      scriptQAReport,
      visualQAReport
    };
  }
}
