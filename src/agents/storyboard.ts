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

const CAMERA_MOTIONS = [
  "slow push-in",
  "subtle pan right",
  "slow zoom-in",
  "slow drift down",
  "static",
  "slow pull-out",
  "subtle pan left"
];

export class StoryboardAgent {
  generate(
    script: ScriptResult,
    audio: AudioTimestamps,
    design: ChannelDesign,
    outputDir: string,
    research?: ResearchResult
  ): StoryboardResult {
    console.log(`[STORYBOARD] Dynamically authoring visual storyboard for ${script.scenes.length} scenes aligned to audio...`);

    const timestampMap = new Map<string, { start: number; end: number; duration: number }>();
    for (const sent of audio.sentences) {
      timestampMap.set(sent.sceneId, {
        start: sent.start,
        end: sent.end,
        duration: sent.duration
      });
    }

    // Historical presets for V1 memory topic compatibility
    const legacyPresets: Record<string, {
      type: VisualType;
      mode: VisualMode;
      onScreenText: string;
      description: string;
      animation: string;
      camera: string;
    }> = {
      "scene-001": {
        type: "statistic",
        mode: "data_visualization",
        onScreenText: "+200% TO +500% MEMORY SURGE",
        description: "Massive glowing statistic showing the enterprise DRAM and spot market price explosion across 2024 to 2026.",
        animation: "Count up from +0% to +500% over 1.2s with neon cyan glow and pulsing backdrop.",
        camera: "slow push-in"
      },
      "scene-002": {
        type: "comparison",
        mode: "comparison",
        onScreenText: "THE 3X SILICON PENALTY",
        description: "Split architectural comparison contrasting conventional DDR5 wafer usage with 3D Through-Silicon Via (TSV) HBM stacks.",
        animation: "Wafers slide into view with dimension callouts highlighting the 300% surface area deficit.",
        camera: "subtle pan right"
      },
      "scene-003": {
        type: "timeline",
        mode: "timeline",
        onScreenText: "100% PRODUCTION SOLD OUT",
        description: "Milestone timeline tracking SK Hynix and Micron announcements locking out spot customers through 2026.",
        animation: "Chronological nodes ignite in sequence with critical sell-out milestone badges.",
        camera: "static"
      },
      "scene-004": {
        type: "diagram",
        mode: "technical_diagram",
        onScreenText: "TSMC CoWoS CHOKE POINT",
        description: "Technical cross-section diagram of TSMC CoWoS advanced packaging interposer bonding GPU logic and HBM3e stacks.",
        animation: "Data streams pulse between silicon dies through the interposer with lead time warnings.",
        camera: "slow zoom-in"
      },
      "scene-005": {
        type: "chart",
        mode: "data_visualization",
        onScreenText: "CONSUMER BUFFER COLLAPSE",
        description: "Plunging inventory curve tracking global channel buffers dropping from 16 weeks down to critical 3 weeks.",
        animation: "Dynamic line graph plunges downwards with red warning accenting the supply deficit.",
        camera: "slow drift down"
      },
      "scene-006": {
        type: "text",
        mode: "large_typography",
        onScreenText: "THE AI ECONOMIC TOLLBOOTH",
        description: "Kinetic typography framing HBM as the defining economic choke point of the entire generative AI era.",
        animation: "Words snap into place with camera drift and high-contrast glowing accents.",
        camera: "slow pull-out"
      }
    };

    const scenes: StoryboardScene[] = script.scenes.map((s, index) => {
      const timing = timestampMap.get(s.id) || { start: 0, end: 5, duration: 5 };
      const dur = timing.duration;

      let visualType: VisualType = "data_visualization";
      let visualMode: VisualMode = "data_visualization";
      let onScreenText = s.purpose.toUpperCase();
      let description = s.visual_hint || s.purpose;
      let animation = "Fade in with subtle camera drift";
      let camera = CAMERA_MOTIONS[index % CAMERA_MOTIONS.length];

      // Check legacy preset first if applicable
      if (legacyPresets[s.id] && !s.visualMode) {
        const preset = legacyPresets[s.id];
        visualType = preset.type;
        visualMode = preset.mode;
        onScreenText = preset.onScreenText;
        description = preset.description;
        animation = preset.animation;
        camera = preset.camera;
      } else {
        // Dynamic visual mode inference
        visualMode = this.inferVisualMode(s.visualMode, s.visual_hint, s.narration);
        visualType = visualMode as VisualType;
        onScreenText = this.deriveOnScreenText(s.purpose, s.narration);
        description = s.visual_hint ? `${s.purpose}. ${s.visual_hint}` : s.purpose;
        animation = `Dynamic ${visualMode} animation tailored to spoken narrative`;
      }

      // Generate internal visual beats across the scene duration
      const beats: VisualBeat[] = this.generateVisualBeats(dur, s.purpose, visualMode);

      // Extract relevant data points from research
      const dataPoints: DataPoint[] = this.extractDataPoints(s.narration, research);

      // Extract relevant source citations
      const sources: string[] = research
        ? research.sources.filter((src) => s.narration.toLowerCase().includes(src.title.toLowerCase().slice(0, 10))).map((src) => src.title)
        : [];

      return {
        id: s.id,
        start: timing.start,
        duration: timing.duration,
        narration: s.narration,
        visual_type: visualType,
        visual_mode: visualMode,
        visual_description: description,
        on_screen_text: onScreenText,
        animation,
        camera,
        chapter: s.chapter,
        narrative_purpose: s.purpose,
        beats,
        claims_shown: s.claims || [],
        source_references: sources,
        data_points: dataPoints,
        assets_required: [],
        renderer: "hyperframes"
      };
    });

    const storyboardResult: StoryboardResult = {
      video_title: script.title,
      total_duration: audio.totalDuration,
      target_resolution: "1920x1080",
      target_fps: 30,
      version: "2.0.0",
      scenes
    };

    const storyboardDir = join(outputDir, "storyboard");
    mkdirSync(storyboardDir, { recursive: true });

    const jsonPath = join(storyboardDir, "storyboard.json");
    writeFileSync(jsonPath, JSON.stringify(storyboardResult, null, 2), "utf-8");

    console.log(`[STORYBOARD] Storyboard generated with ${scenes.length} audio-synchronized scenes (${storyboardResult.total_duration}s total).`);
    return storyboardResult;
  }

