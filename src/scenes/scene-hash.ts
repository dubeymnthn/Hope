import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StoryboardScene } from "../schemas/storyboard.js";

export interface SceneHashParams {
  videoId: string;
  scene: StoryboardScene;
  designVersion: string;
  generatorVersion?: string;
  storyboardVersion?: string;
}

let cachedConfigVersions: { visualGenerator?: string; storyboardGenerator?: string } | null = null;

function getConfigVersions(): { visualGenerator: string; storyboardGenerator: string } {
  if (cachedConfigVersions) {
    return {
      visualGenerator: cachedConfigVersions.visualGenerator || "2.0.2",
      storyboardGenerator: cachedConfigVersions.storyboardGenerator || "1.0.0"
    };
  }

  const configPath = resolve(process.cwd(), "config/channel.json");
  if (existsSync(configPath)) {
    try {
      const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
      cachedConfigVersions = {
        visualGenerator: parsed.versions?.visualGenerator,
        storyboardGenerator: parsed.versions?.storyboardGenerator
      };
      return {
        visualGenerator: cachedConfigVersions.visualGenerator || "2.0.2",
        storyboardGenerator: cachedConfigVersions.storyboardGenerator || "1.0.0"
      };
    } catch {
      // fallback
    }
  }

  return {
    visualGenerator: "2.0.2",
    storyboardGenerator: "1.0.0"
  };
}

export function computeSceneFingerprint(params: SceneHashParams): string {
  const configVer = getConfigVersions();
  const {
    videoId,
    scene,
    designVersion,
    generatorVersion = configVer.visualGenerator,
    storyboardVersion = configVer.storyboardGenerator
  } = params;
  
  // Deterministic canonical payload. Everything that changes the rendered HTML must be
  // here, or a plan edit would silently reuse a stale composition (spec V2.2 §2E).
  const canonical = {
    videoId,
    sceneId: scene.id,
    narration: scene.narration.trim(),
    visualDescription: scene.visual_description.trim(),
    onScreenText: scene.on_screen_text.trim(),
    visualType: scene.visual_mode || scene.visual_type,
    duration: Math.round(scene.duration * 100) / 100,
    camera: (scene.camera || "").trim(),
    // Beats drive the GSAP schedule and emphasis; mode payloads drive what is drawn.
    beats: (scene.beats ?? []).map((b) => [
      b.beatId,
      Math.round(b.startOffset * 100) / 100,
      Math.round(b.endOffset * 100) / 100,
      b.changeType ?? "",
      b.visualState ?? "",
      b.focus?.primary ?? "",
      b.holdJustification ? 1 : 0
    ]),
    dataPoints: (scene.data_points ?? []).map((d) => [d.metric, d.value, d.unit ?? "", d.period ?? ""]),
    diagramNodes: scene.diagram_nodes ?? [],
    diagramEdges: scene.diagram_edges ?? [],
    timelineEvents: (scene.timeline_events ?? []).map((e) => [e.when, e.label, e.detail ?? ""]),
    comparisonSides: (scene.comparison_sides ?? []).map((c) => [c.label, c.value ?? "", c.detail ?? ""]),
    sourceReferences: scene.source_references ?? [],
    chapter: scene.chapter ?? "",
    designVersion,
    generatorVersion,
    storyboardVersion
  };

  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}
