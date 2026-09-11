import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { CheckIcon, WarningIcon, DangerIcon } from "../components/Icons.js";

export function QAPage({ projectId }: { projectId: string }) {
  const [qa, setQa] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getQa(projectId)
      .then(setQa)
      .catch((e) => setError(e.message));
  }, [projectId]);

  if (error) return <div className="error-banner" style={{ margin: "var(--space-4)" }}>{error}</div>;
  if (!qa) return <div className="loading">Loading QA reports…</div>;

  const sections = [
    { title: "Media QA", report: qa.media, desc: "FFmpeg integrity, subtitle sync, video encoding specs" },
    { title: "Script & Claim Gate", report: qa.script, desc: "Claim-to-evidence traceability and reading rate validation" },
    { title: "Visual Style QA", report: qa.visualStyle, desc: "Rhythm metrics, visual mode variety, static interval thresholds" }
  ];

  const overallPassed = sections.every((s) => !s.report || s.report.status === "pass" || s.report.status === "PASS");

  return (
    <div className="studio-page" style={{ padding: "var(--space-6) var(--space-8) var(--space-8)", display: "flex", flexDirection: "column", gap: "var(--space-5)", maxWidth: 1200 }}>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-3xl)", margin: 0, fontWeight: 600 }}>
            Project QA
          </h1>
          <p className="page-subtitle" style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", margin: "var(--space-1) 0 0" }}>
            Research, provenance, visual, audio and export checks — verified before every export.
          </p>
        </div>
      </div>

      {/* Overall Gate Banner */}
      <div
        className="panel qa-overall"
        style={{
          background: "var(--panel)",
          border: overallPassed ? "1px solid var(--success)" : "1px solid var(--warning)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--space-5)",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-4)"
        }}
      >
        <div style={{ color: overallPassed ? "var(--success)" : "var(--warning)" }}>
          {overallPassed ? <CheckIcon size={36} /> : <WarningIcon size={36} />}
        </div>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-xl)", fontWeight: 600, color: "var(--text)" }}>
            Overall QA Verdict: {overallPassed ? "Pass" : "Review Recommended"}
          </div>
          <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", margin: "var(--space-1) 0 0" }}>
            {overallPassed
              ? "All critical pipeline gates passed. Video artifact is structurally compliant and ready for export."
              : "Some non-blocking visual rhythm or timing warnings were identified."}
          </p>
        </div>
      </div>

      {/* Checklist Sections */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "var(--space-4)" }}>
        {sections.map((sec) => {
          const report = sec.report;
          const status = report ? (report.status || "pass").toUpperCase() : "PENDING";
          const isPass = status === "PASS";
          const isWarn = status === "WARN" || status === "WARNING";

          return (
            <div
              key={sec.title}
              className="panel"
              style={{
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
                padding: "var(--space-4)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-3)"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: "var(--text-md)", color: "var(--text)" }}>
                  {sec.title}
                </span>
                <span className={`badge ${isPass ? "badge-success" : isWarn ? "badge-warning" : "badge-danger"}`}>
                  {status}
                </span>
              </div>

              <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", margin: 0 }}>
                {sec.desc}
              </p>

              {report ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: "var(--space-2)" }}>
                  {(report.checks || []).map((c: any, cIdx: number) => (
                    <div
                      key={cIdx}
                      style={{
                        padding: "6px 8px",
                        background: "var(--surface-2)",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border)",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        fontSize: "var(--text-xs)"
                      }}
                    >
                      <div style={{ color: c.passed ? "var(--success)" : "var(--danger)", marginTop: 1 }}>
                        {c.passed ? <CheckIcon size={14} /> : <DangerIcon size={14} />}
                      </div>
                      <div style={{ flex: 1 }}>
                        <span style={{ color: "var(--text)", fontWeight: 500 }}>{c.name}</span>
                        {c.message && (
                          <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-2xs)", marginTop: 2 }}>
                            {c.message}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state" style={{ padding: "var(--space-4)" }}>
                  Not evaluated yet. Run production to generate this report.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
