import { Router } from "express";
import { projectGuard, ProjectRequest } from "../middleware/project-guard.js";
import { sendError } from "../services/http-errors.js";
import { getProductionSummary } from "../services/production-state.js";
import { startJob } from "../services/render-jobs.js";

export const productionRouter = Router({ mergeParams: true });

productionRouter.get("/", projectGuard, (req, res) => {
  try {
    const { projectDir } = req as ProjectRequest;
    res.json(getProductionSummary(projectDir));
  } catch (err) {
    sendError(res, err);
  }
});

/** The spec §22 "Start Production" action — only this begins TTS/visuals/render. */
productionRouter.post("/start", projectGuard, (req, res) => {
  try {
    const { projectId, projectDir } = req as ProjectRequest;
    const job = startJob({ projectId, projectDir, scope: "produce", topicFallback: projectId });
    res.status(202).json(job);
  } catch (err) {
    sendError(res, err);
  }
});
