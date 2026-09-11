import { Router } from "express";
import { readQaReports } from "../services/artifact-reader.js";
import { projectGuard, ProjectRequest } from "../middleware/project-guard.js";
import { sendError } from "../services/http-errors.js";

export const qaRouter = Router({ mergeParams: true });

/** Real qa/*.json only — null (not fabricated) when a report hasn't been produced yet. */
qaRouter.get("/", projectGuard, (req, res) => {
  try {
    const { projectDir } = req as ProjectRequest;
    res.json(readQaReports(projectDir));
  } catch (err) {
    sendError(res, err);
  }
});
