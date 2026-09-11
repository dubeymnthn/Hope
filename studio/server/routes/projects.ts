import { Router } from "express";
import { listProjectIds, resolveProjectDir, createProjectWorkspace, lastModified } from "../services/workspace.js";
import { readProjectArtifacts, readQaReports, readPipelineState } from "../services/artifact-reader.js";
import { computeProjectHealth } from "../services/project-health.js";
import { startJob, listJobsForProject } from "../services/render-jobs.js";
import { projectGuard, ProjectRequest } from "../middleware/project-guard.js";
import { sendError } from "../services/http-errors.js";

export const projectsRouter = Router();

function summarize(id: string) {
  const dir = resolveProjectDir(id);
  const artifacts = readProjectArtifacts(dir);
  const qa = readQaReports(dir);
  const health = computeProjectHealth(id, dir);
  const pipelineState = readPipelineState(dir) as any;

  return {
    id,
    title: artifacts.script?.title ?? artifacts.researchPlan?.topic ?? artifacts.research?.topic ?? id,
    topic: artifacts.research?.topic ?? artifacts.researchPlan?.topic ?? artifacts.argument?.topic ?? id,
    runtimeSeconds: artifacts.audio?.totalDuration ?? artifacts.storyboard?.total_duration ?? null,
    sceneCount: artifacts.script?.scenes.length ?? 0,
    chapterCount: artifacts.script?.chapters?.length ?? 0,
    lastModified: lastModified(dir),
    health,
    stages: {
      research: pipelineState?.milestones?.research?.status ?? "pending",
      argument: pipelineState?.milestones?.argument?.status ?? "pending",
      script: pipelineState?.milestones?.script?.status ?? "pending",
      voice: pipelineState?.milestones?.voice?.status ?? "pending",
      visual_direction: pipelineState?.milestones?.visual_direction?.status ?? "pending",
      render: pipelineState?.milestones?.render?.status ?? "pending",
      qa: pipelineState?.milestones?.qa?.status ?? "pending"
    },
    qaStatus: qa.media?.status ?? null
  };
}

projectsRouter.get("/", (_req, res) => {
  try {
    const summaries = listProjectIds().map(summarize);
    res.json({ projects: summaries });
  } catch (err) {
    sendError(res, err);
  }
});

projectsRouter.post("/", (req, res) => {
  try {
    const { topic, generate } = req.body ?? {};
    if (typeof topic !== "string" || topic.trim().length === 0) {
      res.status(400).json({ error: "A non-empty 'topic' is required." });
      return;
    }
    const { id, dir } = createProjectWorkspace(topic.trim());

    let jobId: string | undefined;
    if (generate === true) {
      const job = startJob({ projectId: id, projectDir: dir, scope: "full", topicFallback: topic.trim() });
      jobId = job.jobId;
    }
    res.status(201).json({ id, jobId });
  } catch (err) {
    sendError(res, err);
  }
});

projectsRouter.get("/:projectId", projectGuard, (req, res) => {
  try {
    const { projectId, projectDir } = req as ProjectRequest;
    const artifacts = readProjectArtifacts(projectDir);
    const qa = readQaReports(projectDir);
    const health = computeProjectHealth(projectId, projectDir);
    res.json({
      id: projectId,
      summary: summarize(projectId),
      artifacts,
      qa,
      health,
      jobs: listJobsForProject(projectId)
    });
  } catch (err) {
    sendError(res, err);
  }
});

projectsRouter.get("/:projectId/health", projectGuard, (req, res) => {
  try {
    const { projectId, projectDir } = req as ProjectRequest;
    res.json(computeProjectHealth(projectId, projectDir));
  } catch (err) {
    sendError(res, err);
  }
});
