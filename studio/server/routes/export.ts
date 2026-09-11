import { Router } from "express";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { FFmpegService } from "../../../src/media/ffmpeg.js";
import { QAAgent } from "../../../src/agents/qa.js";
import { readProjectArtifacts } from "../services/artifact-reader.js";
import { projectGuard, ProjectRequest } from "../middleware/project-guard.js";
import { sendError } from "../services/http-errors.js";

export const exportRouter = Router({ mergeParams: true });

/**
 * Real export only: mux (if not already muxed) + real ffprobe + real QAAgent.evaluate().
 * Only responds 200/"complete" once every one of those has genuinely succeeded (spec
 * V2.4 §37) — a missing raw render is reported as a clear precondition failure, not
 * silently produced.
 */
exportRouter.post("/", projectGuard, async (req, res) => {
  try {
    const { projectDir } = req as ProjectRequest;
    const artifacts = readProjectArtifacts(projectDir);
    const rawVideoPath = join(projectDir, "renders/final-hyperframes.mp4");
    const finalVideoPath = join(projectDir, "final.mp4");
    const srtPath = join(projectDir, "audio/captions.srt");

    if (!artifacts.audio) {
      res.status(412).json({ error: "No narration audio yet — run a full render before exporting." });
      return;
    }
    if (!existsSync(rawVideoPath) && !existsSync(finalVideoPath)) {
      res.status(412).json({ error: "No rendered video yet — trigger a full render before exporting." });
      return;
    }

    if (!existsSync(finalVideoPath)) {
      await FFmpegService.muxAudioAndVideo(rawVideoPath, artifacts.audio.audioPath, finalVideoPath, {
        srtPath: existsSync(srtPath) ? srtPath : undefined
      });
    }

    if (!artifacts.storyboard || !artifacts.script) {
      res.status(412).json({ error: "Storyboard/script missing — cannot run export QA." });
      return;
    }

    const qa = await new QAAgent().evaluate({
      videoPath: finalVideoPath,
      audioPath: artifacts.audio.audioPath,
      srtPath,
      storyboard: artifacts.storyboard,
      script: artifacts.script,
      outputDir: projectDir
    });

    if (qa.status !== "PASS" || !existsSync(finalVideoPath)) {
      res.status(422).json({ error: "Export QA did not pass.", qa });
      return;
    }

    const probe = await FFmpegService.probe(finalVideoPath);
    if (!(probe.duration > 0)) {
      res.status(422).json({ error: "Exported file has no valid duration.", probe });
      return;
    }

    res.json({
      status: "EXPORT_COMPLETE",
      filename: finalVideoPath,
      durationSeconds: probe.duration,
      resolution: `${probe.width}x${probe.height}`,
      fps: probe.fps,
      sizeBytes: statSync(finalVideoPath).size,
      qa
    });
  } catch (err) {
    sendError(res, err);
  }
});
