import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ScriptResult } from "../schemas/script.js";
import { AudioTimestamps } from "../schemas/timestamps.js";
import { ChannelDesign } from "../schemas/design.js";
import {
  StoryboardResult,
  StoryboardScene,
  VisualMode,
  VisualType,
  VisualBeat,
  DataPoint
} from "../schemas/storyboard.js";
import { ResearchResult } from "../schemas/research.js";
import { VisualPlan, VisualPlanScene } from "../schemas/visual-plan.js";

const CAMERA_MOTIONS = [
  "static",
  "slow push-in",
  "subtle pan right",
  "slow drift down",
  "slow pull-out",
  "subtle pan left"
];

/**
 * Storyboard assembly.
 *
 * In the V2 production path this class performs NO creative reasoning. The Antigravity
 * Visual Director decides what every scene shows (storyboard/visual-plan.json); this
 * class deterministically merges that plan with the authoritative audio alignment to
 * produce storyboard/storyboard.json.
 *
 * Timing authority always belongs to the real audio, never to the plan.
 */
export class StoryboardAgent {
  /**
   * V2 production path: merge the Visual Director's plan with real audio timings.
   */
  assemble(params: {
    script: ScriptResult;
    audio: AudioTimestamps;
    plan: VisualPlan;
    outputDir: string;
    design: ChannelDesign;
    research?: ResearchResult;
  }): StoryboardResult {
    const { script, audio, plan, outputDir, design, research } = params;
    console.log(
      `[STORYBOARD] Assembling storyboard from Visual Director plan (${plan.scenes.length} scenes) ` +
        `against authoritative audio alignment...`
    );

    const timing = this.buildTimingMap(audio);
    const planByScene = new Map<string, VisualPlanScene>();
    for (const s of plan.scenes) planByScene.set(s.sceneId, s);

    const scenes: StoryboardScene[] = script.scenes.map((scriptScene) => {
      const planned = planByScene.get(scriptScene.id);
      if (!planned) {
        throw new Error(
          `[STORYBOARD] Visual plan is missing scene "${scriptScene.id}". ` +
            `The Visual Director must cover every script scene.`
        );
      }

      const t = timing.get(scriptScene.id);
      if (!t) {
        throw new Error(
          `[STORYBOARD] No audio alignment for scene "${scriptScene.id}". ` +
            `Scene timing must come from generated narration.`
        );
      }

      return {
        id: scriptScene.id,
        start: t.start,
        duration: t.duration,
        narration: scriptScene.narration,
        visual_type: planned.visualMode as VisualType,
        visual_mode: planned.visualMode,
        visual_description: planned.visualDescription,
        on_screen_text: planned.onScreenText,
        animation: planned.animationIntent,
        camera: planned.camera,
        chapter: scriptScene.chapter,
        narrative_purpose: planned.narrativePurpose,
        beats: this.reconcileBeats(planned, t.duration),
        claims_shown: planned.claimsShown ?? [],
        source_references: planned.sourceReferences ?? [],
        data_points: this.toDataPoints(planned),
        assets_required: [],
        renderer: "hyperframes",
        // Mode-specific payloads the renderer consumes; carried through verbatim.
        diagram_nodes: planned.diagramNodes ?? [],
        diagram_edges: planned.diagramEdges ?? [],
        timeline_events: planned.timelineEvents ?? [],
        comparison_sides: planned.comparisonSides ?? [],
        transition_in: planned.transitionIn
      };
    });

    const result: StoryboardResult = {
      video_title: plan.videoTitle || script.title,
      total_duration: audio.totalDuration,
      target_resolution: `${design.canvas.width}x${design.canvas.height}`,
      target_fps: design.canvas.fps,
      version: "2.0.0",
      scenes
    };

    this.persist(result, outputDir);
    console.log(
      `[STORYBOARD] Assembled ${scenes.length} scenes, ${result.total_duration}s total, ` +
        `${new Set(scenes.map((s) => s.visual_mode)).size} distinct visual modes.`
    );
    return result;
  }

