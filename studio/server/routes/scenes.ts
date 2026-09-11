import { Router } from "express";
import { listSceneSummaries, getSceneDetail, listChapters } from "../services/scene-view.js";
import { patchBeat, patchScenePresentational } from "../services/beat-editor.js";
import { patchNarration } from "../services/narration-editor.js";
import { startJob } from "../services/render-jobs.js";
import { projectGuard, ProjectRequest } from "../middleware/project-guard.js";
import { sendError } from "../services/http-errors.js";

export const scenesRouter = Router({ mergeParams: true });

scenesRouter.get("/", projectGuard, (req, res) => {
  try {
    const { projectDir } = req as ProjectRequest;
    res.json({ scenes: listSceneSummaries(projectDir), chapters: listChapters(projectDir) });
  } catch (err) {
    sendError(res, err);
  }
});

scenesRouter.get("/:sceneId", projectGuard, (req, res) => {
  try {
    const { projectDir } = req as ProjectRequest;
    const sceneId = String(req.params.sceneId);
    const detail = getSceneDetail(projectDir, sceneId);
    if (!detail) {
      res.status(404).json({ error: `Unknown scene "${sceneId}".` });
      return;
    }
    res.json(detail);
  } catch (err) {
    sendError(res, err);
  }
});

scenesRouter.patch("/:sceneId", projectGuard, (req, res) => {
  try {
    const { projectId, projectDir } = req as ProjectRequest;
    const sceneId = String(req.params.sceneId);
    const plan = patchScenePresentational(projectId, projectDir, sceneId, req.body);
    res.json(plan.scenes.find((s) => s.sceneId === sceneId));
  } catch (err) {
    sendError(res, err);
  }
});

scenesRouter.patch("/:sceneId/beats/:beatId", projectGuard, (req, res) => {
  try {
    const { projectId, projectDir } = req as ProjectRequest;
    const sceneId = String(req.params.sceneId);
    const beatId = String(req.params.beatId);
    const plan = patchBeat(projectId, projectDir, sceneId, beatId, req.body);
    res.json(plan.scenes.find((s) => s.sceneId === sceneId));
  } catch (err) {
    sendError(res, err);
  }
});

scenesRouter.patch("/:sceneId/narration", projectGuard, async (req, res) => {
  try {
    const { projectId, projectDir } = req as ProjectRequest;
    const sceneId = String(req.params.sceneId);
    const { narration } = req.body ?? {};
    const result = await patchNarration(projectId, projectDir, sceneId, narration);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

scenesRouter.post("/:sceneId/narration/regenerate", projectGuard, (req, res) => {
  try {
    const { projectId, projectDir } = req as ProjectRequest;
    const job = startJob({ projectId, projectDir, scope: "tts", topicFallback: projectId });
    res.status(202).json(job);
  } catch (err) {
    sendError(res, err);
  }
});
