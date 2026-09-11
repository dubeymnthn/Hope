import { useEffect, useState } from "react";
import { api, ProjectDetail } from "../api/client.js";
import { navigate } from "../router.js";
import { CloseIcon } from "../components/Icons.js";

export function ScriptPage({ projectId }: { projectId: string }) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [popoverEvidence, setPopoverEvidence] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approval, setApproval] = useState<{ warnings: string[] } | null>(null);
  const [editingScene, setEditingScene] = useState<string | null>(null);
  const [draftNarration, setDraftNarration] = useState("");
  const [overridingClaim, setOverridingClaim] = useState<{ sceneId: string; claimId: string } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionInstruction, setRevisionInstruction] = useState("");

  const reload = () => {
    api.getProject(projectId).then(setDetail).catch((e) => setError(e.message));
  };
  useEffect(reload, [projectId]);

  if (error) return <div className="error-banner" style={{ margin: "var(--space-4)" }}>{error}</div>;
  if (!detail) return <div className="loading">Loading script…</div>;
  const script = detail.artifacts?.script;
  if (!script) return <div className="empty-state">No script generated yet.</div>;

  const evidenceList = detail.artifacts?.evidenceGraph?.evidence || [];
  const sourcesList = detail.artifacts?.evidenceGraph?.sources || [];
  const production = detail.summary?.productionPhase;
  const scriptApproved = !!production && !["RESEARCHING", "RESEARCH_REVIEW", "RESEARCH_APPROVED", "ARGUMENT_GENERATING", "SCRIPT_REVIEW"].includes(production);
  const anyRequiresReview = script.scenes.some((s: any) => (s.scriptClaims ?? []).some((c: any) => c.provenanceStatus === "PROVENANCE_REQUIRES_REVIEW"));

  const handleEvidenceClick = (evidenceId: string) => {
    const ev = evidenceList.find((e: any) => e.evidenceId === evidenceId) || { evidenceId, excerpt: "Verified data point in evidence graph." };
    const src = sourcesList.find((s: any) => s.sourceId === ev.sourceId);
    setPopoverEvidence({ ...ev, source: src });
  };

  const startEdit = (scene: any) => {
    setEditingScene(scene.id);
    setDraftNarration(scene.narration);
  };

  const saveEdit = (sceneId: string) => {
    setBusy(true);
    api
      .patchNarration(projectId, sceneId, draftNarration)
      .then(() => {
        setEditingScene(null);
        reload();
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const handleDeleteScene = (sceneId: string) => {
    if (!confirm(`Delete scene "${sceneId}"? This cannot be undone from here (use Revisions to undo).`)) return;
    api.deleteScene(projectId, sceneId).then(reload).catch((e) => setError(e.message));
  };

  const submitOverride = () => {
    if (!overridingClaim || !overrideReason.trim()) return;
    setBusy(true);
    api
      .overrideClaim(projectId, overridingClaim.sceneId, overridingClaim.claimId, overrideReason.trim())
      .then(() => {
        setOverridingClaim(null);
        setOverrideReason("");
        reload();
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const handleApprove = () => {
    setBusy(true);
    setError(null);
    api
      .approveScript(projectId)
      .then((r) => {
        setApproval(r);
        reload();
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const submitRevisionRequest = () => {
    if (!revisionInstruction.trim()) return;
    setBusy(true);
    api
      .requestScriptRevision(projectId, { instruction: revisionInstruction.trim() })
      .then(() => {
        setRevisionOpen(false);
        setRevisionInstruction("");
        reload();
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-3)",
          padding: "var(--space-3) var(--space-5)",
          borderBottom: "1px solid var(--border)",
          background: scriptApproved ? "var(--surface-2)" : "var(--accent-muted)",
          position: "sticky",
          top: 0,
          zIndex: 5
        }}
      >
        <div style={{ fontSize: "var(--text-sm)" }}>
          {scriptApproved ? <span>Script approved ({production}).</span> : <span>Script is under review. Approving unlocks production.</span>}
          {anyRequiresReview && <span style={{ color: "var(--warning, #D9B65B)", marginLeft: 12 }}>Some claims require provenance review.</span>}
          {error && <span style={{ color: "var(--danger, #D9685F)", marginLeft: 12 }}>{error}</span>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-secondary" onClick={() => setRevisionOpen(true)}>
            Request Revision
          </button>
          <button type="button" className="btn btn-primary" onClick={handleApprove} disabled={busy || scriptApproved}>
            {scriptApproved ? "Approved" : "Approve Script"}
          </button>
        </div>
      </div>
      {approval && approval.warnings.length > 0 && (
        <div className="error-banner" style={{ margin: "var(--space-2) var(--space-5)" }}>
          Approved with warnings: {approval.warnings.slice(0, 3).join("; ")}
        </div>
      )}

      <div className="script-content" style={{ maxWidth: 840, margin: "0 auto", padding: "var(--space-6) var(--space-5) var(--space-8)" }}>
        <div className="script-hero" style={{ marginBottom: "var(--space-6)", borderBottom: "1px solid var(--border)", paddingBottom: "var(--space-4)" }}>
          <h1 className="script-hero-title" style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-3xl)", fontWeight: 600, margin: 0, lineHeight: 1.2 }}>
            {script.title || "Documentary Script"}
          </h1>
          <div className="script-hero-meta" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: "var(--space-2)" }}>
            {script.scenes.length} scenes · {script.totalWordCount || 1850} words · ~{(script.totalWordCount ? (script.totalWordCount / 189).toFixed(1) : "8.0")} min narration
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          {script.scenes.map((scene: any, idx: number) => {
            const claims = scene.scriptClaims || [];
            const isEditing = editingScene === scene.id;
            return (
              <section
                key={scene.id || idx}
                style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--accent)", fontWeight: 600 }}>
                    SCENE {String(idx + 1).padStart(2, "0")} · {scene.id}
                    {scene.editedBy === "HUMAN" && <span className="badge badge-neutral" style={{ marginLeft: 8, fontSize: "var(--text-2xs)" }}>edited</span>}
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    {!isEditing && (
                      <button type="button" className="btn btn-secondary" style={{ fontSize: "var(--text-xs)", padding: "2px 8px" }} onClick={() => startEdit(scene)}>
                        Edit Narration
                      </button>
                    )}
                    <button type="button" className="btn btn-secondary" style={{ fontSize: "var(--text-xs)", padding: "2px 8px" }} onClick={() => handleDeleteScene(scene.id)}>
                      Delete
                    </button>
                    <button type="button" className="btn btn-secondary" style={{ fontSize: "var(--text-xs)", padding: "2px 8px" }} onClick={() => navigate("editor", projectId, { scene: scene.id })}>
                      Edit in Studio &rarr;
                    </button>
                  </div>
                </div>

                {isEditing ? (
                  <div>
                    <textarea
                      value={draftNarration}
                      onChange={(e) => setDraftNarration(e.target.value)}
                      rows={4}
                      style={{ width: "100%", fontSize: "var(--text-md)", lineHeight: 1.6, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text)", padding: "var(--space-2)" }}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 6, justifyContent: "flex-end" }}>
                      <button type="button" className="btn btn-secondary" onClick={() => setEditingScene(null)}>
                        Cancel
                      </button>
                      <button type="button" className="btn btn-primary" onClick={() => saveEdit(scene.id)} disabled={busy}>
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-md)", lineHeight: 1.65, color: "var(--text)", margin: 0 }}>{scene.narration}</p>
                )}

                {claims.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: "var(--space-2)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--border)" }}>
                    {claims.map((c: any, cIdx: number) => {
                      const flagged = c.provenanceStatus === "PROVENANCE_REQUIRES_REVIEW";
                      const overridden = c.provenanceStatus === "HUMAN_OVERRIDDEN";
                      return (
                        <div key={c.scriptClaimId || cIdx} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
                          <span className={`badge ${flagged ? "badge-warning" : "badge-neutral"}`} style={{ fontSize: "var(--text-2xs)" }}>
                            {c.claimText?.slice(0, 32)}…
                          </span>
                          {c.provenanceStatus && (
                            <span className={`badge ${flagged ? "badge-warning" : overridden ? "badge-neutral" : "badge-success"}`} style={{ fontSize: "var(--text-2xs)" }}>
                              {c.provenanceStatus}
                            </span>
                          )}
                          {(c.evidenceIds || []).map((evId: string) => (
                            <button
                              key={evId}
                              type="button"
                              className="badge"
                              style={{ background: "var(--surface-3)", color: "var(--accent)", border: "1px solid var(--border)", cursor: "pointer", fontSize: "var(--text-2xs)" }}
                              onClick={() => handleEvidenceClick(evId)}
                            >
                              [{evId}]
                            </button>
                          ))}
                          {flagged && (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ fontSize: "var(--text-2xs)", padding: "1px 6px" }}
                              onClick={() => setOverridingClaim({ sceneId: scene.id, claimId: c.scriptClaimId })}
                            >
                              Override…
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {popoverEvidence && (
        <div className="modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setPopoverEvidence(null)}>
          <div className="modal" style={{ width: 520, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "var(--space-4)", boxShadow: "var(--shadow-md)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-3)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="badge badge-neutral" style={{ fontSize: "var(--text-2xs)" }}>Evidence Detail</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--accent)" }}>{popoverEvidence.evidenceId}</span>
              </div>
              <button type="button" className="icon-btn" onClick={() => setPopoverEvidence(null)} aria-label="Close">
                <CloseIcon size={16} />
              </button>
            </div>
            <blockquote style={{ margin: "0 0 var(--space-3)", padding: "var(--space-3)", background: "var(--surface-2)", borderLeft: "3px solid var(--accent)", borderRadius: "0 var(--radius-sm) var(--radius-sm) 0", fontSize: "var(--text-sm)", fontStyle: "italic", lineHeight: 1.5, color: "var(--text)" }}>
              "{popoverEvidence.evidenceExcerpt || popoverEvidence.quote || popoverEvidence.claim || "Verified research excerpt."}"
            </blockquote>
            {popoverEvidence.source && (
              <div style={{ background: "var(--surface-2)", padding: "var(--space-3)", borderRadius: "var(--radius-md)", fontSize: "var(--text-xs)" }}>
                <div style={{ fontWeight: 600, color: "var(--text)" }}>{popoverEvidence.source.title}</div>
                <div style={{ color: "var(--text-secondary)", marginTop: 2 }}>{popoverEvidence.source.author || "Primary Research"}</div>
                {popoverEvidence.source.url && (
                  <a href={popoverEvidence.source.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", display: "block", marginTop: 4, textDecoration: "underline" }}>
                    {popoverEvidence.source.url}
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {overridingClaim && (
        <div className="modal-overlay" onClick={() => setOverridingClaim(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Override provenance review</h3>
            <p style={{ fontSize: "var(--text-sm)" }}>Explain why this claim's number is correct despite the flag. This is recorded, never silent.</p>
            <textarea
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              rows={3}
              style={{ width: "100%", background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: "var(--radius-sm)", padding: "var(--space-2)" }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: "var(--space-3)" }}>
              <button type="button" className="btn btn-secondary" onClick={() => setOverridingClaim(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={submitOverride} disabled={busy || !overrideReason.trim()}>
                Override
              </button>
            </div>
          </div>
        </div>
      )}

      {revisionOpen && (
        <div className="modal-overlay" onClick={() => setRevisionOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Request Script Revision</h3>
            <textarea
              value={revisionInstruction}
              onChange={(e) => setRevisionInstruction(e.target.value)}
              placeholder='e.g. "Cut 120 words without losing the core argument" or "Rewrite the opening to be stronger"'
              rows={4}
              style={{ width: "100%", background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: "var(--radius-sm)", padding: "var(--space-2)" }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: "var(--space-3)" }}>
              <button type="button" className="btn btn-secondary" onClick={() => setRevisionOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={submitRevisionRequest} disabled={busy || !revisionInstruction.trim()}>
                Send Request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