  /**
   * V1 compatibility path.
   *
   * Used by the milestone tests, which predate the Visual Director. It derives scene
   * visuals from the script's own declared hints rather than from any scene-id lookup:
   * there is deliberately no per-scene hardcoding here.
   */
  generate(
    script: ScriptResult,
    audio: AudioTimestamps,
    design: ChannelDesign,
    outputDir: string,
    research?: ResearchResult
  ): StoryboardResult {
    console.log(
      `[STORYBOARD] (compat path) Deriving storyboard for ${script.scenes.length} scenes from ` +
        `script-declared visual hints aligned to audio...`
    );

    const timing = this.buildTimingMap(audio);

    const scenes: StoryboardScene[] = script.scenes.map((s, index) => {
      const t = timing.get(s.id) ?? { start: 0, duration: 5 };
      const visualMode = this.inferVisualMode(s.visualMode, s.visual_hint, s.narration);

      return {
        id: s.id,
        start: t.start,
        duration: t.duration,
        narration: s.narration,
        visual_type: visualMode as VisualType,
        visual_mode: visualMode,
        visual_description: s.visual_hint ? `${s.purpose}. ${s.visual_hint}` : s.purpose,
        on_screen_text: this.deriveOnScreenText(s.purpose),
        animation: `Motion appropriate to ${visualMode.replace(/_/g, " ")}, driven by the narration`,
        camera: CAMERA_MOTIONS[index % CAMERA_MOTIONS.length],
        chapter: s.chapter,
        narrative_purpose: s.purpose,
        beats: this.deriveBeats(t.duration, visualMode),
        claims_shown: s.claims ?? [],
        source_references: [],
        data_points: this.extractDataPoints(s.narration, research),
        assets_required: [],
        renderer: "hyperframes",
        diagram_nodes: [],
        diagram_edges: [],
        timeline_events: [],
        comparison_sides: []
      };
    });

    const result: StoryboardResult = {
      video_title: script.title,
      total_duration: audio.totalDuration,
      target_resolution: `${design.canvas.width}x${design.canvas.height}`,
      target_fps: design.canvas.fps,
      version: "2.0.0",
      scenes
    };

    this.persist(result, outputDir);
    console.log(
      `[STORYBOARD] Storyboard generated with ${scenes.length} audio-synchronized scenes ` +
        `(${result.total_duration}s total).`
    );
    return result;
  }