  private inferVisualMode(explicitMode?: string, hint?: string, narration?: string): VisualMode {
    if (explicitMode) {
      const modeCandidate = explicitMode.toLowerCase().replace(/[-\s]/g, "_");
      const validModes: VisualMode[] = [
        "data_visualization", "technical_diagram", "timeline",
        "supply_chain_flow", "comparison", "process_animation",
        "historical_sequence", "large_typography", "kinetic_emphasis",
        "abstract_metaphor", "chart", "architecture_diagram",
        "ambient_establishing", "evidence_document", "map"
      ];
      if (validModes.includes(modeCandidate as VisualMode)) {
        return modeCandidate as VisualMode;
      }
    }

    const combined = `${hint || ""} ${narration || ""}`.toLowerCase();
    if (combined.includes("percent") || combined.includes("%") || combined.includes("surge") || combined.includes("metric") || combined.includes("price")) {
      return "data_visualization";
    }
    if (combined.includes("versus") || combined.includes("compare") || combined.includes("penalty") || combined.includes("split")) {
      return "comparison";
    }
    if (combined.includes("timeline") || combined.includes("chronology") || combined.includes("history") || combined.includes("sold out")) {
      return "timeline";
    }
    if (combined.includes("diagram") || combined.includes("cross-section") || combined.includes("choke") || combined.includes("packaging")) {
      return "technical_diagram";
    }
    if (combined.includes("inventory") || combined.includes("collapse") || combined.includes("plunge") || combined.includes("chart")) {
      return "chart";
    }
    if (combined.includes("revolution") || combined.includes("future") || combined.includes("tollbooth") || combined.includes("defining")) {
      return "large_typography";
    }

    return "data_visualization";
  }

  private deriveOnScreenText(purpose: string, narration: string): string {
    const words = purpose.replace(/^(Hook viewer with|Explain the|Demonstrate the|Highlight the|Conclude with)/i, "").trim();
    const tokens = words.split(/\s+/).slice(0, 6);
    return tokens.join(" ").toUpperCase();
  }

  private generateVisualBeats(duration: number, purpose: string, visualMode: VisualMode): VisualBeat[] {
    if (duration <= 8) {
      return [
        {
          beatId: "beat-1",
          startOffset: 0,
          endOffset: duration,
          purpose: `Establish ${visualMode}`,
          visualChange: "Initial reveal and key typography hit",
          animationDirective: "Fade and slide into frame"
        }
      ];
    }

    const b1End = Math.round((duration * 0.35) * 10) / 10;
    const b2End = Math.round((duration * 0.75) * 10) / 10;

    return [
      {
        beatId: "beat-1",
        startOffset: 0,
        endOffset: b1End,
        purpose: "Introduce core premise and establish context",
        visualChange: "Display headline callout and primary structure",
        animationDirective: "Hero title entrance with ambient illumination"
      },
      {
        beatId: "beat-2",
        startOffset: b1End,
        endOffset: b2End,
        purpose: "Reveal analytical mechanism or empirical evidence",
        visualChange: "Data curve animation or component cross-section highlighting",
        animationDirective: "Active element draw-in with warning/accent illumination"
      },
      {
        beatId: "beat-3",
        startOffset: b2End,
        endOffset: duration,
        purpose: "Synthesize consequence and transition forward",
        visualChange: "Impact takeaway badge highlights and camera push concludes",
        animationDirective: "Subtle pulse emphasis and prep for scene transition"
      }
    ];
  }

  private extractDataPoints(narration: string, research?: ResearchResult): DataPoint[] {
    const points: DataPoint[] = [];
    if (!research) return points;

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
