import { useEffect, useState } from "react";
import { api, SceneSummary } from "../api/client.js";
import { navigate } from "../router.js";

export function StoryboardPage({ projectId }: { projectId: string }) {
  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listScenes(projectId)
      .then((r) => setScenes(r.scenes))
      .catch((e) => setError(e.message));
  }, [projectId]);

  if (error) return <div className="error-banner" style={{ margin: "var(--space-4)" }}>{error}</div>;

  return (
    <div style={{ padding: "var(--space-6) var(--space-8) var(--space-8)", maxWidth: 1200 }}>
      <div style={{ marginBottom: "var(--space-5)" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-3xl)", margin: 0, fontWeight: 600 }}>
          Storyboard Overview
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", margin: "var(--space-1) 0 0" }}>
          Scene visual direction, visual modes, and scheduled beat transitions.
        </p>
      </div>

      <div className="panel" style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Scene</th>
              <th>Chapter</th>
              <th>Visual Mode</th>
              <th>Duration</th>
              <th>Beats</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {scenes.map((s) => (
              <tr key={s.sceneId}>
                <td style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{s.sceneId}</td>
                <td>{s.chapter ?? "—"}</td>
                <td>
                  <span className="badge badge-neutral">{s.visualMode ?? "standard"}</span>
                </td>
                <td style={{ fontFamily: "var(--font-mono)" }}>{s.duration ? `${s.duration.toFixed(1)}s` : "—"}</td>
                <td>{s.beatCount} beats</td>
                <td>
                  <span className={`badge ${s.stale ? "badge-warning" : "badge-success"}`}>
                    {s.stale ? "Modified" : "Synced"}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: "var(--text-xs)", padding: "2px 8px" }}
                    onClick={() => navigate("editor", projectId, { scene: s.sceneId })}
                  >
                    Open in Editor &rarr;
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {scenes.length === 0 && <div className="empty-state">No scenes in storyboard yet.</div>}
      </div>
    </div>
  );
}
