import { useEffect, useState } from "react";
import { api, RenderJob, subscribeJobEvents } from "../api/client.js";

function describeScope(scope: RenderJob["scope"]): string {
  if (scope === "full") return "full render";
  if (scope === "tts") return "TTS";
  return `scene ${scope.scene}`;
}

/** Real jobs only, real stage status via SSE — no invented percent progress (spec V2.4 §34-35). */
export function JobsPanel({ projectId, onJobDone }: { projectId: string; onJobDone: () => void }) {
  const [jobs, setJobs] = useState<RenderJob[]>([]);

  const reload = () => api.listJobs(projectId).then((r) => setJobs(r.jobs));
  useEffect(() => {
    reload();
    const interval = setInterval(reload, 4000);
    return () => clearInterval(interval);
  }, [projectId]);

  useEffect(() => {
    const active = jobs.find((j) => j.status === "queued" || j.status === "running");
    if (!active) return;
    const unsub = subscribeJobEvents(active.jobId, (e) => {
      reload();
      if (e.type === "job_completed" || e.type === "job_failed") onJobDone();
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.map((j) => j.jobId + j.status).join(",")]);

  if (jobs.length === 0) return <div className="empty-state">No jobs yet.</div>;

  return (
    <div>
      {jobs.map((j) => (
        <div key={j.jobId} className="card" style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
            <strong>{describeScope(j.scope)}</strong>
            <span className={`badge stage-${j.status === "complete" ? "complete" : j.status === "failed" ? "failed" : "pending"}`}>{j.status}</span>
          </div>
          {j.stages.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 11, fontFamily: "var(--mono)", color: "var(--text-1)" }}>
              {j.stages.map((s) => (
                <div key={s.stage}>
                  [{s.stage}] {s.status} {s.detail ?? ""} ({(s.durationMs / 1000).toFixed(1)}s)
                </div>
              ))}
            </div>
          )}
          {j.error && <div className="error-banner" style={{ marginTop: 6 }}>{j.error}</div>}
        </div>
      ))}
    </div>
  );
}
