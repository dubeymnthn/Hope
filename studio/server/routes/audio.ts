import { Router } from "express";
import { readProjectArtifacts, readTtsCache } from "../services/artifact-reader.js";
import { projectGuard, ProjectRequest } from "../middleware/project-guard.js";
import { sendError } from "../services/http-errors.js";

export const audioRouter = Router({ mergeParams: true });

/** Real per-scene TTS/audio state (spec V2.4 §26) — reads the existing tts-cache.json, invents nothing. */
audioRouter.get("/", projectGuard, (req, res) => {
  try {
    const { projectDir } = req as ProjectRequest;
    const artifacts = readProjectArtifacts(projectDir);
    const cache = readTtsCache(projectDir);

    const scenes = (artifacts.script?.scenes ?? []).map((s) => {
      const entry = cache[s.id];
      return {
        sceneId: s.id,
        cached: !!entry,
        duration: entry?.duration,
        device: artifacts.audio?.measurement?.device,
        generatedAt: entry?.completedAt
      };
    });

    res.json({
      scenes,
      totalDuration: artifacts.audio?.totalDuration ?? null,
      measurement: artifacts.audio?.measurement ?? null,
      captionsAvailable: !!artifacts.audio
    });
  } catch (err) {
    sendError(res, err);
  }
});
