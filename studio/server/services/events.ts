import { EventEmitter } from "node:events";

/**
 * Tiny pub/sub for SSE fan-out (spec V2.4 §35 "live pipeline events"). One process-wide
 * emitter; routes/render.ts filters by projectId/jobId when subscribing a client.
 */
export interface StudioEvent {
  type:
    | "stage_started"
    | "stage_completed"
    | "stage_failed"
    | "artifact_created"
    | "artifact_reused"
    | "artifact_invalidated"
    | "tts_scene_started"
    | "tts_scene_completed"
    | "render_started"
    | "render_completed"
    | "qa_started"
    | "qa_completed"
    | "job_started"
    | "job_completed"
    | "job_failed"
    // --- V2.6: a job pausing for human review or an agent task is not a failure ---
    | "job_blocked"
    | "job_awaiting_agent";
  jobId: string;
  projectId: string;
  detail?: string;
  at: string;
}

class EventBus extends EventEmitter {
  publish(event: StudioEvent): void {
    this.emit("event", event);
  }
}

export const eventBus = new EventBus();
eventBus.setMaxListeners(100);
