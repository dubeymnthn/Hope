import { useEffect, useState } from "react";
import { api, DesignInfo } from "../api/client.js";

/**
 * V2.6 design.md workbench (spec §36-37). Deliberately shows the STRUCTURED strategy as
 * data, not a rendered preview — actually rendering sample compositions pre-production
 * would need fabricated scene timing that doesn't exist yet at this point in the pipeline
 * (see CLAUDE.md V2.6 notes for why that's scoped out).
 */
export function DesignPage({ projectId }: { projectId: string }) {
  const [info, setInfo] = useState<DesignInfo | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    api
      .getDesign(projectId)
      .then((d) => {
        setInfo(d);
        setDraft(d.designMd ?? "");
      })
      .catch((e) => setError(e.message));
  };
  useEffect(reload, [projectId]);

  const save = () => {
    setBusy(true);
    setError(null);
    api
      .saveDesign(projectId, draft)
      .then(setInfo)
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const generate = () => {
    setBusy(true);
    setError(null);
    api
      .generateDesignStrategy(projectId)
      .then((r) => {
        if (r.status === "pending") {
          setError(`Waiting on the Antigravity agent to interpret design.md (brief: ${r.briefPath}).`);
        } else if (r.status === "no-design-md") {
          setError("Save a design.md first.");
        }
        reload();
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  if (!info) return <div className="loading">Loading design…</div>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 420px", gap: "var(--space-5)", padding: "var(--space-5)", maxWidth: 1400, margin: "0 auto" }}>
      <section className="panel" style={{ display: "flex", flexDirection: "column" }}>
        <div className="panel-header">design.md — visual style brief (never facts)</div>
        <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {error && <div className="error-banner">{error}</div>}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={20}
            placeholder={
              "# Visual Identity\nRestrained editorial documentary, warm muted palette.\n\n# Pacing\nSlow, deliberate reveals.\n\n# Scene 08\nTechnical blueprint treatment."
            }
            style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: "var(--radius-sm)", padding: "var(--space-3)" }}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-secondary" onClick={save} disabled={busy || draft === (info.designMd ?? "")}>
              Save
            </button>
            <button type="button" className="btn btn-primary" onClick={generate} disabled={busy || !draft.trim()}>
              {info.strategy ? "Regenerate Strategy" : "Generate Strategy"}
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          Structured Design Strategy
          {info.stale && info.strategy && (
            <span className="badge badge-warning" style={{ marginLeft: 8, fontSize: "var(--text-2xs)" }}>
              STALE — regenerate
            </span>
          )}
        </div>
        <div className="panel-body">
          {!info.strategy ? (
            <div className="empty-state">No design strategy generated yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", fontSize: "var(--text-sm)" }}>
              {Object.entries(info.strategy.global ?? {}).map(([key, value]) => {
                if (!value || (Array.isArray(value) && value.length === 0)) return null;
                return (
                  <div key={key} style={{ borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
                    <div style={{ fontSize: "var(--text-2xs)", textTransform: "uppercase", color: "var(--text-secondary)" }}>{key}</div>
                    <div style={{ color: "var(--text)" }}>{Array.isArray(value) ? value.join(", ") : String(value)}</div>
                  </div>
                );
              })}
              {Object.keys(info.strategy.chapterOverrides ?? {}).length > 0 && (
                <div>
                  <div style={{ fontSize: "var(--text-2xs)", textTransform: "uppercase", color: "var(--text-secondary)" }}>Chapter Overrides</div>
                  {Object.keys(info.strategy.chapterOverrides).map((k) => (
                    <span key={k} className="badge badge-neutral" style={{ marginRight: 6, marginTop: 4 }}>
                      {k}
                    </span>
                  ))}
                </div>
              )}
              {Object.keys(info.strategy.sceneOverrides ?? {}).length > 0 && (
                <div>
                  <div style={{ fontSize: "var(--text-2xs)", textTransform: "uppercase", color: "var(--text-secondary)" }}>Scene Overrides</div>
                  {Object.keys(info.strategy.sceneOverrides).map((k) => (
                    <span key={k} className="badge badge-neutral" style={{ marginRight: 6, marginTop: 4 }}>
                      {k}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
