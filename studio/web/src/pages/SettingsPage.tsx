import { useEffect, useState } from "react";
import { api } from "../api/client.js";

export function SettingsPage() {
  const [runtime, setRuntime] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then(setRuntime)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error-banner" style={{ margin: "var(--space-4)" }}>{error}</div>;
  if (!runtime) return <div className="loading">Loading environment configuration…</div>;

  return (
    <div style={{ padding: "var(--space-6) var(--space-8) var(--space-8)", maxWidth: 780 }}>
      <div style={{ marginBottom: "var(--space-5)" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-3xl)", margin: 0, fontWeight: 600 }}>
          Runtime & Infrastructure Settings
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", margin: "var(--space-1) 0 0" }}>
          Deterministic preflight checks, TTS acceleration device, and rendering toolchain diagnostics.
        </p>
      </div>

      <div className="panel" style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
        <div className="panel-header">
          <span>System Environment (Read-Only)</span>
        </div>

        <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: "var(--text-sm)" }}>
            <span style={{ color: "var(--text-secondary)" }}>Platform & Architecture</span>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{runtime.platform} / {runtime.arch}</span>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: "var(--text-sm)" }}>
            <span style={{ color: "var(--text-secondary)" }}>Node Engine</span>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{runtime.node}</span>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: "var(--text-sm)" }}>
            <span style={{ color: "var(--text-secondary)" }}>TTS Device & Acceleration</span>
            <span style={{ color: "var(--accent)", fontWeight: 500 }}>
              {runtime.ttsDevice} ({runtime.ttsDeviceSource})
            </span>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: "var(--text-sm)" }}>
            <span style={{ color: "var(--text-secondary)" }}>Python Environment</span>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{runtime.pythonVersion ?? "Not found"} ({runtime.pythonEnv ?? "—"})</span>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: "var(--text-sm)" }}>
            <span style={{ color: "var(--text-secondary)" }}>Chatterbox TTS Engine</span>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{runtime.chatterboxVersion ?? "Installed"}</span>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: "var(--text-sm)" }}>
            <span style={{ color: "var(--text-secondary)" }}>HyperFrames Canvas Renderer</span>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{runtime.hyperframesVersion ?? "v0.8.34"}</span>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "var(--text-sm)" }}>
            <span style={{ color: "var(--text-secondary)" }}>FFmpeg / FFprobe Binary</span>
            <span style={{ color: runtime.ffmpeg ? "var(--success)" : "var(--danger)", fontWeight: 500 }}>
              {runtime.ffmpeg ? "✓ Found on PATH" : "✗ Missing"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
