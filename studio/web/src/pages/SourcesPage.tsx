import { useEffect, useState } from "react";
import { api, ProjectDetail } from "../api/client.js";

export function SourcesPage({ projectId }: { projectId: string }) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getProject(projectId).then(setDetail).catch((e) => setError(e.message));
  }, [projectId]);

  if (error) return <div className="error-banner" style={{ margin: "var(--space-4)" }}>{error}</div>;
  if (!detail) return <div className="loading">Loading sources…</div>;
  const graph = detail.artifacts?.evidenceGraph;
  if (!graph) return <div className="empty-state">No evidence graph produced for this project yet.</div>;

  const sources = graph.sources || [];
  const activeSource = sources.find((s: any) => s.sourceId === selected) || sources[0];
  const evidenceForSource = activeSource ? (graph.evidence || []).filter((e: any) => e.sourceId === activeSource.sourceId) : [];

  return (
    <div style={{ padding: "var(--space-6) var(--space-8) var(--space-8)", maxWidth: 1400 }}>
      <div style={{ marginBottom: "var(--space-5)" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-3xl)", margin: 0, fontWeight: 600 }}>
          Primary & Secondary Sources
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", margin: "var(--space-1) 0 0" }}>
          Cited academic, industry, and governmental references from the evidence graph.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 420px", gap: "var(--space-5)" }}>
        <div className="panel" style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
          <div className="panel-header">
            <span>Sources ({sources.length})</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Title / Organization</th>
                <th>Type</th>
                <th>Classification</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s: any) => {
                const isSelected = s.sourceId === (activeSource?.sourceId ?? selected);
                return (
                  <tr
                    key={s.sourceId}
                    onClick={() => setSelected(s.sourceId)}
                    style={{
                      cursor: "pointer",
                      background: isSelected ? "var(--surface-2)" : undefined
                    }}
                  >
                    <td>
                      <div style={{ fontWeight: isSelected ? 600 : 400, color: isSelected ? "var(--text)" : "var(--text-secondary)" }}>
                        {s.title || s.name}
                      </div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-tertiary)" }}>
                        {s.sourceId}
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-neutral" style={{ fontSize: "var(--text-2xs)" }}>
                        {s.sourceType}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: "var(--text-xs)", color: s.primaryOrSecondary === "PRIMARY" ? "var(--accent)" : "var(--text-secondary)" }}>
                        {s.primaryOrSecondary}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <aside className="panel" style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", height: "fit-content" }}>
          <div className="panel-header">
            <span>Source Detail</span>
          </div>
          {activeSource ? (
            <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              <div>
                <h3 style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-lg)", margin: 0, lineHeight: 1.3 }}>
                  {activeSource.title}
                </h3>
                {activeSource.author && (
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 4 }}>
                    By {activeSource.author}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--text-xs)", borderTop: "1px solid var(--border)", paddingTop: "var(--space-3)" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-secondary)" }}>Source ID</span>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>{activeSource.sourceId}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-secondary)" }}>Type</span>
                  <span>{activeSource.sourceType}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-secondary)" }}>Classification</span>
                  <span style={{ color: "var(--success)" }}>{activeSource.primaryOrSecondary}</span>
                </div>
                {activeSource.url && (
                  <div style={{ marginTop: 4 }}>
                    <span style={{ color: "var(--text-secondary)", display: "block", marginBottom: 2 }}>URL</span>
                    <a
                      href={activeSource.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "var(--accent)", wordBreak: "break-all", textDecoration: "underline" }}
                    >
                      {activeSource.url}
                    </a>
                  </div>
                )}
              </div>

              {evidenceForSource.length > 0 && (
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: "var(--space-3)" }}>
                  <div style={{ fontSize: "var(--text-xs)", fontWeight: 600, textTransform: "uppercase", color: "var(--text-secondary)", marginBottom: 8 }}>
                    Cited In ({evidenceForSource.length} data points)
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {evidenceForSource.map((e: any) => (
                      <div key={e.evidenceId} style={{ background: "var(--surface-2)", padding: "var(--space-2) var(--space-3)", borderRadius: "var(--radius-sm)", fontSize: "var(--text-xs)", color: "var(--text)" }}>
                        "{e.evidenceExcerpt || e.quote || e.claim}"
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="empty-state">Select a source to inspect details.</div>
          )}
        </aside>
      </div>
    </div>
  );
}
