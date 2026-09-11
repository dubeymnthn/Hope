import { useEffect, useState } from "react";
import { api, ProjectSummary } from "../api/client.js";
import { navigate } from "../router.js";
import { EditorIcon, CloseIcon } from "../components/Icons.js";

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "Recently";
  }
}

const THUMB_COLORS = ["#2A2115", "#1B2420", "#241820", "#1A2028", "#221C28", "#1E2218"];

export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const reload = () => {
    api
      .listProjects()
      .then((r) => setProjects(r.projects))
      .catch((e) => setError(e.message));
  };
  useEffect(reload, []);

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "var(--space-6) var(--space-5) var(--space-8)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-6)" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-3xl)", margin: 0, fontWeight: 600 }}>
            Recent Projects
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", margin: "var(--space-1) 0 0" }}>
            Autonomous documentary workspaces managed by this factory.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setDialogOpen(true)}>
          + New Project
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {!projects && !error && <div className="loading">Loading projects…</div>}
      {projects && projects.length === 0 && (
        <div className="empty-state">No projects found. Create a project to start the pipeline.</div>
      )}

      {projects && projects.length > 0 && (
        <div
          className="project-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "var(--space-5)"
          }}
        >
          {projects.map((p, idx) => {
            const thumbBg = THUMB_COLORS[idx % THUMB_COLORS.length];
            const meta = `${formatDuration(p.runtimeSeconds)} · ${p.sceneCount} scenes · ${p.chapterCount} chapters`;
            const qaState = (p.qaStatus || "pass").toLowerCase();
            const qaClass = qaState === "pass" ? "badge-success" : qaState === "warning" ? "badge-warning" : "badge-danger";
            const qaLabel = qaState === "pass" ? "Pass" : qaState === "warning" ? "Warning" : "Fail";

            return (
              <article
                key={p.id}
                className="project-card"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-lg)",
                  overflow: "hidden",
                  transition: "border-color var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out)"
                }}
              >
                <div
                  className="project-card-thumb"
                  style={{
                    height: 132,
                    background: thumbBg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "rgba(237, 237, 239, 0.35)"
                  }}
                >
                  <EditorIcon size={32} />
                </div>

                <div className="project-card-body" style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-2)", flex: 1 }}>
                  <h3
                    className="project-card-title"
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: "var(--text-lg)",
                      fontWeight: 600,
                      color: "var(--text)",
                      margin: 0,
                      lineHeight: 1.3
                    }}
                  >
                    {p.title || p.topic}
                  </h3>

                  <div
                    className="project-card-meta"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--text-xs)",
                      color: "var(--text-secondary)"
                    }}
                  >
                    {meta}
                  </div>

                  <div
                    className="project-card-footer"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginTop: "auto",
                      paddingTop: "var(--space-2)"
                    }}
                  >
                    <span className="project-card-modified" style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                      Modified {formatDate(p.lastModified)}
                    </span>
                    <span className={`badge ${qaClass}`}>{qaLabel}</span>
                  </div>

                  <button
                    type="button"
                    className="project-card-link"
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      marginTop: "var(--space-2)",
                      paddingTop: "var(--space-3)",
                      border: "none",
                      borderTop: "1px solid var(--border)",
                      background: "transparent",
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--text-sm)",
                      fontWeight: 500,
                      color: "var(--accent)",
                      cursor: "pointer"
                    }}
                    onClick={() => navigate("overview", p.id)}
                  >
                    Open Project &rarr;
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {dialogOpen && <NewProjectDialog onClose={() => setDialogOpen(false)} onCreated={reload} />}
    </div>
  );
}

function NewProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [topic, setTopic] = useState("");
  const [generate, setGenerate] = useState(false);
  const [designMd, setDesignMd] = useState("");
  const [showDesign, setShowDesign] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!topic.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.createProject(topic.trim(), generate, designMd.trim() || undefined);
      onCreated();
      onClose();
      navigate("overview", id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000
      }}
      onClick={onClose}
    >
      <div
        className="modal"
        style={{
          width: 480,
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-md)",
          overflow: "hidden"
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="modal-header"
          style={{
            padding: "var(--space-4)",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}
        >
          <span style={{ fontWeight: 600, fontSize: "var(--text-md)" }}>Create New Documentary Project</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="modal-body" style={{ padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {error && <div className="error-banner">{error}</div>}

          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6, textTransform: "uppercase" }}>
              Topic Statement
            </label>
            <input
              type="text"
              className="input search-input"
              style={{ width: "100%", height: 36 }}
              autoFocus
              placeholder="e.g. Why Batteries Are Still Expensive"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer", fontSize: "var(--text-sm)" }}>
            <input
              type="checkbox"
              checked={generate}
              onChange={(e) => setGenerate(e.target.checked)}
            />
            <span>Start research immediately (pauses for your review before argument/script/production)</span>
          </label>

          <div>
            <button type="button" className="btn btn-secondary" style={{ fontSize: "var(--text-xs)" }} onClick={() => setShowDesign((s) => !s)}>
              {showDesign ? "Hide" : "Add"} design.md (optional visual style brief)
            </button>
            {showDesign && (
              <textarea
                value={designMd}
                onChange={(e) => setDesignMd(e.target.value)}
                rows={5}
                placeholder="Describes HOW the documentary should look — never facts. e.g. 'Restrained editorial documentary, warm muted palette, slow deliberate pacing.'"
                style={{ width: "100%", marginTop: "var(--space-2)", background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: "var(--radius-sm)", padding: "var(--space-2)", fontSize: "var(--text-sm)" }}
              />
            )}
          </div>
        </div>

        <div
          className="modal-footer"
          style={{
            padding: "var(--space-3) var(--space-4)",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "flex-end",
            gap: "var(--space-2)"
          }}
        >
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={create} disabled={busy || !topic.trim()}>
            {busy ? "Creating…" : "Create Project"}
          </button>
        </div>
      </div>
    </div>
  );
}
