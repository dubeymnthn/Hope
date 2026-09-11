import { Router } from "express";
import { projectGuard, ProjectRequest } from "../middleware/project-guard.js";
import { sendError } from "../services/http-errors.js";
import { readProjectArtifacts } from "../services/artifact-reader.js";
import { repoRoot } from "../services/workspace.js";
import { deleteScene, moveScene, overrideClaimProvenance, approveScript, requestScriptRevision } from "../services/script-review.js";

export const scriptReviewRouter = Router({ mergeParams: true });

scriptReviewRouter.get("/", projectGuard, (req, res) => {
  try {
    const { projectDir } = req as ProjectRequest;
    const a = readProjectArtifacts(projectDir);
    res.json({ script: a.script, argument: a.argument, evidenceGraph: a.evidenceGraph });
  } catch (err) {
    sendError(res, err);
  }
});

scriptReviewRouter.delete("/scenes/:sceneId", projectGuard, (req, res) => {
  try {
    const { projectId, projectDir } = req as ProjectRequest;
    res.json(deleteScene(projectId, projectDir, String(req.params.sceneId)));
  } catch (err) {
    sendError(res, err);
  }
});

scriptReviewRouter.post("/scenes/:sceneId/move", projectGuard, (req, res) => {
  try {
    const { projectId, projectDir } = req as ProjectRequest;
    const toIndex = Number(req.body?.toIndex);
    if (!Number.isInteger(toIndex)) throw new Error("`toIndex` must be an integer.");
    res.json(moveScene(projectId, projectDir, String(req.params.sceneId), toIndex));
  } catch (err) {
    sendError(res, err);
  }
});

scriptReviewRouter.post("/scenes/:sceneId/claims/:claimId/override", projectGuard, (req, res) => {
  try {
    const { projectId, projectDir } = req as ProjectRequest;
    const { justification } = req.body ?? {};
    res.json(overrideClaimProvenance(projectId, projectDir, String(req.params.sceneId), String(req.params.claimId), justification));
  } catch (err) {
    sendError(res, err);
  }
});

scriptReviewRouter.post("/approve", projectGuard, async (req, res) => {
  try {
    const { projectDir } = req as ProjectRequest;
    res.json(await approveScript(projectDir));
  } catch (err) {
    sendError(res, err);
  }
});

scriptReviewRouter.post("/request-revision", projectGuard, (req, res) => {
  try {
    const { projectDir } = req as ProjectRequest;
    res.status(202).json(requestScriptRevision(projectDir, repoRoot(), req.body ?? {}));
  } catch (err) {
    sendError(res, err);
  }
});
