import React from "react";

export interface IconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

function SvgBase({ size = 20, className, style, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ display: "block", flexShrink: 0, ...style }}
    >
      {children}
    </svg>
  );
}

// Nav & Section Icons
export function ProjectsIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1.3" />
      <rect x="14" y="3" width="7" height="7" rx="1.3" />
      <rect x="3" y="14" width="7" height="7" rx="1.3" />
      <rect x="14" y="14" width="7" height="7" rx="1.3" />
    </SvgBase>
  );
}

export function EditorIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8 4 V20 M16 4 V20 M3 9 H8 M16 9 H21 M3 15 H8 M16 15 H21" />
    </SvgBase>
  );
}

export function ResearchIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <path d="M12 6.5 C10.5 5 8 4.5 4 4.5 V18 C8 18 10.5 18.5 12 20 C13.5 18.5 16 18 20 18 V4.5 C16 4.5 13.5 5 12 6.5 Z" />
      <path d="M12 6.5 V20" />
    </SvgBase>
  );
}

export function ScriptIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <path d="M7 3 H14 L18 7 V20 A1 1 0 0 1 17 21 H7 A1 1 0 0 1 6 20 V4 A1 1 0 0 1 7 3 Z" />
      <path d="M14 3 V7 H18" />
      <path d="M9 12 H15 M9 15 H15 M9 9 H11" />
    </SvgBase>
  );
}

export function StoryboardIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <rect x="3" y="4" width="5" height="16" rx="1" />
      <rect x="9.5" y="4" width="5" height="16" rx="1" />
      <rect x="16" y="4" width="5" height="16" rx="1" />
    </SvgBase>
  );
}

export function AudioIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <path d="M3 12 H5 L7 6 L9.5 18 L12 4 L14.5 20 L17 9 L19 15 H21" />
    </SvgBase>
  );
}

export function SourcesIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <path d="M9.5 14.5 L14.5 9.5" />
      <path d="M11 6.3 L13.2 4.1 A3.4 3.4 0 1 1 18 8.9 L15.8 11.1" />
      <path d="M13 17.7 L10.8 19.9 A3.4 3.4 0 1 1 6 15.1 L8.2 12.9" />
    </SvgBase>
  );
}

export function QAIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <path d="M12 3 L19 6 V11 C19 16 16 19.5 12 21 C8 19.5 5 16 5 11 V6 Z" />
      <path d="M9 12 L11 14 L15 9.5" />
    </SvgBase>
  );
}

export function ExportIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <path d="M12 4 V15" />
      <path d="M7.5 10.5 L12 15 L16.5 10.5" />
      <path d="M5 19 H19" />
    </SvgBase>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20 L15.3 15.3" />
    </SvgBase>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3 V5.6 M12 18.4 V21 M4.2 7 L6.4 8.3 M17.6 15.7 L19.8 17 M3 12 H5.6 M18.4 12 H21 M4.2 17 L6.4 15.7 M17.6 8.3 L19.8 7" />
    </SvgBase>
  );
}

export function CollapseIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <path d="M14 6 L8 12 L14 18" />
      <path d="M18.5 6 L12.5 12 L18.5 18" />
    </SvgBase>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <path d="M6 9 L12 15 L18 9" />
    </SvgBase>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <path d="M6 6 L18 18" />
      <path d="M18 6 L6 18" />
    </SvgBase>
  );
}

// Status Icons
export function CheckIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <path d="M4 12.5 L9.5 18 L20 6" />
    </SvgBase>
  );
}

export function WarningIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <path d="M12 3.5 L21.5 20 H2.5 Z" />
      <path d="M12 9.5 V14.5" />
      <circle cx="12" cy="17.3" r="0.9" fill="currentColor" stroke="none" />
    </SvgBase>
  );
}

export function DangerIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5 V13" />
      <circle cx="12" cy="16.5" r="0.9" fill="currentColor" stroke="none" />
    </SvgBase>
  );
}

// Scene / Chapter Icons
export function ChapterIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <path d="M6 21 V4" />
      <path d="M6 4 H16 L14 7.5 L16 11 H6" />
    </SvgBase>
  );
}

export function SceneIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M9.5 9 L15 12 L9.5 15 Z" fill="currentColor" stroke="none" />
    </SvgBase>
  );
}

// Transport & Playback
export function PlayIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <path d="M7 4.5 L19 12 L7 19.5 Z" fill="currentColor" stroke="none" />
    </SvgBase>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
    </SvgBase>
  );
}

export function SkipBackIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <path d="M6 5 V19" />
      <path d="M18 6 L8 12 L18 18 Z" fill="currentColor" stroke="none" />
    </SvgBase>
  );
}

export function SkipForwardIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <path d="M18 5 V19" />
      <path d="M6 6 L16 12 L6 18 Z" fill="currentColor" stroke="none" />
    </SvgBase>
  );
}

export function VolumeIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <path d="M4 9 H8 L13 5 V19 L8 15 H4 Z" />
      <path d="M17 9 a5 5 0 0 1 0 6" />
      <path d="M19.5 6.5 a9 9 0 0 1 0 11" />
    </SvgBase>
  );
}

export function CaptionsIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 10 H10 M7 13 H9 M14 10 H17 M14 13 H16" />
    </SvgBase>
  );
}

export function MapIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <path d="M9 4 L4 6 V20 L9 18 L15 20 L20 18 V4 L15 6 L9 4 Z" />
      <path d="M9 4 V18 M15 6 V20" />
    </SvgBase>
  );
}

export function DocumentIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <path d="M7 3 H14 L18 7 V20 A1 1 0 0 1 17 21 H7 A1 1 0 0 1 6 20 V4 A1 1 0 0 1 7 3 Z" />
      <path d="M14 3 V7 H18" />
      <path d="M9 12 H15 M9 15 H15" />
    </SvgBase>
  );
}

export function FullscreenIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <path d="M4 9 V5 A1 1 0 0 1 5 4 H9" />
      <path d="M15 4 H19 A1 1 0 0 1 20 5 V9" />
      <path d="M20 15 V19 A1 1 0 0 1 19 20 H15" />
      <path d="M9 20 H5 A1 1 0 0 1 4 19 V15" />
    </SvgBase>
  );
}
