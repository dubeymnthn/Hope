import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { OrchestratorAgent, StageRecord } from "../../../src/orchestrator/orchestrator.js";
import { HyperFramesRenderer } from "../../../src/renderers/hyperframes.js";
import { DesignDirectorAgent } from "../../../src/agents/design-director.js";
import { VoiceAgent } from "../../../src/agents/voice.js";
import { resolvePlanningRate } from "../../../src/schemas/channel.js";
import { readProjectArtifacts } from "./artifact-reader.js";
import { eventBus } from "./events.js";
import { repoRoot } from "./workspace.js";

export type JobStatus = "queued" | "running" | "complete" | "failed";
export type JobScope = "full" | "tts" | { scene: string };

export interface RenderJob {
  jobId: string;
  projectId: string;
  scope: JobScope;
  status: JobStatus;
  startedAt: string;
  completedAt?: string;
  stages: StageRecord[];
  error?: string;
  outputPath?: string;
}

const jobs = new Map<string, RenderJob>();

export function getJob(jobId: string): RenderJob | undefined {
  return jobs.get(jobId);
}

export function listJobsForProject(projectId: string): RenderJob[] {
  return [...jobs.values()].filter((j) => j.projectId === projectId).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

function describeScope(scope: JobScope): string {
  if (scope === "full") return "full";
  if (scope === "tts") return "tts";
  return `scene:${scope.scene}`;
}

export function hasActiveJob(projectId: string): boolean {
  return [...jobs.values()].some((j) => j.projectId === projectId && (j.status === "queued" || j.status === "running"));
}

export function lastFailedJob(projectId: string): RenderJob | undefined {
  return listJobsForProject(projectId).find((j) => j.status === "failed");
}

/** Best-effort topic derivation for re-running the real orchestrator against an existing project. */
function resolveProjectTopic(projectDir: string, fallback: string): string {
  const a = readProjectArtifacts(projectDir);
  return a.research?.topic ?? a.researchPlan?.topic ?? a.argument?.topic ?? a.script?.title ?? fallback;
}

/**
 * Triggers a REAL job: either the full orchestrator (`OrchestratorAgent.run()`, unchanged
 * behavior, just given an `onEvent` hook) or a scoped single-scene HyperFrames render
 * (using the newly-exposed `composition` render option). Runs asynchronously; the caller
 * gets a `jobId` immediately and polls/streams for progress. No fake progress — status
 * transitions only happen when the real underlying call actually reaches that point.
 */
export function startJob(params: { projectId: string; projectDir: string; scope: JobScope; topicFallback: string }): RenderJob {
  const { projectId, projectDir, scope, topicFallback } = params;
  const jobId = randomUUID();
  const job: RenderJob = { jobId, projectId, scope, status: "queued", startedAt: new Date().toISOString(), stages: [] };
  jobs.set(jobId, job);

  eventBus.publish({ type: "job_started", jobId, projectId, at: job.startedAt, detail: describeScope(scope) });

  // Fire-and-forget: the HTTP handler returns immediately with the job id.
  void runJob(job, projectDir, topicFallback).catch((err) => {
    job.status = "failed";
    job.error = String(err?.message ?? err);
    job.completedAt = new Date().toISOString();
    eventBus.publish({ type: "job_failed", jobId, projectId, at: job.completedAt, detail: job.error });
  });

  return job;
}

async function runJob(job: RenderJob, projectDir: string, topicFallback: string): Promise<void> {
  job.status = "running";
  eventBus.publish({ type: "render_started", jobId: job.jobId, projectId: job.projectId, at: new Date().toISOString() });

  if (job.scope === "full") {
    const topic = resolveProjectTopic(projectDir, topicFallback);
    const orchestrator = new OrchestratorAgent();
    const result = await orchestrator.run({
      topic,
      outputDir: projectDir,
      repoRoot: repoRoot(),
      onEvent: (e) => {
        job.stages = [...job.stages];
        eventBus.publish({
          type: e.type,
          jobId: job.jobId,
          projectId: job.projectId,
          detail: `${e.stage}${e.detail ? `: ${e.detail}` : ""}`,
          at: new Date().toISOString()
        });
      }
    });
    job.stages = result.stages;
    job.outputPath = result.finalVideoPath;
  } else if (job.scope === "tts") {
    // Reuses the exact resumable, per-scene-cached TTS pipeline the orchestrator uses —
    // narration edits are self-invalidating (see narration-editor.ts), so this only
    // resynthesizes scenes whose text actually changed and reuses everything else.
    const artifacts = readProjectArtifacts(projectDir);
    if (!artifacts.script) throw new Error("No script exists yet for this project.");
    const rate = resolvePlanningRate(artifacts.config?.video);
    const audio = await new VoiceAgent().generate(artifacts.script.scenes, projectDir, { wordsPerMinute: rate.wordsPerMinute, source: rate.source });
    job.outputPath = audio.audioPath;
  } else {
    // Scene-level preview render: a genuinely separate clip, not the final documentary.
    // Requires storyboard/compositions to already exist (i.e. a full render has happened
    // at least once) — this is a fast re-preview of one edited scene, not first production.
    const renderer = new HyperFramesRenderer({ repoRoot: repoRoot() });
    const design = new DesignDirectorAgent().getDesign();
    const output = join(projectDir, "renders", `preview-${job.scope.scene}.mp4`);
    const res = await renderer.render(projectDir, {
      output,
      fps: design.canvas.fps,
      quality: "draft",
      composition: `compositions/${job.scope.scene}.html`
    });
    job.outputPath = res.outputPath;
  }

  job.status = "complete";
  job.completedAt = new Date().toISOString();
  eventBus.publish({ type: "job_completed", jobId: job.jobId, projectId: job.projectId, at: job.completedAt, detail: job.outputPath });
}
