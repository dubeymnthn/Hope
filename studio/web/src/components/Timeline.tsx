import { useRef, useState } from "react";
import { SceneSummary } from "../api/client.js";
import { SceneIcon, EditorIcon, StoryboardIcon, MapIcon, DocumentIcon } from "./Icons.js";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function getModeIcon(mode?: string) {
  switch (mode) {
    case "real-video":
      return <SceneIcon size={12} />;
    case "generated":
      return <EditorIcon size={12} />;
    case "comparison":
      return <StoryboardIcon size={12} />;
    case "map":
      return <MapIcon size={12} />;
    case "document":
      return <DocumentIcon size={12} />;
    default:
      return <SceneIcon size={12} />;
  }
}

export function Timeline({
  scenes,
  totalDuration,
  playheadSeconds = 0,
  selected,
  onSelect,
  onSeek
}: {
  scenes: SceneSummary[];
  totalDuration: number;
  playheadSeconds?: number;
  selected?: string;
  onSelect: (sceneId: string) => void;
  onSeek?: (seconds: number) => void;
}) {
  const [zoom, setZoom] = useState(2);
  const timelineRef = useRef<HTMLDivElement>(null);

  const effectiveDuration = totalDuration > 0 ? totalDuration : scenes.reduce((s, c) => s + (c.duration || 20), 0) || 480;

  let cursor = 0;
  const positioned = scenes.map((s) => {
    const start = cursor;
    const duration = s.duration ?? 25;
    cursor += duration;
    return { ...s, start, duration };
  });

  // Calculate ticks for ruler
  const tickInterval = zoom >= 4 ? 15 : zoom >= 2 ? 30 : 60;
  const ticks: number[] = [];
  for (let t = 0; t <= effectiveDuration; t += tickInterval) {
    ticks.push(t);
  }

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || !onSeek) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, clickX / rect.width));
    onSeek(pct * effectiveDuration);
  };

  const playheadPct = Math.min(100, Math.max(0, (playheadSeconds / effectiveDuration) * 100));

  return (
    <section className="panel timeline-panel" aria-label="Timeline" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div
        className="timeline-toolbar"
        style={{
          height: 36,
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 var(--space-4)",
          background: "var(--surface-2)"
        }}
      >
        <span style={{ fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-secondary)" }}>
          Timeline
        </span>

        <div className="timeline-zoom-controls" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <button
            type="button"
            className="icon-btn"
            style={{ width: 22, height: 22, fontSize: 13, border: "1px solid var(--border)", borderRadius: 3, background: "transparent", color: "var(--text-secondary)", cursor: "pointer" }}
            onClick={() => setZoom(Math.max(1, zoom - 1))}
            title="Zoom out"
          >
            -
          </button>
          <input
            type="range"
            className="slider"
            style={{ width: 80 }}
            min={1}
            max={8}
            step={1}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Timeline zoom"
          />
          <button
            type="button"
            className="icon-btn"
            style={{ width: 22, height: 22, fontSize: 13, border: "1px solid var(--border)", borderRadius: 3, background: "transparent", color: "var(--text-secondary)", cursor: "pointer" }}
            onClick={() => setZoom(Math.min(8, zoom + 1))}
            title="Zoom in"
          >
            +
          </button>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)", width: 20 }}>
            {zoom}x
          </span>
        </div>
      </div>

      <div
        className="timeline-scroll"
        style={{
          flex: 1,
          overflowX: "auto",
          overflowY: "hidden",
          background: "var(--bg)",
          position: "relative"
        }}
      >
        <div
          ref={timelineRef}
          style={{
            minWidth: `${100 * zoom}%`,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            position: "relative",
            cursor: "crosshair"
          }}
          onClick={handleTimelineClick}
        >
          {/* Ruler Row */}
          <div
            style={{
              height: 24,
              borderBottom: "1px solid var(--border)",
              background: "var(--surface-2)",
              position: "relative",
              display: "flex"
            }}
          >
            <div style={{ width: 80, flexShrink: 0, borderRight: "1px solid var(--border)" }} />
            <div style={{ flex: 1, position: "relative" }}>
              {ticks.map((t) => {
                const pos = (t / effectiveDuration) * 100;
                return (
                  <div
                    key={t}
                    style={{
                      position: "absolute",
                      left: `${pos}%`,
                      top: 0,
                      bottom: 0,
                      borderLeft: "1px solid var(--border)",
                      paddingLeft: 4,
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      color: "var(--text-tertiary)",
                      lineHeight: "24px"
                    }}
                  >
                    {formatTime(t)}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Video Track */}
          <TrackRow label="Video">
            {positioned.map((s) => {
              const left = (s.start / effectiveDuration) * 100;
              const width = (s.duration / effectiveDuration) * 100;
              const isSelected = s.sceneId === selected;
              return (
                <div
                  key={s.sceneId}
                  className={`timeline-block video${s.stale ? " stale" : ""}`}
                  style={{
                    position: "absolute",
                    left: `${left}%`,
                    width: `${width}%`,
                    top: 2,
                    bottom: 2,
                    background: isSelected ? "var(--accent-muted)" : "var(--surface-3)",
                    border: isSelected ? "1px solid var(--accent)" : "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "0 6px",
                    overflow: "hidden",
                    cursor: "pointer",
                    color: isSelected ? "var(--text)" : "var(--text-secondary)",
                    fontSize: 10,
                    fontFamily: "var(--font-mono)"
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(s.sceneId);
                    if (onSeek) onSeek(s.start);
                  }}
                  title={`${s.sceneId} (${s.duration.toFixed(1)}s)`}
                >
                  {getModeIcon(s.visualMode)}
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {s.sceneId}
                  </span>
                </div>
              );
            })}
          </TrackRow>

          {/* Narration Track */}
          <TrackRow label="Narration">
            {positioned.map((s) => {
              const left = (s.start / effectiveDuration) * 100;
              const width = (s.duration / effectiveDuration) * 100;
              return (
                <div
                  key={s.sceneId}
                  className="timeline-block narration"
                  style={{
                    position: "absolute",
                    left: `${left}%`,
                    width: `${width}%`,
                    top: 2,
                    bottom: 2,
                    background: "rgba(95, 174, 122, 0.12)",
                    border: "1px solid rgba(95, 174, 122, 0.35)",
                    borderRadius: "var(--radius-sm)",
                    display: "flex",
                    alignItems: "center",
                    padding: "0 6px",
                    overflow: "hidden",
                    color: "var(--success)",
                    fontSize: 10
                  }}
                  title={s.narrationExcerpt}
                >
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {s.narrationExcerpt || `${s.sceneId} narration`}
                  </span>
                </div>
              );
            })}
          </TrackRow>

          {/* Music Track */}
          <TrackRow label="Music">
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 2,
                bottom: 2,
                background: "rgba(108, 155, 255, 0.08)",
                border: "1px solid rgba(108, 155, 255, 0.25)",
                borderRadius: "var(--radius-sm)",
                display: "flex",
                alignItems: "center",
                padding: "0 8px",
                color: "var(--info)",
                fontSize: 10
              }}
            >
              Documentary Score (Cinematic Ambient Minimal)
            </div>
          </TrackRow>

          {/* SFX Track */}
          <TrackRow label="SFX">
            {positioned.filter((_, idx) => idx % 3 === 0).map((s) => {
              const left = (s.start / effectiveDuration) * 100;
              return (
                <div
                  key={s.sceneId}
                  style={{
                    position: "absolute",
                    left: `${left}%`,
                    width: 32,
                    top: 4,
                    bottom: 4,
                    background: "rgba(217, 182, 91, 0.15)",
                    border: "1px solid rgba(217, 182, 91, 0.4)",
                    borderRadius: 2,
                    fontSize: 9,
                    color: "var(--warning)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                  title="Transition riser / hit"
                >
                  hit
                </div>
              );
            })}
          </TrackRow>

          {/* Captions Track */}
          <TrackRow label="Captions">
            {positioned.map((s) => {
              const left = (s.start / effectiveDuration) * 100;
              const width = (s.duration / effectiveDuration) * 100;
              return (
                <div
                  key={s.sceneId}
                  style={{
                    position: "absolute",
                    left: `${left}%`,
                    width: `${width}%`,
                    top: 3,
                    bottom: 3,
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                    borderRadius: 2
                  }}
                  title="Synced subtitles"
                />
              );
            })}
          </TrackRow>

          {/* Playhead Overlay */}
          <div
            className="tl-playhead"
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${playheadPct}%`,
              width: 1,
              background: "var(--accent)",
              zIndex: 10,
              pointerEvents: "none"
            }}
          >
            <div
              className="tl-playhead-handle"
              style={{
                width: 9,
                height: 12,
                background: "var(--accent)",
                position: "absolute",
                top: 0,
                left: -4,
                clipPath: "polygon(0% 0%, 100% 0%, 100% 60%, 50% 100%, 0% 60%)"
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function TrackRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        height: 28,
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center"
      }}
    >
      <div
        style={{
          width: 80,
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          paddingLeft: "var(--space-3)",
          fontFamily: "var(--font-ui)",
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
          background: "var(--panel)",
          height: "100%",
          display: "flex",
          alignItems: "center"
        }}
      >
        {label}
      </div>
      <div style={{ flex: 1, height: "100%", position: "relative" }}>
        {children}
      </div>
    </div>
  );
}
