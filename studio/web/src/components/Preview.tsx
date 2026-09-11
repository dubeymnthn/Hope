import { useEffect, useRef, useState } from "react";
import { mediaUrl, SceneSummary } from "../api/client.js";
import {
  PlayIcon,
  PauseIcon,
  SkipBackIcon,
  SkipForwardIcon,
  VolumeIcon,
  FullscreenIcon,
  SceneIcon,
  EditorIcon,
  StoryboardIcon,
  MapIcon,
  DocumentIcon
} from "./Icons.js";

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

function getModeGlyph(mode?: string) {
  switch (mode) {
    case "real-video":
      return <SceneIcon size={48} />;
    case "generated":
      return <EditorIcon size={48} />;
    case "comparison":
      return <StoryboardIcon size={48} />;
    case "map":
      return <MapIcon size={48} />;
    case "document":
      return <DocumentIcon size={48} />;
    default:
      return <SceneIcon size={48} />;
  }
}

export function Preview({
  projectId,
  currentScene,
  hasFinal,
  seekToSeconds,
  onPreviousScene,
  onNextScene
}: {
  projectId: string;
  currentScene?: SceneSummary;
  hasFinal: boolean;
  seekToSeconds?: number;
  onPreviousScene?: () => void;
  onNextScene?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(80);

  useEffect(() => {
    if (seekToSeconds !== undefined && videoRef.current) {
      videoRef.current.currentTime = seekToSeconds;
    }
  }, [seekToSeconds]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !["input", "textarea"].includes((e.target as HTMLElement)?.tagName?.toLowerCase())) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [playing]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (playing) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
  };

  const handleVolumeChange = (v: number) => {
    setVolume(v);
    if (videoRef.current) {
      videoRef.current.volume = v / 100;
    }
  };

  const toggleFullscreen = () => {
    if (!stageRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      stageRef.current.requestFullscreen();
    }
  };

  const mode = currentScene?.visualMode ?? "real-video";
  const displayTitle = currentScene?.narrationExcerpt || currentScene?.sceneId || "Scene Preview";

  return (
    <section className="panel video-preview-panel" ref={stageRef} aria-label="Video Preview" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div
        className="video-preview-stage"
        style={{
          flex: 1,
          position: "relative",
          background: "#08090A",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden"
        }}
      >
        {hasFinal ? (
          <video
            ref={videoRef}
            src={mediaUrl(projectId, "final")}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
            onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        ) : (
          <>
            <div
              className="video-preview-wash"
              style={{
                position: "absolute",
                inset: 0,
                background: "radial-gradient(ellipse at center, rgba(198, 138, 78, 0.08) 0%, rgba(14, 15, 17, 0.95) 75%)",
                pointerEvents: "none"
              }}
            />
            <span
              className="badge badge-neutral"
              style={{
                position: "absolute",
                top: "var(--space-3)",
                left: "var(--space-3)",
                textTransform: "uppercase",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-2xs)"
              }}
            >
              {mode}
            </span>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "var(--space-3)",
                maxWidth: 420,
                textAlign: "center",
                padding: "var(--space-4)",
                zIndex: 2
              }}
            >
              <div style={{ color: "var(--accent)" }}>{getModeGlyph(mode)}</div>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "var(--text-lg)",
                  color: "var(--text)",
                  lineHeight: 1.4
                }}
              >
                {displayTitle}
              </div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                {hasFinal ? "Rendered Cut" : "Unrendered Stage Preview"}
              </div>
            </div>
          </>
        )}
      </div>

      <div
        className="transport-bar"
        style={{
          height: 40,
          background: "var(--surface-2)",
          borderTop: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "0 var(--space-3)"
        }}
      >
        <button
          type="button"
          className="icon-btn"
          aria-label="Previous scene"
          title="Previous scene"
          onClick={onPreviousScene}
        >
          <SkipBackIcon size={16} />
        </button>

        <button
          type="button"
          className="icon-btn"
          aria-label={playing ? "Pause" : "Play"}
          title="Play / Pause (Space)"
          onClick={togglePlay}
          style={{ color: "var(--accent)" }}
        >
          {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
        </button>

        <button
          type="button"
          className="icon-btn"
          aria-label="Next scene"
          title="Next scene"
          onClick={onNextScene}
        >
          <SkipForwardIcon size={16} />
        </button>

        <span
          className="transport-timecode"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-xs)",
            color: "var(--text)",
            margin: "0 var(--space-2)"
          }}
        >
          {fmt(current)} / {fmt(duration || (currentScene?.duration ?? 0))}
        </span>

        <div style={{ flex: 1 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <VolumeIcon size={16} style={{ color: "var(--text-secondary)" }} />
          <input
            type="range"
            className="slider"
            style={{ width: 70 }}
            min={0}
            max={100}
            value={volume}
            onChange={(e) => handleVolumeChange(Number(e.target.value))}
            aria-label="Volume"
          />
        </div>

        <button
          type="button"
          className="icon-btn"
          aria-label="Toggle fullscreen"
          title="Fullscreen"
          onClick={toggleFullscreen}
          style={{ marginLeft: 6 }}
        >
          <FullscreenIcon size={16} />
        </button>
      </div>
    </section>
  );
}
