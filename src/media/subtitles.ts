import { SentenceTimestamp } from "../schemas/video.js";

function formatSrtTimestamp(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);

  const pad = (n: number, z = 2) => String(n).padStart(z, "0");
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)},${pad(millis, 3)}`;
}

export class SubtitleGenerator {
  static toSRT(sentences: SentenceTimestamp[]): string {
    return sentences
      .map((s, index) => {
        const start = formatSrtTimestamp(s.start);
        const end = formatSrtTimestamp(s.end);
        return `${index + 1}\n${start} --> ${end}\n${s.text.trim()}\n`;
      })
      .join("\n");
  }

  static toVTT(sentences: SentenceTimestamp[]): string {
    const header = "WEBVTT\n\n";
    const cues = sentences
      .map((s, index) => {
        const start = formatSrtTimestamp(s.start).replace(",", ".");
        const end = formatSrtTimestamp(s.end).replace(",", ".");
        return `${index + 1}\n${start} --> ${end}\n${s.text.trim()}\n`;
      })
      .join("\n");
    return header + cues;
  }
}
