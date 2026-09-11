import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { OrchestratorAgent, StageRecord } from "../../../src/orchestrator/orchestrator.js";
import { PipelineStateManager } from "../../../src/orchestrator/pipeline-state.js";
import { isAgentTaskPending } from "../../../src/agents/agent-task.js";
import { isProductionGate, assertScriptApproved } from "../../../src/orchestrator/production-gate.js";
import { HyperFramesRenderer } from "../../../src/renderers/hyperframes.js";
import { DesignDirectorAgent } from "../../../src/agents/design-director.js";
import { VoiceAgent } from "../../../src/agents/voice.js";
import { resolvePlanningRate } from "../../../src/schemas/channel.js";
import { readProjectArtifacts } from "./artifact-reader.js";
import { eventBus } from "./events.js";
import { repoRoot } from "./workspace.js";

export type JobStatus = "queued" | "running" | "complete" | "failed" | "blocked" | "awaiting_agent";
// "full" advances the pipeline exactly as far as current approvals allow, pausing at the
// next gate; "produce" is the explicit "Start Production" action (bypasses the
// PRODUCTION_READY pause only — research/script approval are still required).
export type JobScope = "full" | "produce" | "tts" | { scene: string };

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
  if (scope === "produce") return "produce";
  if (scope === "tts") return "tts";
  return `scene:${scope.scene}`;
}

export function hasActiveJob(projectId: string): boolean {
  return [...jobs.values()].some((j) => j.projectId === projectId && (j.status === "queued" || j.status === "running"));
}

export class JobAlreadyRunningError extends Error {
  constructor(projectId: string) {
    super(`A job is already running for project "${projectId}". Wait for it to finish (or check /api/jobs?projectId=...) before starting another.`);
    this.name = "JobAlreadyRunningError";
  }
}

export function lastFailedJob(projectId: string): RenderJob | undefined {
  return listJobsForProject(projectId).find((j) => j.status === "failed");
}

/** Best-effort topic derivation for re-running the real orchestrator against an existing project. */
export function resolveProjectTopic(projectDir: string, fallback: string): string {
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
  // Synchronous check-then-register, no `await` between them: Node's single-threaded
  // execution makes this atomic, so two near-simultaneous requests (a double-click, or
  // "Create + Generate" firing twice) cannot both pass this check. This is the fix for a
  // real incident hit during this session: two concurrent "full" jobs for the same
  // project each loaded their own Chatterbox session on the same XPU device — exactly
  // the GPU-contention/corrupted-timing gotcha CLAUDE.md documents.
  if (hasActiveJob(projectId)) {
    throw new JobAlreadyRunningError(projectId);
  }
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

  try {
    if (job.scope === "full" || job.scope === "produce") {
      const topic = resolveProjectTopic(projectDir, topicFallback);
      // The CLI (src/cli.ts) passes this explicitly too — PipelineStateManager otherwise
      // defaults to `resolve(process.cwd(), "pipeline-state.json")`. The CLI gets away
      // without setting it because that path is process.cwd() for THAT invocation, but the
      // Studio server is one long-running, multi-project process that can never chdir (it
      // would break every other project's requests), so this was silently writing every
      // project's pipeline-state.json to the server's own cwd (the repo root) instead —
      // a real bug hit and fixed during this session.
      const orchestrator = new OrchestratorAgent({ stateFilePath: join(projectDir, "pipeline-state.json") });
      const result = await orchestrator.run({
        topic,
        outputDir: projectDir,
        repoRoot: repoRoot(),
        // V2.6: Documentary Studio always requires human approval — never auto-approve.
        // "produce" additionally bypasses the PRODUCTION_READY pause (the "Start
        // Production" button); "full" advances only as far as approvals already allow.
        autoApprove: false,
        startProduction: job.scope === "produce",
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
      assertScriptApproved(new PipelineStateManager(join(projectDir, "pipeline-state.json")), projectDir);
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
  } catch (err) {
    // A human-review pause or an agent-task halt is expected, not a failure — surface it
    // as a distinct job status so the UI can show "needs your approval"/"needs the agent"
    // instead of a red error. Anything else rethrows to startJob()'s outer .catch(), which
    // marks the job genuinely "failed".
    if (isProductionGate(err)) {
      job.status = "blocked";
      job.error = err.message;
      job.completedAt = new Date().toISOString();
      eventBus.publish({ type: "job_blocked", jobId: job.jobId, projectId: job.projectId, at: job.completedAt, detail: err.message });
      return;
    }
    if (isAgentTaskPending(err)) {
      job.status = "awaiting_agent";
      job.error = err.message;
      job.completedAt = new Date().toISOString();
      eventBus.publish({ type: "job_awaiting_agent", jobId: job.jobId, projectId: job.projectId, at: job.completedAt, detail: err.message });
      return;
    }
    throw err;
  }
}
