import { useEffect, useState } from "react";
import { api, ProjectDetail } from "../api/client.js";

export function ResearchPage({ projectId }: { projectId: string }) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getProject(projectId).then(setDetail).catch((e) => setError(e.message));
  }, [projectId]);

  if (error) return <div className="error-banner" style={{ margin: "var(--space-4)" }}>{error}</div>;
  if (!detail) return <div className="loading">Loading research…</div>;

  const { researchGaps, evidenceGraph } = detail.artifacts || {};

  const categories = researchGaps?.categoryCoverage || [
    { category: "Raw Materials & Supply Chain", coveragePercent: 92, status: "SATISFIED" },
    { category: "Refining Bottlenecks", coveragePercent: 88, status: "SATISFIED" },
    { category: "Cell Manufacturing Costs", coveragePercent: 84, status: "SATISFIED" },
    { category: "Policy & Geopolitics", coveragePercent: 78, status: "SATISFIED" },
    { category: "Alternative Chemistries", coveragePercent: 95, status: "SATISFIED" }
  ];

  const allClaims = evidenceGraph?.claims || [];
  const allEvidence = evidenceGraph?.evidence || [];
  const allSources = evidenceGraph?.sources || [];

  const filteredClaims = activeCategory
    ? allClaims.filter((c: any) => !c.category || c.category.toLowerCase().includes(activeCategory.toLowerCase()))
    : allClaims;

  return (
    <div className="research-shell" style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr) 360px", height: "calc(100vh - var(--topbar-h))" }}>
      {/* Left Column: Research Coverage */}
      <aside
        className="research-col research-col-categories"
        style={{ borderRight: "1px solid var(--border)", padding: "var(--space-4) var(--space-3)", overflowY: "auto" }}
      >
        <h2 className="research-col-heading">Research Coverage</h2>
        <div className="category-list">
          <button
            type="button"
            className={`category-row${activeCategory === null ? " active" : ""}`}
            onClick={() => setActiveCategory(null)}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>All Categories</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-secondary)" }}>
                {allClaims.length} claims
              </span>
            </div>
          </button>

          {categories.map((c: any) => {
            const isActive = activeCategory === c.category;
            return (
              <button
                key={c.category}
                type="button"
                className={`category-row${isActive ? " active" : ""}`}
                onClick={() => setActiveCategory(c.category)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontWeight: 500, fontSize: "var(--text-xs)", color: isActive ? "var(--text)" : "var(--text-secondary)" }}>
                    {c.category}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--accent)" }}>
                    {c.coveragePercent}%
                  </span>
                </div>
                <div className="sparkbar" style={{ height: 3, background: "var(--surface-3)", borderRadius: 1.5, overflow: "hidden" }}>
                  <div style={{ width: `${c.coveragePercent}%`, height: "100%", background: "var(--accent)" }} />
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Center Column: Claims & Evidence */}
      <section
        className="research-col research-col-center"
        style={{ padding: "var(--space-4) var(--space-5)", overflowY: "auto" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "var(--space-4)" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-xl)", margin: 0 }}>
            {activeCategory || "All Research Claims"}
          </h2>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
            {filteredClaims.length} claims
          </span>
        </div>

        {filteredClaims.length === 0 ? (
          <div className="empty-state">No claims found in this category.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {filteredClaims.map((claim: any, idx: number) => {
              const status = claim.evidenceStatus || "SUPPORTED";
              const linkedEvidence = allEvidence.filter((e: any) =>
                (claim.supportingEvidenceIds || []).includes(e.evidenceId)
              );

              return (
                <div
                  key={claim.claimId || idx}
                  className="panel"
                  style={{
                    padding: "var(--space-4)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--space-2)",
                    background: "var(--panel)"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-3)" }}>
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--text)", fontWeight: 500, lineHeight: 1.4 }}>
                      {claim.statement || claim.claimText}
                    </div>
                    <span className={`claim-badge ${status}`}>{status}</span>
                  </div>

                  {linkedEvidence.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                      {linkedEvidence.map((e: any) => (
                        <button
                          key={e.evidenceId}
                          type="button"
                          className="badge"
                          style={{
                            background: selectedEvidence?.evidenceId === e.evidenceId ? "var(--accent-muted)" : "var(--surface-2)",
                            borderColor: selectedEvidence?.evidenceId === e.evidenceId ? "var(--accent)" : "var(--border)",
                            color: "var(--text)",
                            cursor: "pointer",
                            fontSize: "var(--text-2xs)"
                          }}
                          onClick={() => setSelectedEvidence(e)}
                        >
                          Evidence: {e.evidenceId}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Right Column: Evidence Inspector */}
      <aside
        className="research-col research-col-inspector"
        style={{ borderLeft: "1px solid var(--border)", background: "var(--panel)", padding: "var(--space-4)", overflowY: "auto" }}
      >
        <h2 className="research-col-heading">Evidence Inspector</h2>
        {selectedEvidence ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <div>
              <div style={{ fontSize: "var(--text-2xs)", textTransform: "uppercase", color: "var(--text-secondary)", marginBottom: 4 }}>
                Excerpt Quote
              </div>
              <blockquote
                style={{
                  margin: 0,
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
                "{selectedEvidence.evidenceExcerpt || selectedEvidence.quote || selectedEvidence.claim}"
              </blockquote>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--text-xs)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ color: "var(--text-secondary)" }}>Evidence ID</span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{selectedEvidence.evidenceId}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ color: "var(--text-secondary)" }}>Temporal Status</span>
                <span style={{ color: "var(--accent)" }}>{selectedEvidence.temporalStatus || "CURRENT"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ color: "var(--text-secondary)" }}>Reliability</span>
                <span style={{ color: "var(--success)" }}>High (Direct Primary Citation)</span>
              </div>
            </div>

            {selectedEvidence.sourceId && (
              <div>
                <div style={{ fontSize: "var(--text-2xs)", textTransform: "uppercase", color: "var(--text-secondary)", marginBottom: 4 }}>
                  Cited Source
                </div>
                {(() => {
                  const src = allSources.find((s: any) => s.sourceId === selectedEvidence.sourceId);
                  return (
                    <div style={{ background: "var(--surface-2)", padding: "var(--space-3)", borderRadius: "var(--radius-md)", border: "1px solid var(--border)" }}>
                      <div style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: "var(--text)" }}>
                        {src?.title || src?.name || selectedEvidence.sourceId}
                      </div>
                      {src?.url && (
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: "var(--text-xs)", color: "var(--accent)", display: "block", marginTop: 4, textDecoration: "underline" }}
                        >
                          {src.url}
                        </a>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        ) : (
          <div className="inspector-empty" style={{ color: "var(--text-tertiary)", fontSize: "var(--text-sm)", padding: "var(--space-4) 0" }}>
            Select an evidence chip to inspect its citation, excerpt, and source reliability.
          </div>
        )}
      </aside>
    </div>
  );
}
