import type { Response } from "express";
import { InvalidProjectIdError } from "./workspace.js";
import { SceneEditValidationError } from "./beat-editor.js";

/** Maps known service-layer error types to the right HTTP status; anything unrecognised is a real 500. */
export function sendError(res: Response, err: unknown): void {
  if (err instanceof InvalidProjectIdError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof SceneEditValidationError) {
    res.status(400).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("[studio] Unhandled route error:", err);
  res.status(500).json({ error: message });
}
