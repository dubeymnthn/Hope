import type { Response } from "express";
import { InvalidProjectIdError } from "./workspace.js";
import { SceneEditValidationError } from "./beat-editor.js";
import { JobAlreadyRunningError } from "./render-jobs.js";
import { ProductionGateError } from "../../../src/orchestrator/production-gate.js";
import { ResearchEditValidationError } from "./research-editor.js";

/** Maps known service-layer error types to the right HTTP status; anything unrecognised is a real 500. */
export function sendError(res: Response, err: unknown): void {
  if (err instanceof InvalidProjectIdError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof SceneEditValidationError || err instanceof ResearchEditValidationError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof JobAlreadyRunningError) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof ProductionGateError) {
    // V2.6: "approve research/script before this action" is a precondition failure, not
    // a server error — same convention export.ts already uses for its own gate.
    res.status(412).json({ error: err.message, phase: err.phase });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("[studio] Unhandled route error:", err);
  res.status(500).json({ error: message });
}
