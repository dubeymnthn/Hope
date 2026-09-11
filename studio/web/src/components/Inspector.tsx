import { useEffect, useState } from "react";
import { api, SceneDetail } from "../api/client.js";
import { ProvenancePanel } from "./ProvenancePanel.js";
import { SceneIcon, EditorIcon, StoryboardIcon, MapIcon, DocumentIcon } from "./Icons.js";

function getVisualModeIcon(mode?: string, size = 14) {
  switch (mode) {
    case "real-video":
      return <SceneIcon size={size} />;
    case "generated":
      return <EditorIcon size={size} />;
    case "comparison":
      return <StoryboardIcon size={size} />;
    case "map":
      return <MapIcon size={size} />;
    case "document":
      return <DocumentIcon size={size} />;
    default:
      return <SceneIcon size={size} />;
  }
}

export function Inspector({
  projectId,
  sceneId,
  onSceneChanged
}: {
  projectId: string;
  sceneId: string;
  onSceneChanged: () => void;
}) {
  const [scene, setScene] = useState<SceneDetail | null>(null);
  const [tab, setTab] = useState<"scene" | "beat">("scene");
  const [activeBeatIdx, setActiveBeatIdx] = useState(0);
  const [narrationText, setNarrationText] = useState("");
  const [savingNarration, setSavingNarration] = useState(false);
  const [narrationSuccess, setNarrationSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    api
      .getScene(projectId, sceneId)
      .then((s) => {
        setScene(s);
        setNarrationText(s.narration || "");
      })
      .catch((e) => setError(e.message));
  };

  useEffect(reload, [projectId, sceneId]);

  if (error) return <div className="error-banner" style={{ margin: "var(--space-3)" }}>{error}</div>;
  if (!scene) return <div className="loading">Loading inspector…</div>;

  const beats = scene.beats || [];
  const currentBeat = beats[activeBeatIdx] || beats[0];
  const qaState = (scene.qaState || "pass").toLowerCase();
  const qaBadgeClass = qaState === "pass" ? "badge-success" : qaState === "warning" ? "badge-warning" : "badge-danger";

  const handleSaveNarration = async () => {
    setSavingNarration(true);
    setNarrationSuccess(false);
    try {
      await api.patchNarration(projectId, sceneId, narrationText);
      setNarrationSuccess(true);
      setTimeout(() => setNarrationSuccess(false), 2500);
      reload();
      onSceneChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingNarration(false);
    }
  };

  const handleRegenerateNarration = async () => {
    try {
      await api.regenerateNarration(projectId, sceneId);
      reload();
      onSceneChanged();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <section className="panel inspector-panel" aria-label="Inspector" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Inspector</span>
        <span className={`badge ${qaBadgeClass}`} style={{ textTransform: "uppercase" }}>
          {scene.qaState || "Pass"}
        </span>
      </div>

      <div className="inspector-body" style={{ flex: 1, overflowY: "auto", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        {/* Top Tabs */}
        <div className="tabs" role="tablist" aria-label="Inspector tabs" style={{ borderBottom: "1px solid var(--border)", display: "flex" }}>
          <button
            type="button"
            className={`tab${tab === "scene" ? " active" : ""}`}
            style={{
              flex: 1,
              padding: "8px",
              background: "transparent",
              border: "none",
              borderBottom: tab === "scene" ? "2px solid var(--accent)" : "2px solid transparent",
              color: tab === "scene" ? "var(--text)" : "var(--text-secondary)",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              cursor: "pointer"
            }}
            onClick={() => setTab("scene")}
          >
            Scene
          </button>
          <button
            type="button"
            className={`tab${tab === "beat" ? " active" : ""}`}
            style={{
              flex: 1,
              padding: "8px",
              background: "transparent",
              border: "none",
              borderBottom: tab === "beat" ? "2px solid var(--accent)" : "2px solid transparent",
              color: tab === "beat" ? "var(--text)" : "var(--text-secondary)",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              cursor: "pointer"
            }}
            onClick={() => setTab("beat")}
          >
            Beat ({beats.length})
          </button>
        </div>

        {tab === "scene" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {/* Scene Header summary */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "var(--accent)" }}>{getVisualModeIcon(scene.visualMode, 18)}</span>
                <span style={{ fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: "var(--text-md)" }}>
                  {scene.sceneId}
                </span>
              </div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                {scene.duration ? `${scene.duration.toFixed(1)}s` : "—"}
              </span>
            </div>

            {/* Key Metadata Rows */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--text-xs)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ color: "var(--text-secondary)" }}>Visual Mode</span>
                <span style={{ color: "var(--text)", textTransform: "capitalize" }}>{scene.visualMode ?? "Standard"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ color: "var(--text-secondary)" }}>TTS Speech Rate</span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>189 WPM</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ color: "var(--text-secondary)" }}>Camera Direction</span>
                <span style={{ color: "var(--text)" }}>{scene.camera ?? "Slow push-in"}</span>
              </div>
            </div>

            {/* Narration Editor */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ fontSize: "var(--text-xs)", fontWeight: 600, textTransform: "uppercase", color: "var(--text-secondary)" }}>
                  Narration Script
                </label>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }}>
                  {narrationText.split(/\s+/).filter(Boolean).length} words
                </span>
              </div>

              <textarea
                className="input"
                style={{
                  width: "100%",
                  minHeight: 110,
                  fontSize: "var(--text-sm)",
                  lineHeight: 1.4,
                  padding: "var(--space-2)",
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  resize: "vertical"
                }}
                value={narrationText}
                onChange={(e) => setNarrationText(e.target.value)}
              />

              <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end", marginTop: 4 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: "var(--text-xs)" }}
                  onClick={handleRegenerateNarration}
                  title="Resynthesize TTS for this scene"
                >
                  Resynthesize Voice
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ fontSize: "var(--text-xs)" }}
                  onClick={handleSaveNarration}
                  disabled={savingNarration || narrationText === scene.narration}
                >
                  {savingNarration ? "Saving…" : narrationSuccess ? "Saved ✓" : "Save Narration"}
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === "beat" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {beats.length > 0 ? (
              <>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {beats.map((b: any, idx: number) => (
                    <button
                      key={b.id || idx}
                      type="button"
                      className={`btn ${idx === activeBeatIdx ? "btn-primary" : "btn-secondary"}`}
                      style={{ fontSize: "var(--text-xs)", padding: "2px 8px", height: 26 }}
                      onClick={() => setActiveBeatIdx(idx)}
                    >
                      Beat {idx + 1}
                    </button>
                  ))}
                </div>

                {currentBeat && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: "var(--text-xs)", background: "var(--surface-2)", padding: "var(--space-3)", borderRadius: "var(--radius-md)", border: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--text-secondary)" }}>Timing</span>
                      <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
                        {currentBeat.start?.toFixed(1) ?? "0.0"}s - {currentBeat.end?.toFixed(1) ?? "—"}s ({(currentBeat.duration || (currentBeat.end - currentBeat.start))?.toFixed(1)}s)
                      </span>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--text-secondary)" }}>Change Type</span>
                      <span style={{ textTransform: "capitalize", color: "var(--text)" }}>{currentBeat.changeType ?? "cut"}</span>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--text-secondary)" }}>Visual Purpose</span>
                      <span className="badge badge-neutral">{currentBeat.purpose ?? currentBeat.visualPurpose ?? "ESTABLISH"}</span>
                    </div>

                    {currentBeat.description && (
                      <div style={{ marginTop: 4, color: "var(--text-secondary)", fontSize: "var(--text-2xs)" }}>
                        {currentBeat.description}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)" }}>
                No scheduled beats in this scene.
              </div>
            )}
          </div>
        )}

        {/* Provenance Section */}
        <div className="inspector-provenance" style={{ marginTop: "auto", borderTop: "1px solid var(--border)", paddingTop: "var(--space-3)" }}>
          <div
            className="inspector-provenance-header"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-xs)",
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--text-secondary)",
              marginBottom: "var(--space-2)"
            }}
          >
            Provenance
          </div>
          <ProvenancePanel projectId={projectId} scene={scene} />
        </div>
      </div>
    </section>
  );
}
