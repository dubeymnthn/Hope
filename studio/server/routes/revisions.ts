import { Router } from "express";
import { listRevisions, undo, redo } from "../services/revisions.js";
import { projectGuard, ProjectRequest } from "../middleware/project-guard.js";
import { sendError } from "../services/http-errors.js";

export const revisionsRouter = Router({ mergeParams: true });

revisionsRouter.get("/", projectGuard, (req, res) => {
  try {
    const { projectId } = req as ProjectRequest;
    res.json(listRevisions(projectId));
  } catch (err) {
    sendError(res, err);
  }
});

revisionsRouter.post("/undo", projectGuard, (req, res) => {
  try {
    const { projectId, projectDir } = req as ProjectRequest;
    const entry = undo(projectId, projectDir);
    if (!entry) {
      res.status(409).json({ error: "Nothing to undo." });
      return;
    }
    res.json({ undone: entry });
  } catch (err) {
    sendError(res, err);
  }
});

revisionsRouter.post("/redo", projectGuard, (req, res) => {
  try {
    const { projectId, projectDir } = req as ProjectRequest;
    const entry = redo(projectId, projectDir);
    if (!entry) {
      res.status(409).json({ error: "Nothing to redo." });
      return;
    }
    res.json({ redone: entry });
  } catch (err) {
    sendError(res, err);
  }
});
