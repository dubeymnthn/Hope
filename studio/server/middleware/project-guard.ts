import type { Request, Response, NextFunction } from "express";
import { resolveProjectDir, InvalidProjectIdError } from "../services/workspace.js";

export interface ProjectRequest extends Request {
  projectId: string;
  projectDir: string;
}

/** Resolves and validates `:projectId` for every route under it; never lets raw request input reach a filesystem path unchecked (spec V2.4 §42). */
export function projectGuard(req: Request, res: Response, next: NextFunction): void {
  try {
    const id = String(req.params.projectId);
    const dir = resolveProjectDir(id);
    (req as ProjectRequest).projectId = id;
    (req as ProjectRequest).projectDir = dir;
    next();
  } catch (err) {
    if (err instanceof InvalidProjectIdError) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
}
