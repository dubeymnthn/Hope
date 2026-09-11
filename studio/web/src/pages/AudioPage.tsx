import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { VolumeIcon } from "../components/Icons.js";

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AudioPage({ projectId }: { projectId: string }) {
  const [data, setData] = useState<any>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [muteNarration, setMuteNarration] = useState(false);
  const [muteMusic, setMuteMusic] = useState(false);
  const [muteSfx, setMuteSfx] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getAudio(projectId)
      .then((d) => {
        setData(d);
        if (d.scenes?.length > 0) setSelectedSceneId(d.scenes[0].sceneId);
      })
      .catch((e) => setError(e.message));
  }, [projectId]);

  if (error) return <div className="error-banner" style={{ margin: "var(--space-4)" }}>{error}</div>;
  if (!data) return <div className="loading">Loading audio workspace…</div>;

  const totalDuration = data.totalDuration || 483;
  const scenes = data.scenes || [];
  const selectedScene = scenes.find((s: any) => s.sceneId === selectedSceneId) || scenes[0];

  let cursor = 0;
  const positionedScenes = scenes.map((s: any) => {
    const start = cursor;
    const duration = s.duration ?? 24;
    cursor += duration;
    return { ...s, start, duration };
  });

  return (
    <div className="studio-page" style={{ padding: "var(--space-6) var(--space-8) var(--space-8)", display: "flex", flexDirection: "column", gap: "var(--space-5)", maxWidth: 1600 }}>
      {/* Header */}
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <h1 className="page-title" style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-3xl)", margin: 0, fontWeight: 600 }}>
            Audio
          </h1>
          <p className="page-subtitle" style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", margin: "var(--space-1) 0 0" }}>
            Narration speech synthesis & ambient mix across the full <span className="mono" style={{ color: "var(--accent)" }}>{formatDuration(totalDuration)}</span> runtime
          </p>
        </div>
        {data.measurement && (
          <span className="badge badge-neutral" style={{ fontFamily: "var(--font-mono)" }}>
            {data.measurement.measuredWordsPerMinute} WPM · {data.measurement.device}
          </span>
        )}
      </div>

      {/* Main Audio Body */}
      <div className="audio-body" style={{ display: "flex", gap: "var(--space-4)", alignItems: "stretch", minHeight: 480 }}>
        {/* Workspace Timeline */}
        <div className="panel audio-workspace" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Audio Tracks</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
              {scenes.length} narration clips
            </span>
          </div>

          <div style={{ display: "flex", flex: 1, borderTop: "1px solid var(--border)" }}>
            {/* Left Mixer Column */}
            <div
              className="audio-heads-col"
              style={{
                width: 200,
                borderRight: "1px solid var(--border)",
                background: "var(--panel)",
                display: "flex",
                flexDirection: "column"
              }}
            >
              <div style={{ height: 32, borderBottom: "1px solid var(--border)" }} />

              {/* Narration Track Head */}
              <div style={{ height: 110, padding: "var(--space-3)", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: "var(--text-xs)" }}>Narration</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      type="button"
                      className="badge"
                      style={{ background: muteNarration ? "var(--danger)" : "var(--surface-3)", color: "var(--text)", cursor: "pointer" }}
                      onClick={() => setMuteNarration(!muteNarration)}
                    >
                      M
                    </button>
                    <button type="button" className="badge badge-neutral" style={{ cursor: "pointer" }}>S</button>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <VolumeIcon size={14} style={{ color: "var(--text-secondary)" }} />
                  <input type="range" className="slider" style={{ flex: 1 }} defaultValue={85} />
                </div>
              </div>

              {/* Music Track Head */}
              <div style={{ height: 100, padding: "var(--space-3)", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: "var(--text-xs)" }}>Music</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      type="button"
                      className="badge"
                      style={{ background: muteMusic ? "var(--danger)" : "var(--surface-3)", color: "var(--text)", cursor: "pointer" }}
                      onClick={() => setMuteMusic(!muteMusic)}
                    >
                      M
                    </button>
                    <button type="button" className="badge badge-neutral" style={{ cursor: "pointer" }}>S</button>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <VolumeIcon size={14} style={{ color: "var(--text-secondary)" }} />
                  <input type="range" className="slider" style={{ flex: 1 }} defaultValue={50} />
                </div>
              </div>

              {/* SFX Track Head */}
              <div style={{ height: 90, padding: "var(--space-3)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: "var(--text-xs)" }}>SFX</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      type="button"
                      className="badge"
                      style={{ background: muteSfx ? "var(--danger)" : "var(--surface-3)", color: "var(--text)", cursor: "pointer" }}
                      onClick={() => setMuteSfx(!muteSfx)}
                    >
                      M
                    </button>
                    <button type="button" className="badge badge-neutral" style={{ cursor: "pointer" }}>S</button>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <VolumeIcon size={14} style={{ color: "var(--text-secondary)" }} />
                  <input type="range" className="slider" style={{ flex: 1 }} defaultValue={70} />
                </div>
              </div>
            </div>

            {/* Right Scrolling Waveform Column */}
            <div style={{ flex: 1, overflowX: "auto", position: "relative", background: "var(--bg)" }}>
              <div style={{ minWidth: 800, height: "100%", display: "flex", flexDirection: "column" }}>
                {/* Time Ruler */}
                <div style={{ height: 32, borderBottom: "1px solid var(--border)", background: "var(--surface-2)", display: "flex", alignItems: "center", padding: "0 var(--space-3)", fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                  <span>0:00</span>
                  <div style={{ flex: 1 }} />
                  <span>{formatDuration(totalDuration)}</span>
                </div>

                {/* Narration Clips */}
                <div style={{ height: 110, borderBottom: "1px solid var(--border)", position: "relative", padding: "8px 0" }}>
                  {positionedScenes.map((s: any) => {
                    const left = (s.start / totalDuration) * 100;
                    const width = (s.duration / totalDuration) * 100;
                    const isSelected = s.sceneId === selectedSceneId;
                    return (
                      <div
                        key={s.sceneId}
                        style={{
                          position: "absolute",
                          left: `${left}%`,
                          width: `${width}%`,
                          top: 8,
                          bottom: 8,
                          background: isSelected ? "rgba(95, 174, 122, 0.25)" : "rgba(95, 174, 122, 0.12)",
                          border: isSelected ? "2px solid var(--success)" : "1px solid rgba(95, 174, 122, 0.4)",
                          borderRadius: "var(--radius-sm)",
                          padding: "6px",
                          cursor: "pointer",
                          overflow: "hidden"
                        }}
                        onClick={() => setSelectedSceneId(s.sceneId)}
                      >
                        <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--success)", fontWeight: 600 }}>
                          {s.sceneId} ({s.duration?.toFixed(1)}s)
                        </div>
                        <div style={{ fontSize: 9, color: "var(--text-secondary)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.cached ? "TTS Cached" : "Not synthesized"}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Music Bed */}
                <div style={{ height: 100, borderBottom: "1px solid var(--border)", position: "relative", padding: "8px 0" }}>
                  <div style={{ position: "absolute", inset: "8px 12px", background: "rgba(108, 155, 255, 0.08)", border: "1px solid rgba(108, 155, 255, 0.3)", borderRadius: "var(--radius-sm)", padding: 8, color: "var(--info)", fontSize: 11 }}>
                    Documentary Ambient Bed — Subtle strings & sub-bass rhythm (48kHz 24-bit)
                  </div>
                </div>

                {/* SFX Bed */}
                <div style={{ height: 90, position: "relative", padding: "8px 0" }}>
                  {positionedScenes.filter((_: any, idx: number) => idx % 2 === 0).map((s: any) => (
                    <div
                      key={s.sceneId}
                      style={{
                        position: "absolute",
                        left: `${(s.start / totalDuration) * 100}%`,
                        width: 24,
                        top: 14,
                        bottom: 14,
                        background: "rgba(217, 182, 91, 0.2)",
                        border: "1px solid var(--warning)",
                        borderRadius: 2
                      }}
                      title="Scene cut whoosh / riser"
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Audio Inspector */}
        <aside className="panel audio-inspector" style={{ width: 340, background: "var(--panel)", display: "flex", flexDirection: "column" }}>
          <div className="panel-header">
            <span>Audio Clip Inspector</span>
          </div>

          <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)", flex: 1, overflowY: "auto" }}>
            {selectedScene ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: "var(--text-md)", color: "var(--accent)" }}>
                    {selectedScene.sceneId}
                  </span>
                  <span className={`badge ${selectedScene.cached ? "badge-success" : "badge-warning"}`}>
                    {selectedScene.cached ? "TTS Cached" : "Pending"}
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--text-xs)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Duration</span>
                    <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{selectedScene.duration ? `${selectedScene.duration.toFixed(2)}s` : "—"}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Device</span>
                    <span style={{ color: "var(--text)" }}>{selectedScene.device || "CPU / PyTorch"}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Generated Date</span>
                    <span style={{ color: "var(--text)" }}>{selectedScene.generatedAt ? new Date(selectedScene.generatedAt).toLocaleDateString() : "Pending"}</span>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ marginTop: "auto", width: "100%" }}
                  onClick={() => api.regenerateNarration(projectId, selectedScene.sceneId)}
                >
                  Resynthesize Voice
                </button>
              </>
            ) : (
              <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
                Select an audio clip on the timeline to inspect its speech attributes.
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
