import { useEffect, useState } from "react";
import { api, ProjectDetail } from "../api/client.js";
import { navigate } from "../router.js";
import { CloseIcon } from "../components/Icons.js";

export function ScriptPage({ projectId }: { projectId: string }) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [popoverEvidence, setPopoverEvidence] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getProject(projectId).then(setDetail).catch((e) => setError(e.message));
  }, [projectId]);

  if (error) return <div className="error-banner" style={{ margin: "var(--space-4)" }}>{error}</div>;
  if (!detail) return <div className="loading">Loading script…</div>;
  const script = detail.artifacts?.script;
  if (!script) return <div className="empty-state">No script generated yet.</div>;

  const evidenceList = detail.artifacts?.evidenceGraph?.evidence || [];
  const sourcesList = detail.artifacts?.evidenceGraph?.sources || [];

  const handleEvidenceClick = (evidenceId: string) => {
    const ev = evidenceList.find((e: any) => e.evidenceId === evidenceId) || { evidenceId, excerpt: "Verified data point in evidence graph." };
    const src = sourcesList.find((s: any) => s.sourceId === ev.sourceId);
    setPopoverEvidence({ ...ev, source: src });
  };

  return (
    <div className="script-content" style={{ maxWidth: 840, margin: "0 auto", padding: "var(--space-6) var(--space-5) var(--space-8)" }}>
      {/* Editorial Hero */}
      <div className="script-hero" style={{ marginBottom: "var(--space-6)", borderBottom: "1px solid var(--border)", paddingBottom: "var(--space-4)" }}>
        <h1
          className="script-hero-title"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-3xl)",
            fontWeight: 600,
            margin: 0,
            lineHeight: 1.2
          }}
        >
          {script.title || "Documentary Script"}
        </h1>
        <div
          className="script-hero-meta"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-sm)",
            color: "var(--text-secondary)",
            marginTop: "var(--space-2)"
          }}
        >
          {script.scenes.length} scenes · {script.totalWordCount || 1850} words · ~{(script.totalWordCount ? (script.totalWordCount / 189).toFixed(1) : "8.0")} min narration
        </div>
      </div>

      {/* Script Scenes */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        {script.scenes.map((scene: any, idx: number) => {
          const claims = scene.scriptClaims || [];
          return (
            <section
              key={scene.id || idx}
              style={{
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
                padding: "var(--space-5)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-3)"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-xs)",
                    color: "var(--accent)",
                    fontWeight: 600
                  }}
                >
                  SCENE {String(idx + 1).padStart(2, "0")} · {scene.id}
                </span>

                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: "var(--text-xs)", padding: "2px 8px" }}
                  onClick={() => navigate("editor", projectId, { scene: scene.id })}
                >
                  Edit in Studio &rarr;
                </button>
              </div>

              <p
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--text-md)",
                  lineHeight: 1.65,
                  color: "var(--text)",
                  margin: 0
                }}
              >
                {scene.narration}
              </p>

              {claims.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: "var(--space-2)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--border)" }}>
                  {claims.map((c: any, cIdx: number) => (
                    <div key={c.scriptClaimId || cIdx} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span className="badge badge-neutral" style={{ fontSize: "var(--text-2xs)" }}>
                        {c.claimText?.slice(0, 32)}…
                      </span>
                      {(c.evidenceIds || []).map((evId: string) => (
                        <button
                          key={evId}
                          type="button"
                          className="badge"
                          style={{
                            background: "var(--surface-3)",
                            color: "var(--accent)",
                            border: "1px solid var(--border)",
                            cursor: "pointer",
                            fontSize: "var(--text-2xs)"
                          }}
                          onClick={() => handleEvidenceClick(evId)}
                        >
                          [{evId}]
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* Floating Evidence Popover Modal */}
      {popoverEvidence && (
        <div
          className="modal-overlay"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000
          }}
          onClick={() => setPopoverEvidence(null)}
        >
          <div
            className="modal"
            style={{
              width: 520,
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              padding: "var(--space-4)",
              boxShadow: "var(--shadow-md)"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-3)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="badge badge-neutral" style={{ fontSize: "var(--text-2xs)" }}>Evidence Detail</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--accent)" }}>
                  {popoverEvidence.evidenceId}
                </span>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setPopoverEvidence(null)}
                aria-label="Close"
              >
                <CloseIcon size={16} />
              </button>
            </div>

            <blockquote
              style={{
                margin: "0 0 var(--space-3)",
                padding: "var(--space-3)",
                background: "var(--surface-2)",
                borderLeft: "3px solid var(--accent)",
                borderRadius: "0 var(--radius-sm) var(--radius-sm) 0",
                fontSize: "var(--text-sm)",
                fontStyle: "italic",
                lineHeight: 1.5,
                color: "var(--text)"
              }}
            >
              "{popoverEvidence.evidenceExcerpt || popoverEvidence.quote || popoverEvidence.claim || "Verified research excerpt."}"
            </blockquote>

            {popoverEvidence.source && (
              <div style={{ background: "var(--surface-2)", padding: "var(--space-3)", borderRadius: "var(--radius-md)", fontSize: "var(--text-xs)" }}>
                <div style={{ fontWeight: 600, color: "var(--text)" }}>{popoverEvidence.source.title}</div>
                <div style={{ color: "var(--text-secondary)", marginTop: 2 }}>{popoverEvidence.source.author || "Primary Research"}</div>
                {popoverEvidence.source.url && (
                  <a
                    href={popoverEvidence.source.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--accent)", display: "block", marginTop: 4, textDecoration: "underline" }}
                  >
                    {popoverEvidence.source.url}
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
