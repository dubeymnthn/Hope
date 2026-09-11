import { Router } from "express";
import { projectGuard, ProjectRequest } from "../middleware/project-guard.js";
import { sendError } from "../services/http-errors.js";
import { readProjectArtifacts } from "../services/artifact-reader.js";
import { repoRoot } from "../services/workspace.js";
import {
  patchQuestion,
  addQuestion,
  patchEvidence,
  addEvidence,
  deleteEvidence,
  previewEvidenceRemovalImpact,
  computeStalenessForProject,
  approveResearch,
  requestMoreResearch
} from "../services/research-editor.js";

export const researchRouter = Router({ mergeParams: true });

researchRouter.get("/", projectGuard, (req, res) => {
  try {
    const { projectDir } = req as ProjectRequest;
    const a = readProjectArtifacts(projectDir);
    res.json({
      plan: a.researchPlan,
      questions: a.researchQuestions,
      evidenceGraph: a.evidenceGraph,
      gaps: a.researchGaps,
      research: a.research
    });
  } catch (err) {
    sendError(res, err);
  }
});

researchRouter.get("/staleness", projectGuard, (req, res) => {
  try {
    const { projectDir } = req as ProjectRequest;
    res.json(computeStalenessForProject(projectDir));
  } catch (err) {
    sendError(res, err);
  }
});

researchRouter.patch("/questions/:questionId", projectGuard, (req, res) => {
  try {
    const { projectId, projectDir } = req as ProjectRequest;
    res.json(patchQuestion(projectId, projectDir, String(req.params.questionId), req.body));
  } catch (err) {
    sendError(res, err);
  }
});

researchRouter.post("/questions", projectGuard, (req, res) => {
  try {
    const { projectId, projectDir } = req as ProjectRequest;
    res.status(201).json(addQuestion(projectId, projectDir, req.body));
  } catch (err) {
    sendError(res, err);
  }
});

researchRouter.patch("/evidence/:evidenceId", projectGuard, (req, res) => {
  try {
    const { projectId, projectDir } = req as ProjectRequest;
    res.json(patchEvidence(projectId, projectDir, String(req.params.evidenceId), req.body));
  } catch (err) {
    sendError(res, err);
  }
});

researchRouter.post("/evidence", projectGuard, (req, res) => {
  try {
    const { projectId, projectDir } = req as ProjectRequest;
    res.status(201).json(addEvidence(projectId, projectDir, req.body));
  } catch (err) {
    sendError(res, err);
  }
});

researchRouter.get("/evidence/:evidenceId/removal-impact", projectGuard, (req, res) => {
  try {
    const { projectDir } = req as ProjectRequest;
    res.json(previewEvidenceRemovalImpact(projectDir, String(req.params.evidenceId)));
  } catch (err) {
    sendError(res, err);
  }
});

researchRouter.delete("/evidence/:evidenceId", projectGuard, (req, res) => {
  try {
    const { projectId, projectDir } = req as ProjectRequest;
    res.json(deleteEvidence(projectId, projectDir, String(req.params.evidenceId)));
  } catch (err) {
    sendError(res, err);
  }
});

researchRouter.post("/request-more", projectGuard, (req, res) => {
  try {
    const { projectDir } = req as ProjectRequest;
    res.status(202).json(requestMoreResearch(projectDir, repoRoot(), req.body ?? {}));
  } catch (err) {
    sendError(res, err);
  }
});

researchRouter.post("/approve", projectGuard, (req, res) => {
  try {
    const { projectDir } = req as ProjectRequest;
    res.json(approveResearch(projectDir));
  } catch (err) {
    sendError(res, err);
  }
});
