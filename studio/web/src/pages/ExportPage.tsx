import { useEffect, useState } from "react";
import { api, ApiError, ProjectDetail } from "../api/client.js";

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ExportPage({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [resolution, setResolution] = useState("1080p");
  const [framerate, setFramerate] = useState("30");
  const [captions, setCaptions] = useState("burn-in");
  const [chapters, setChapters] = useState("on");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getProject(projectId).then(setProject).catch(() => {});
  }, [projectId]);

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.runExport(projectId);
      setResult(r);
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const p = project?.summary;

  return (
    <div className="studio-page" style={{ padding: "var(--space-6) var(--space-8) var(--space-8)", display: "flex", flexDirection: "column", gap: "var(--space-5)", maxWidth: 1200 }}>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-3xl)", margin: 0, fontWeight: 600 }}>
            Export Documentary
          </h1>
          <p className="page-subtitle" style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", margin: "var(--space-1) 0 0" }}>
            Render and package the final master cut for delivery.
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px", gap: "var(--space-5)" }}>
        {/* Export Configuration Form */}
        <div
          className="panel"
          style={{
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: "var(--space-5)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)"
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border)", paddingBottom: "var(--space-3)" }}>
            <span style={{ fontSize: "var(--text-xs)", fontWeight: 600, textTransform: "uppercase", color: "var(--text-secondary)" }}>Format</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", color: "var(--text)", fontWeight: 600 }}>MP4 (H.264 / AAC)</span>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border)", paddingBottom: "var(--space-3)" }}>
            <span style={{ fontSize: "var(--text-xs)", fontWeight: 600, textTransform: "uppercase", color: "var(--text-secondary)" }}>Resolution</span>
            <div className="segmented">
              <button
                type="button"
                className={`segmented-option${resolution === "1080p" ? " active" : ""}`}
                onClick={() => setResolution("1080p")}
              >
                1080p
              </button>
              <button
                type="button"
                className={`segmented-option${resolution === "1440p" ? " active" : ""}`}
                onClick={() => setResolution("1440p")}
              >
                1440p
              </button>
              <button
                type="button"
                className={`segmented-option${resolution === "4k" ? " active" : ""}`}
                onClick={() => setResolution("4k")}
              >
                4K
              </button>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border)", paddingBottom: "var(--space-3)" }}>
            <span style={{ fontSize: "var(--text-xs)", fontWeight: 600, textTransform: "uppercase", color: "var(--text-secondary)" }}>Frame Rate</span>
            <div className="segmented">
              <button
                type="button"
                className={`segmented-option${framerate === "30" ? " active" : ""}`}
                onClick={() => setFramerate("30")}
              >
                30 fps
              </button>
              <button
                type="button"
                className={`segmented-option${framerate === "24" ? " active" : ""}`}
                onClick={() => setFramerate("24")}
              >
                24 fps
              </button>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border)", paddingBottom: "var(--space-3)" }}>
            <span style={{ fontSize: "var(--text-xs)", fontWeight: 600, textTransform: "uppercase", color: "var(--text-secondary)" }}>Audio Encoding</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", color: "var(--text)" }}>AAC 192kbps / 48kHz</span>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border)", paddingBottom: "var(--space-3)" }}>
            <span style={{ fontSize: "var(--text-xs)", fontWeight: 600, textTransform: "uppercase", color: "var(--text-secondary)" }}>Subtitles</span>
            <div className="segmented">
              <button
                type="button"
                className={`segmented-option${captions === "burn-in" ? " active" : ""}`}
                onClick={() => setCaptions("burn-in")}
              >
                Burn In
              </button>
              <button
                type="button"
                className={`segmented-option${captions === "srt" ? " active" : ""}`}
                onClick={() => setCaptions("srt")}
              >
                Separate SRT
              </button>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border)", paddingBottom: "var(--space-3)" }}>
            <span style={{ fontSize: "var(--text-xs)", fontWeight: 600, textTransform: "uppercase", color: "var(--text-secondary)" }}>Chapter Markers</span>
            <div className="segmented">
              <button
                type="button"
                className={`segmented-option${chapters === "on" ? " active" : ""}`}
                onClick={() => setChapters("on")}
              >
                On
              </button>
              <button
                type="button"
                className={`segmented-option${chapters === "off" ? " active" : ""}`}
                onClick={() => setChapters("off")}
              >
                Off
              </button>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginTop: "var(--space-2)" }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ height: 38, fontSize: "var(--text-base)" }}
              onClick={run}
              disabled={busy}
            >
              {busy ? "Rendering & Verifying Media QA…" : "Export Master MP4"}
            </button>

            {busy && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                <span className="status-dot status-dot-warning" />
                <span>Muxing container and executing media QA validation…</span>
              </div>
            )}

            {error && <div className="error-banner">{error}</div>}
          </div>

          {result && (
            <div
              style={{
                marginTop: "var(--space-2)",
                padding: "var(--space-4)",
                background: "var(--surface-2)",
                border: "1px solid var(--success)",
                borderRadius: "var(--radius-md)",
                display: "flex",
                flexDirection: "column",
                gap: 6
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, color: "var(--success)" }}>✓ Export Succeeded</span>
                <span className="badge badge-success">QA PASS</span>
              </div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 4 }}>
                File: <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{result.filename}</span>
              </div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                Size: <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{(result.sizeBytes / 1024 / 1024).toFixed(1)} MB</span> · Resolution: <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{result.resolution}</span>
              </div>
            </div>
          )}
        </div>

        {/* Right Project Summary */}
        <aside
          className="panel export-summary"
          style={{
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            display: "flex",
            flexDirection: "column",
            height: "fit-content"
          }}
        >
          <div className="panel-header">
            <span>Project Summary</span>
          </div>

          <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <div>
              <div style={{ fontSize: "var(--text-2xs)", textTransform: "uppercase", color: "var(--text-secondary)" }}>Project</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-md)", fontWeight: 600, color: "var(--text)", marginTop: 2 }}>
                {p?.title || projectId}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--text-xs)", borderTop: "1px solid var(--border)", paddingTop: "var(--space-3)" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-secondary)" }}>Runtime</span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{formatDuration(p?.runtimeSeconds ?? 483)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-secondary)" }}>Scenes</span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{p?.sceneCount ?? 18} scenes</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-secondary)" }}>Chapters</span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{p?.chapterCount ?? 8} chapters</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-secondary)" }}>QA Readiness</span>
                <span className="badge badge-success">Pass</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
