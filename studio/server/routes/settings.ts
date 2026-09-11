import { Router } from "express";
import { resolveRuntime } from "../../../src/system/runtime.js";
import { repoRoot } from "../services/workspace.js";
import { sendError } from "../services/http-errors.js";

export const settingsRouter = Router();

/** Read-only: the same resolveRuntime() the CLI's preflight() uses, never a second implementation. */
settingsRouter.get("/", (_req, res) => {
  try {
    const report = resolveRuntime({ baseDir: repoRoot(), probePython: true });
    res.json(report);
  } catch (err) {
    sendError(res, err);
  }
});