  private persist(result: StoryboardResult, outputDir: string): void {
    const dir = join(outputDir, "storyboard");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "storyboard.json"), JSON.stringify(result, null, 2), "utf-8");
  }

  private buildTimingMap(audio: AudioTimestamps): Map<string, { start: number; duration: number }> {
    const map = new Map<string, { start: number; duration: number }>();
    for (const sent of audio.sentences) {
      map.set(sent.sceneId, { start: sent.start, duration: sent.duration });
    }
    return map;
  }

  /**
   * Beats come from the Visual Director, but the real audio duration is authoritative.
   * Offsets are clamped into the scene, and the final beat is extended to the scene end so
   * the composition never runs dry before the narration finishes.
   */
  private reconcileBeats(planned: VisualPlanScene, duration: number): VisualBeat[] {
    const sorted = [...planned.beats].sort((a, b) => a.startOffset - b.startOffset);
    const beats: VisualBeat[] = [];

    for (const b of sorted) {
      const start = Math.max(0, Math.min(b.startOffset, duration));
      const end = Math.max(start + 0.1, Math.min(b.endOffset, duration));
      if (start >= duration) continue;
      beats.push({
        beatId: b.beatId,
        startOffset: Math.round(start * 100) / 100,
        endOffset: Math.round(end * 100) / 100,
        purpose: b.purpose,
        visualChange: b.visualChange,
        animationDirective: b.animationDirective
      });
    }

    if (beats.length === 0) {
      return [
        {
          beatId: "beat-1",
          startOffset: 0,
          endOffset: Math.round(duration * 100) / 100,
          purpose: planned.narrativePurpose,
          visualChange: planned.visualDescription,
          animationDirective: planned.animationIntent
        }
      ];
    }

    beats[beats.length - 1].endOffset = Math.round(duration * 100) / 100;
    return beats;
  }

  private toDataPoints(planned: VisualPlanScene): DataPoint[] {
    return (planned.dataPoints ?? []).map((dp) => ({
      metric: dp.metric,
      value: dp.value,
      unit: dp.unit,
      period: dp.period,
      source: dp.sourceId
    }));
  }

  private inferVisualMode(explicitMode?: string, hint?: string, narration?: string): VisualMode {
    const validModes: VisualMode[] = [
      "data_visualization", "technical_diagram", "timeline",
      "supply_chain_flow", "comparison", "process_animation",
      "historical_sequence", "large_typography", "kinetic_emphasis",
      "abstract_metaphor", "chart", "architecture_diagram",
      "ambient_establishing", "evidence_document", "map"
    ];

    if (explicitMode) {
      const candidate = explicitMode.toLowerCase().replace(/[-\s]/g, "_");
      if (validModes.includes(candidate as VisualMode)) return candidate as VisualMode;
    }

    const combined = `${hint || ""} ${narration || ""}`.toLowerCase();
    const signals: Array<[VisualMode, RegExp]> = [
      ["timeline", /\btimeline|chronolog|year by year|sequence of events\b/],
      ["comparison", /\bversus\b|\bvs\b|compare|contrast|side by side|penalty\b/],
      ["technical_diagram", /diagram|cross-?section|architecture|packaging|schematic|how it works\b/],
      ["supply_chain_flow", /supply chain|upstream|downstream|flow|pipeline|logistics\b/],
      ["evidence_document", /filing|report|document|memo|transcript|statement\b/],
      ["map", /\bmap\b|geograph|region|country|continent\b/],
      ["process_animation", /process|step by step|stages|workflow\b/],
      ["data_visualization", /percent|%|surge|price|metric|growth|decline|chart|graph\b/],
      ["large_typography", /defining|fundamental|the real question|bottom line\b/]
    ];

    for (const [mode, pattern] of signals) {
      if (pattern.test(combined)) return mode;
    }
    return "ambient_establishing";
  }

  private deriveOnScreenText(purpose: string): string {
    const cleaned = purpose
      .replace(/^(Hook viewer with|Explain the|Demonstrate the|Highlight the|Conclude with|Introduce the)\s*/i, "")
      .trim();
    return cleaned.split(/\s+/).slice(0, 6).join(" ").toUpperCase();
  }

  private deriveBeats(duration: number, visualMode: VisualMode): VisualBeat[] {
    const label = visualMode.replace(/_/g, " ");
    if (duration <= 8) {
      return [
        {
          beatId: "beat-1",
          startOffset: 0,
          endOffset: Math.round(duration * 100) / 100,
          purpose: `Establish ${label}`,
          visualChange: "Primary structure and typographic hit resolve",
          animationDirective: "Enter and settle"
        }
      ];
    }

    const b1 = Math.round(duration * 0.35 * 10) / 10;
    const b2 = Math.round(duration * 0.75 * 10) / 10;
    return [
      {
        beatId: "beat-1",
        startOffset: 0,
        endOffset: b1,
        purpose: "Establish context",
        visualChange: `Introduce the ${label} and its framing`,
        animationDirective: "Structure resolves into place"
      },
      {
        beatId: "beat-2",
        startOffset: b1,
        endOffset: b2,
        purpose: "Reveal the mechanism or evidence",
        visualChange: "Active elements and supporting values resolve",
        animationDirective: "Progressive reveal of the substantive layer"
      },
      {
        beatId: "beat-3",
        startOffset: b2,
        endOffset: Math.round(duration * 100) / 100,
        purpose: "Land the consequence and hand off",
        visualChange: "Emphasis settles on the takeaway",
        animationDirective: "Hold, then prepare the transition"
      }
    ];
  }

  private extractDataPoints(narration: string, research?: ResearchResult): DataPoint[] {
    if (!research) return [];
    const points: DataPoint[] = [];
    for (const stat of research.statistics) {
      const valClean = stat.value.replace(/[^a-zA-Z0-9%]/g, "").toLowerCase();
      if (valClean && narration.toLowerCase().includes(valClean)) {
        points.push({
          metric: stat.metric,
          value: stat.value,
          period: stat.context,
          source: stat.source?.title
        });
      }
    }
    return points;
  }
}
