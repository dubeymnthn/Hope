import { Router } from "express";
import { startJob, getJob, listJobsForProject, JobScope } from "../services/render-jobs.js";
import { eventBus, StudioEvent } from "../services/events.js";
import { projectGuard, ProjectRequest } from "../middleware/project-guard.js";
import { sendError } from "../services/http-errors.js";

export const renderRouter = Router({ mergeParams: true });
export const jobsRouter = Router();

renderRouter.post("/", projectGuard, (req, res) => {
  try {
    const { projectId, projectDir } = req as ProjectRequest;
    const body = req.body ?? {};
    let scope: JobScope;
    if (body.scope === "full") {
      scope = "full";
    } else if (typeof body.scope === "string" && body.scope.startsWith("scene:")) {
      scope = { scene: body.scope.slice("scene:".length) };
    } else {
      res.status(400).json({ error: "'scope' must be \"full\" or \"scene:<sceneId>\"." });
      return;
    }
    const job = startJob({ projectId, projectDir, scope, topicFallback: projectId });
    res.status(202).json(job);
  } catch (err) {
    sendError(res, err);
  }
});

jobsRouter.get("/", (req, res) => {
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  res.json({ jobs: projectId ? listJobsForProject(projectId) : [] });
});

jobsRouter.get("/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: `Unknown job "${req.params.jobId}".` });
    return;
  }
  res.json(job);
});

/** SSE stream of real events (spec V2.4 §35) — never simulated, only forwarded from the
 * real orchestrator/render-jobs event publishes. */
jobsRouter.get("/:jobId/events", (req, res) => {
  const jobId = req.params.jobId;
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  res.flushHeaders?.();

  const existing = getJob(jobId);
  if (existing) res.write(`data: ${JSON.stringify({ type: "job_state", job: existing })}\n\n`);

  const onEvent = (event: StudioEvent) => {
    if (event.jobId !== jobId) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.type === "job_completed" || event.type === "job_failed") {
      res.end();
    }
  };
  eventBus.on("event", onEvent);
  req.on("close", () => eventBus.off("event", onEvent));
});
