import { Router } from "express";
import { existsSync, statSync, createReadStream } from "node:fs";
import { join, extname } from "node:path";
import { projectGuard, ProjectRequest } from "../middleware/project-guard.js";

export const mediaRouter = Router({ mergeParams: true });

const CONTENT_TYPES: Record<string, string> = { ".mp4": "video/mp4", ".wav": "audio/wav", ".srt": "text/plain" };

/**
 * Streams only a small, explicit allowlist of known project media files — never an
 * arbitrary path from the request (spec V2.4 §42). `kind` selects which real artifact;
 * `sceneId` (for scene-preview kind) is validated against the same project-id pattern
 * used everywhere else, not interpolated into a path unchecked.
 */
const SCENE_ID_PATTERN = /^[a-z0-9-]+$/;

mediaRouter.get("/:kind", projectGuard, (req, res) => {
  const { projectDir } = req as ProjectRequest;
  const kind = String(req.params.kind);
  let filePath: string | null = null;

  if (kind === "final") {
    filePath = join(projectDir, "final.mp4");
  } else if (kind === "narration") {
    filePath = join(projectDir, "audio", "narration.wav");
  } else if (kind === "captions") {
    filePath = join(projectDir, "audio", "captions.srt");
  } else if (kind.startsWith("scene-preview-")) {
    const sceneId = kind.slice("scene-preview-".length);
    if (!SCENE_ID_PATTERN.test(sceneId)) {
      res.status(400).json({ error: "Invalid scene id." });
      return;
    }
    filePath = join(projectDir, "renders", `preview-${sceneId}.mp4`);
  }

  if (!filePath || !existsSync(filePath)) {
    res.status(404).json({ error: "Media not produced yet." });
    return;
  }

  const stat = statSync(filePath);
  const contentType = CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream";
  const range = req.headers.range;

  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    const start = match ? parseInt(match[1], 10) : 0;
    const end = match && match[2] ? parseInt(match[2], 10) : stat.size - 1;
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Content-Type": contentType
    });
    createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { "Content-Length": stat.size, "Content-Type": contentType, "Accept-Ranges": "bytes" });
    createReadStream(filePath).pipe(res);
  }
});
