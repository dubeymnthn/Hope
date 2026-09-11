import { Router } from "express";
import { projectGuard, ProjectRequest } from "../middleware/project-guard.js";
import { sendError } from "../services/http-errors.js";
import { getDesignInfo, saveDesignMd, generateDesignStrategy } from "../services/design-service.js";
import { resolveProjectTopic } from "../services/render-jobs.js";
import { repoRoot } from "../services/workspace.js";

export const designRouter = Router({ mergeParams: true });

designRouter.get("/", projectGuard, (req, res) => {
  try {
    const { projectDir } = req as ProjectRequest;
    res.json(getDesignInfo(projectDir));
  } catch (err) {
    sendError(res, err);
  }
});

designRouter.put("/", projectGuard, (req, res) => {
  try {
    const { projectDir } = req as ProjectRequest;
    const { designMd } = req.body ?? {};
    if (typeof designMd !== "string") throw new Error("`designMd` must be a string.");
    saveDesignMd(projectDir, designMd);
    res.json(getDesignInfo(projectDir));
  } catch (err) {
    sendError(res, err);
  }
});

designRouter.post("/generate", projectGuard, async (req, res) => {
  try {
    const { projectId, projectDir } = req as ProjectRequest;
    const topic = resolveProjectTopic(projectDir, projectId);
    const result = await generateDesignStrategy(topic, projectDir, repoRoot());
    if (result.status === "pending") {
      res.status(202).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});
