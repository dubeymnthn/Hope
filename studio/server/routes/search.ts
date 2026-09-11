import { Router } from "express";
import { buildSearchIndex, search, resolveToTimestamp, SearchRecordKind } from "../../../src/search/index.js";
import { projectGuard, ProjectRequest } from "../middleware/project-guard.js";
import { sendError } from "../services/http-errors.js";

export const searchRouter = Router({ mergeParams: true });

searchRouter.get("/", projectGuard, (req, res) => {
  try {
    const { projectDir } = req as ProjectRequest;
    const q = String(req.query.q ?? "");
    const kind = req.query.kind ? (String(req.query.kind) as SearchRecordKind) : undefined;
    const exact = req.query.exact === "true";
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;

    const records = buildSearchIndex(projectDir);
    const results = search(records, q, { kind, exact, limit }).map((r) => ({
      ...r,
      timestamp: resolveToTimestamp(r, projectDir)
    }));
    res.json({ query: q, total: records.length, results });
  } catch (err) {
    sendError(res, err);
  }
});
