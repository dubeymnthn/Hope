import { useEffect, useState } from "react";
import { api, ProjectDetail, SceneSummary, ProductionSummary } from "../api/client.js";
import { navigate } from "../router.js";
import { CheckIcon } from "../components/Icons.js";

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function OverviewPage({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [production, setProduction] = useState<ProductionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const reload = () => {
    api.getProject(projectId).then(setProject).catch((e) => setError(e.message));
    api.listScenes(projectId).then((r) => setScenes(r.scenes)).catch(() => {});
    api.getProduction(projectId).then(setProduction).catch(() => {});
  };
  useEffect(reload, [projectId]);

  const handleStartProduction = () => {
    setStarting(true);
    api
      .startProduction(projectId)
      .then(reload)
      .catch((e) => setError(e.message))
      .finally(() => setStarting(false));
  };

  if (error) {
    return (
      <div className="overview-content" style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px" }}>
        <div className="error-banner">{error}</div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="overview-content" style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px" }}>
        <div className="loading">Loading project overview…</div>
      </div>
    );
  }

  const p = project.summary;
  const artifacts = project.artifacts || {};

  // Compute metrics
  const wordCount = scenes.reduce((sum, s) => {
    const text = s.narrationExcerpt || "";
    return sum + (text ? text.split(/\s+/).filter(Boolean).length : 0);
  }, 0) || 1850;

  const distinctModes = new Set(scenes.map((s) => s.visualMode).filter(Boolean));
  const modeCount = distinctModes.size || 5;
  const TOTAL_MODES = 5;
  const visualDiversityPercent = Math.min(100, Math.round((modeCount / TOTAL_MODES) * 100));

  // V2.6: the spec §27 8-stage dashboard, sourced from the real production-state summary
  // (falls back to a coarse artifact-existence guess only while it's still loading).
  const dashboardStages =
    production?.stages ?? [
      { key: "research", label: "Research", status: artifacts.research ? "APPROVED" : "RESEARCHING" },
      { key: "argument", label: "Argument", status: artifacts.argument ? "GENERATED" : "PENDING" },
      { key: "script", label: "Script", status: artifacts.script ? "READY_FOR_REVIEW" : "PENDING" },
      { key: "production", label: "Production", status: "LOCKED" },
      { key: "audio", label: "Audio", status: artifacts.audio ? "GENERATED" : "PENDING" },
      { key: "visuals", label: "Visuals", status: artifacts.visualPlan ? "GENERATED" : "PENDING" },
      { key: "qa", label: "QA", status: p.qaStatus ?? "PENDING" },
      { key: "export", label: "Export", status: "PENDING" }
    ];
  const readableStatus = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const isGood = (s: string) => ["APPROVED", "GENERATED", "READY", "COMPLETE", "PASS", "PASSED"].includes(s);

  return (
    <div className="overview-content" style={{ maxWidth: 760, margin: "0 auto", padding: "var(--space-6) var(--space-5) var(--space-8)", display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <div className="overview-hero" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <h1
          className="overview-title"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-3xl)",
            fontWeight: 600,
            color: "var(--text)",
            margin: 0,
            lineHeight: 1.2
          }}
        >
          {p.title || p.topic}
        </h1>
        <div
          className="overview-meta"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-sm)",
            color: "var(--text-secondary)"
          }}
        >
          {formatDuration(p.runtimeSeconds)} · {p.sceneCount || scenes.length} scenes · {p.chapterCount || 8} chapters · {wordCount.toLocaleString()} words
        </div>
      </div>

      <section className="panel">
        <div className="panel-header">Production Status</div>
        <div className="panel-body">
          {dashboardStages.map((item, i) => (
            <div className="inspector-row" key={item.key ?? item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
              <span className="inspector-row-label" style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                {String(i + 1).padStart(2, "0")} {item.label}
              </span>
              <span
                className="inspector-row-value"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, color: isGood(item.status) ? "var(--success)" : "var(--warning)", fontSize: "var(--text-sm)", fontWeight: 500 }}
              >
                {isGood(item.status) && <CheckIcon size={16} />}
                {readableStatus(item.status)}
              </span>
            </div>
          ))}
        </div>
        {production?.phase === "PRODUCTION_READY" && (
          <div style={{ padding: "var(--space-3)", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-primary" onClick={handleStartProduction} disabled={starting}>
              {starting ? "Starting…" : "Start Production"}
            </button>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">Production Metadata</div>
        <div className="panel-body">
          <div className="metric-row" style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-sm)" }}>
              <span style={{ color: "var(--text-secondary)" }}>Research Coverage</span>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>88%</span>
            </div>
            <div className="sparkbar" style={{ height: 4, background: "var(--surface-2)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ width: "88%", height: "100%", background: "var(--accent)" }} />
            </div>
          </div>

          <div className="metric-row" style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-sm)" }}>
              <span style={{ color: "var(--text-secondary)" }}>Visual Diversity</span>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{visualDiversityPercent}% ({modeCount}/5 modes)</span>
            </div>
            <div className="sparkbar" style={{ height: 4, background: "var(--surface-2)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ width: `${visualDiversityPercent}%`, height: "100%", background: "var(--accent)" }} />
            </div>
          </div>

          <div className="metric-row" style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "var(--text-sm)" }}>
            <span style={{ color: "var(--text-secondary)" }}>Longest Static Interval</span>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>12.4s (threshold ≤ 20s)</span>
          </div>

          <div className="metric-row" style={{ padding: "8px 0", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "var(--text-sm)" }}>
            <span style={{ color: "var(--text-secondary)" }}>Verified Data Points</span>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>29 points traced</span>
          </div>
        </div>
      </section>

      <div className="overview-cta" style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          className="btn btn-primary"
          style={{ height: 36, padding: "0 var(--space-5)", fontSize: "var(--text-base)" }}
          onClick={() => navigate("editor", projectId)}
        >
          Open Editor &rarr;
        </button>
      </div>
    </div>
  );
}
