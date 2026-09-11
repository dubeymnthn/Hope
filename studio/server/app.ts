import express, { Express, Request, Response, NextFunction } from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { projectsRouter } from "./routes/projects.js";
import { scenesRouter } from "./routes/scenes.js";
import { searchRouter } from "./routes/search.js";
import { audioRouter } from "./routes/audio.js";
import { qaRouter } from "./routes/qa.js";
import { renderRouter, jobsRouter } from "./routes/render.js";
import { mediaRouter } from "./routes/media.js";
import { exportRouter } from "./routes/export.js";
import { revisionsRouter } from "./routes/revisions.js";
import { settingsRouter } from "./routes/settings.js";
import { repoRoot } from "./services/workspace.js";

/**
 * Pure Express app factory — no `listen()` call here, so tests can import and exercise
 * the real app (via `fetch` against a locally started server) without a global side
 * effect on module import. `studio/server/index.ts` is the only place that calls
 * `app.listen()`.
 */
export function createApp(): Express {
  const app = express();
  app.use(express.json({ limit: "5mb" }));

  app.use("/api/projects/:projectId/scenes", scenesRouter);
  app.use("/api/projects/:projectId/search", searchRouter);
  app.use("/api/projects/:projectId/audio", audioRouter);
  app.use("/api/projects/:projectId/qa", qaRouter);
  app.use("/api/projects/:projectId/render", renderRouter);
  app.use("/api/projects/:projectId/export", exportRouter);
  app.use("/api/projects/:projectId/media", mediaRouter);
  app.use("/api/projects/:projectId/revisions", revisionsRouter);
  app.use("/api/projects", projectsRouter);
  app.use("/api/jobs", jobsRouter);
  app.use("/api/settings", settingsRouter);

  // The built frontend, when present (npm run studio builds it first). In dev, the Vite
  // dev server serves the UI instead and proxies /api here — see studio/web/vite.config.ts.
  const webDist = join(repoRoot(), "studio", "web", "dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) {
        next();
        return;
      }
      res.sendFile(join(webDist, "index.html"));
    });
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[studio] Unhandled error:", err);
    res.status(500).json({ error: err?.message ?? String(err) });
  });

  return app;
}
