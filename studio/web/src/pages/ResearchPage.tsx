import { useEffect, useState } from "react";
import { api, ProjectDetail, StalenessReport } from "../api/client.js";

export function ResearchPage({ projectId }: { projectId: string }) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approval, setApproval] = useState<{ warnings: string[] } | null>(null);
  const [removalImpact, setRemovalImpact] = useState<StalenessReport | null>(null);
  const [requestMoreOpen, setRequestMoreOpen] = useState(false);
  const [requestInstruction, setRequestInstruction] = useState("");
  const [questionEdits, setQuestionEdits] = useState<Record<string, string>>({});

  const reload = () => {
    api.getProject(projectId).then(setDetail).catch((e) => setError(e.message));
  };
  useEffect(reload, [projectId]);

  if (error) return <div className="error-banner" style={{ margin: "var(--space-4)" }}>{error}</div>;
  if (!detail) return <div className="loading">Loading research…</div>;

  const { researchGaps, evidenceGraph, researchQuestions } = detail.artifacts || {};
  const production = detail.summary?.productionPhase;
  const researchApproved = !!production && production !== "RESEARCHING" && production !== "RESEARCH_REVIEW";

  const categories = researchGaps?.categoryCoverage || [];
  const allClaims = evidenceGraph?.claims || [];
  const allEvidence = evidenceGraph?.evidence || [];
  const allSources = evidenceGraph?.sources || [];
  const questions: any[] = researchQuestions?.questions || [];

  const filteredClaims = activeCategory
    ? allClaims.filter((c: any) => !c.category || c.category.toLowerCase().includes(activeCategory.toLowerCase()))
    : allClaims;

  const handleApprove = () => {
    setBusy(true);
    setError(null);
    api
      .approveResearch(projectId)
      .then((r) => {
        setApproval(r);
        reload();
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const handleDeleteEvidence = (evidenceId: string) => {
    api
      .getEvidenceRemovalImpact(projectId, evidenceId)
      .then((impact) => setRemovalImpact(impact))
      .catch((e) => setError(e.message));
    setSelectedEvidence(allEvidence.find((e: any) => e.evidenceId === evidenceId) ?? null);
  };

  const confirmDeleteEvidence = () => {
    if (!selectedEvidence) return;
    setBusy(true);
    api
      .deleteEvidence(projectId, selectedEvidence.evidenceId)
      .then(() => {
        setRemovalImpact(null);
        setSelectedEvidence(null);
        reload();
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const toggleQuestionRelevant = (q: any) => {
    api
      .patchQuestion(projectId, q.questionId, { relevant: q.relevant === false })
      .then(reload)
      .catch((e) => setError(e.message));
  };

  const saveQuestionText = (q: any) => {
    const text = questionEdits[q.questionId];
    if (text === undefined || text === q.questionText) return;
    api
      .patchQuestion(projectId, q.questionId, { questionText: text })
      .then(reload)
      .catch((e) => setError(e.message));
  };

  const submitRequestMore = () => {
    if (!requestInstruction.trim()) return;
    setBusy(true);
    api
      .requestMoreResearch(projectId, { instruction: requestInstruction.trim() })
      .then(() => {
        setRequestMoreOpen(false);
        setRequestInstruction("");
        reload();
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - var(--topbar-h))" }}>
      {/* Approval banner */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-3)",
          padding: "var(--space-3) var(--space-4)",
          borderBottom: "1px solid var(--border)",
          background: researchApproved ? "var(--surface-2)" : "var(--accent-muted)"
        }}
      >
        <div style={{ fontSize: "var(--text-sm)" }}>
          {researchApproved ? (
            <span>Research approved ({production}).</span>
          ) : (
            <span>Research is under review. Approving unlocks argument/script generation.</span>
          )}
          {error && <span style={{ color: "var(--danger, #D9685F)", marginLeft: 12 }}>{error}</span>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-secondary" onClick={() => setRequestMoreOpen(true)}>
            Request More Research
          </button>
          <button type="button" className="btn btn-primary" onClick={handleApprove} disabled={busy || researchApproved}>
            {researchApproved ? "Approved" : "Approve Research"}
          </button>
        </div>
      </div>
      {approval && approval.warnings.length > 0 && (
        <div className="error-banner" style={{ margin: "var(--space-2) var(--space-4)" }}>
          Approved with {approval.warnings.length} non-blocking gap(s): {approval.warnings.slice(0, 3).join("; ")}
        </div>
      )}

      <div className="research-shell" style={{ display: "grid", gridTemplateColumns: "300px minmax(0, 1fr) 360px", flex: 1, minHeight: 0 }}>
        {/* Left Column: Coverage + Questions */}
        <aside
          className="research-col research-col-categories"
          style={{ borderRight: "1px solid var(--border)", padding: "var(--space-4) var(--space-3)", overflowY: "auto" }}
        >
          <h2 className="research-col-heading">Research Coverage</h2>
          <div className="category-list">
            <button type="button" className={`category-row${activeCategory === null ? " active" : ""}`} onClick={() => setActiveCategory(null)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>All Categories</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-secondary)" }}>{allClaims.length} claims</span>
              </div>
            </button>
            {categories.map((c: any) => {
              const isActive = activeCategory === c.category;
              return (
                <button key={c.category} type="button" className={`category-row${isActive ? " active" : ""}`} onClick={() => setActiveCategory(c.category)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontWeight: 500, fontSize: "var(--text-xs)", color: isActive ? "var(--text)" : "var(--text-secondary)" }}>{c.category}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--accent)" }}>{c.coveragePercent}%</span>
                  </div>
                  <div className="sparkbar" style={{ height: 3, background: "var(--surface-3)", borderRadius: 1.5, overflow: "hidden" }}>
                    <div style={{ width: `${c.coveragePercent}%`, height: "100%", background: "var(--accent)" }} />
                  </div>
                </button>
              );
            })}
          </div>

          {questions.length > 0 && (
            <>
              <h2 className="research-col-heading" style={{ marginTop: "var(--space-5)" }}>
                Research Questions
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {questions.map((q) => (
                  <div key={q.questionId} className="panel" style={{ padding: "var(--space-2)", opacity: q.relevant === false ? 0.5 : 1 }}>
                    <input
                      value={questionEdits[q.questionId] ?? q.questionText}
                      onChange={(e) => setQuestionEdits((s) => ({ ...s, [q.questionId]: e.target.value }))}
                      onBlur={() => saveQuestionText(q)}
                      style={{ width: "100%", fontSize: "var(--text-xs)", background: "transparent", border: "none", color: "var(--text)" }}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                      <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-secondary)" }}>{q.status}</span>
                      <button type="button" className="badge badge-neutral" style={{ cursor: "pointer" }} onClick={() => toggleQuestionRelevant(q)}>
                        {q.relevant === false ? "Mark relevant" : "Mark irrelevant"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>

        {/* Center Column: Claims & Evidence */}
        <section className="research-col research-col-center" style={{ padding: "var(--space-4) var(--space-5)", overflowY: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "var(--space-4)" }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-xl)", margin: 0 }}>{activeCategory || "All Research Claims"}</h2>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{filteredClaims.length} claims</span>
          </div>

          {filteredClaims.length === 0 ? (
            <div className="empty-state">No claims found in this category.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {filteredClaims.map((claim: any, idx: number) => {
                const status = claim.evidenceStatus || "SUPPORTED";
                const linkedEvidence = allEvidence.filter((e: any) => (claim.supportingEvidenceIds || []).includes(e.evidenceId));

                return (
                  <div
                    key={claim.claimId || idx}
                    className="panel"
                    style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-2)", background: "var(--panel)" }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-3)" }}>
                      <div style={{ fontSize: "var(--text-sm)", color: "var(--text)", fontWeight: 500, lineHeight: 1.4 }}>{claim.statement || claim.claimText}</div>
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
                            {e.provenance === "HUMAN_EDIT" ? "✎ " : e.provenance === "UNVERIFIED" ? "⚠ " : ""}
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
        <aside className="research-col research-col-inspector" style={{ borderLeft: "1px solid var(--border)", background: "var(--panel)", padding: "var(--space-4)", overflowY: "auto" }}>
          <h2 className="research-col-heading">Evidence Inspector</h2>
          {selectedEvidence ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              {selectedEvidence.provenance && selectedEvidence.provenance !== "AGENT_GENERATED" && (
                <div className="badge badge-warning" style={{ alignSelf: "flex-start" }}>
                  {selectedEvidence.provenance === "UNVERIFIED" ? "UNVERIFIED MANUAL INPUT" : "HUMAN EDIT"}
                </div>
              )}
              <div>
                <div style={{ fontSize: "var(--text-2xs)", textTransform: "uppercase", color: "var(--text-secondary)", marginBottom: 4 }}>Excerpt Quote</div>
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
              </div>

              {selectedEvidence.sourceId && (
                <div>
                  <div style={{ fontSize: "var(--text-2xs)", textTransform: "uppercase", color: "var(--text-secondary)", marginBottom: 4 }}>Cited Source</div>
                  {(() => {
                    const src = allSources.find((s: any) => s.sourceId === selectedEvidence.sourceId);
                    return (
                      <div style={{ background: "var(--surface-2)", padding: "var(--space-3)", borderRadius: "var(--radius-md)", border: "1px solid var(--border)" }}>
                        <div style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: "var(--text)" }}>{src?.title || src?.name || selectedEvidence.sourceId}</div>
                        {src?.url && (
                          <a href={src.url} target="_blank" rel="noreferrer" style={{ fontSize: "var(--text-xs)", color: "var(--accent)", display: "block", marginTop: 4, textDecoration: "underline" }}>
                            {src.url}
                          </a>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              <button type="button" className="btn btn-secondary" onClick={() => handleDeleteEvidence(selectedEvidence.evidenceId)}>
                Remove Evidence…
              </button>
            </div>
          ) : (
            <div className="inspector-empty" style={{ color: "var(--text-tertiary)", fontSize: "var(--text-sm)", padding: "var(--space-4) 0" }}>
              Select an evidence chip to inspect its citation, excerpt, and source reliability.
            </div>
          )}
        </aside>
      </div>

      {removalImpact && (
        <div className="modal-overlay" onClick={() => setRemovalImpact(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Remove evidence "{selectedEvidence?.evidenceId}"?</h3>
            <p style={{ fontSize: "var(--text-sm)" }}>{removalImpact.summary}</p>
            {removalImpact.staleReasons.length > 0 && (
              <ul style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                {removalImpact.staleReasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: "var(--space-3)" }}>
              <button type="button" className="btn btn-secondary" onClick={() => setRemovalImpact(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={confirmDeleteEvidence} disabled={busy}>
                Remove Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {requestMoreOpen && (
        <div className="modal-overlay" onClick={() => setRequestMoreOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Request More Research</h3>
            <textarea
              value={requestInstruction}
              onChange={(e) => setRequestInstruction(e.target.value)}
              placeholder='e.g. "Find stronger primary sources for the cost claim" or "Investigate the cell vs pack price contradiction"'
              rows={4}
              style={{ width: "100%", background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: "var(--radius-sm)", padding: "var(--space-2)" }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: "var(--space-3)" }}>
              <button type="button" className="btn btn-secondary" onClick={() => setRequestMoreOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={submitRequestMore} disabled={busy || !requestInstruction.trim()}>
                Send Request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
