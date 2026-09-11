import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { computeSceneFingerprint } from "../../../src/scenes/scene-hash.js";
import { DesignDirectorAgent } from "../../../src/agents/design-director.js";
import { readProjectArtifacts, readTtsCache } from "./artifact-reader.js";

export interface SceneSummary {
  sceneId: string;
  chapter?: string;
  visualMode?: string;
  duration?: number;
  beatCount: number;
  narrationExcerpt: string;
  qaState: "pass" | "fail" | "unknown";
  stale: boolean;
}

export interface SceneDetail extends SceneSummary {
  narration: string;
  purpose: string;
  wordCount: number;
  scriptClaims: any[];
  start?: number;
  visualDescription?: string;
  onScreenText?: string;
  camera?: string;
  animationIntent?: string;
  beats: any[];
  dataPoints: any[];
  visualOpportunities: any[];
  tts: { cached: boolean; duration?: number; generatedAt?: string } | null;
}

function sceneFingerprintStale(projectDir: string, sceneId: string, designVersion: string): boolean {
  const storyboardPath = join(projectDir, "storyboard/storyboard.json");
  const metaPath = join(projectDir, "scenes", `${sceneId}.meta.json`);
  if (!existsSync(storyboardPath) || !existsSync(metaPath)) return false; // nothing rendered yet -> not "stale", just "not produced"
  try {
    const storyboard = JSON.parse(readFileSync(storyboardPath, "utf-8"));
    const scene = storyboard.scenes?.find((s: any) => s.id === sceneId);
    if (!scene) return false;
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    const fresh = computeSceneFingerprint({ videoId: "video-factory", scene, designVersion });
    return meta.fingerprint !== fresh;
  } catch {
    return false;
  }
}

function designVersionOf(projectDir: string): string {
  try {
    return new DesignDirectorAgent().getVersion();
  } catch {
    return "1.0.0";
  }
}

export function listSceneSummaries(projectDir: string): SceneSummary[] {
  const artifacts = readProjectArtifacts(projectDir);
  if (!artifacts.script) return [];
  const designVersion = designVersionOf(projectDir);
  const planByScene = new Map((artifacts.visualPlan?.scenes ?? []).map((s) => [s.sceneId, s]));
  const storyboardByScene = new Map((artifacts.storyboard?.scenes ?? []).map((s) => [s.id, s]));

  return artifacts.script.scenes.map((s): SceneSummary => {
    const plan = planByScene.get(s.id);
    const sb = storyboardByScene.get(s.id);
    return {
      sceneId: s.id,
      chapter: s.chapter,
      visualMode: plan?.visualMode ?? s.visualMode,
      duration: sb?.duration,
      beatCount: plan?.beats?.length ?? 0,
      narrationExcerpt: s.narration.slice(0, 120),
      qaState: "unknown",
      stale: sceneFingerprintStale(projectDir, s.id, designVersion)
    };
  });
}

export function getSceneDetail(projectDir: string, sceneId: string): SceneDetail | null {
  const artifacts = readProjectArtifacts(projectDir);
  const scriptScene = artifacts.script?.scenes.find((s) => s.id === sceneId);
  if (!scriptScene) return null;

  const plan = artifacts.visualPlan?.scenes.find((s) => s.sceneId === sceneId);
  const sb = artifacts.storyboard?.scenes.find((s) => s.id === sceneId);
  const opportunities = (artifacts.visualEvidenceMap?.opportunities ?? []).filter((o) =>
    (scriptScene.scriptClaims ?? []).some((c) => c.evidenceIds.includes(o.claimId))
  );

  const ttsCache = readTtsCache(projectDir);
  const cacheEntry = ttsCache[sceneId];

  const designVersion = designVersionOf(projectDir);

  return {
    sceneId,
    chapter: scriptScene.chapter,
    visualMode: plan?.visualMode ?? scriptScene.visualMode,
    duration: sb?.duration,
    beatCount: plan?.beats?.length ?? 0,
    narrationExcerpt: scriptScene.narration.slice(0, 120),
    qaState: "unknown",
    stale: sceneFingerprintStale(projectDir, sceneId, designVersion),
    narration: scriptScene.narration,
    purpose: scriptScene.purpose,
    wordCount: scriptScene.narration.trim().split(/\s+/).filter(Boolean).length,
    scriptClaims: scriptScene.scriptClaims ?? [],
    start: sb?.start,
    visualDescription: plan?.visualDescription,
    onScreenText: plan?.onScreenText,
    camera: plan?.camera,
    animationIntent: plan?.animationIntent,
    beats: plan?.beats ?? [],
    dataPoints: plan?.dataPoints ?? [],
    visualOpportunities: opportunities,
    tts: cacheEntry ? { cached: true, duration: cacheEntry.duration, generatedAt: cacheEntry.completedAt } : null
  };
}

export function listChapters(projectDir: string): { id: string; title: string; sceneIds: string[] }[] {
  const artifacts = readProjectArtifacts(projectDir);
  return (artifacts.script?.chapters ?? []).map((c) => ({ id: c.id, title: c.title, sceneIds: c.sceneIds ?? [] }));
}

export function listCompositionFiles(projectDir: string): string[] {
  const dir = join(projectDir, "compositions");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".html"));
}
