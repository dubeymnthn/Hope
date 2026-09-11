import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SceneGenerator, GenerationContext, GeneratedScene } from "./generator.js";
import { StoryboardScene } from "../schemas/storyboard.js";
import { computeSceneHash } from "../utils/hash.js";
import { SceneMetadata } from "../schemas/video.js";

export class HyperFramesSceneGenerator implements SceneGenerator {
  async generate(scene: StoryboardScene, context: GenerationContext): Promise<GeneratedScene> {
    const { design, videoDir } = context;
    const compositionsDir = join(videoDir, "compositions");
    mkdirSync(compositionsDir, { recursive: true });

    const htmlPath = join(compositionsDir, `${scene.id}.html`);
    const metaPath = join(compositionsDir, `${scene.id}.meta.json`);

    const hash = computeSceneHash(scene, design);

    // Check idempotency
    if (existsSync(htmlPath) && existsSync(metaPath)) {
      try {
        const meta: SceneMetadata = JSON.parse(readFileSync(metaPath, "utf-8"));
        if (meta.hash === hash) {
          console.log(`[VISUAL] Scene ${scene.id} matches hash (${hash}). Skipping regeneration.`);
          return {
            sceneId: scene.id,
            htmlPath,
            metaPath,
            hash,
            duration: scene.duration
          };
        }
      } catch {
        // regenerate on meta error
      }
    }

    console.log(`[VISUAL] Generating HyperFrames composition for Scene ${scene.id} [${scene.visual_type}]...`);

    const visualHtml = this.buildVisualContent(scene, design);
    const gsapTimelineScript = this.buildGsapScript(scene, design);

    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${scene.id}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: ${design.colors.background};
      font-family: ${design.typography.fontFamilyBody};
      color: ${design.colors.text};
    }
    .stage {
      width: ${design.canvas.width}px;
      height: ${design.canvas.height}px;
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      background: radial-gradient(circle at 50% 40%, ${design.colors.backgroundElevated} 0%, ${design.colors.background} 100%);
      overflow: hidden;
    }
    .grid-overlay {
      position: absolute;
      inset: 0;
      background-image: linear-gradient(${design.colors.gridLine} 1px, transparent 1px),
                        linear-gradient(90deg, ${design.colors.gridLine} 1px, transparent 1px);
      background-size: 80px 80px;
      pointer-events: none;
    }
    .content-box {
      z-index: 10;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      max-width: 1600px;
      padding: 40px;
    }
    .headline {
      font-size: ${design.typography.scale.h1};
      font-weight: ${design.typography.weights.bold};
      color: ${design.colors.primary};
      text-shadow: 0 0 40px rgba(0, 245, 255, 0.4);
      margin-bottom: 24px;
      text-transform: uppercase;
      letter-spacing: 2px;
    }
    .description {
      font-size: ${design.typography.scale.body};
      color: ${design.colors.textMuted};
      max-width: 1100px;
      line-height: ${design.typography.lineHeight};
      margin-bottom: 40px;
    }
    .card {
      background: ${design.colors.surface};
      border: 1px solid ${design.colors.surfaceBorder};
      border-radius: ${design.visualStyles.cardBorderRadius};
      box-shadow: ${design.visualStyles.cardGlow};
      padding: 40px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    ${this.buildCustomStyles(scene, design)}
  </style>
  <script src="../assets/gsap.min.js"></script>
</head>
<body>
  <div id="stage" class="stage" data-composition-id="${scene.id}" data-start="0" data-duration="${scene.duration}" data-fps="${design.canvas.fps}" data-width="${design.canvas.width}" data-height="${design.canvas.height}">
    <div class="grid-overlay"></div>
    <div class="content-box">
      <div id="headline" class="headline">${scene.on_screen_text}</div>
      <div id="visual-element" class="visual-container">
        ${visualHtml}
      </div>
      <div id="description" class="description">${scene.visual_description}</div>
    </div>
  </div>
  ${gsapTimelineScript}
</body>
</html>`;

    writeFileSync(htmlPath, fullHtml, "utf-8");

    const meta: SceneMetadata = {
      sceneId: scene.id,
      hash,
      visualType: scene.visual_type,
      duration: scene.duration,
      renderedAt: new Date().toISOString()
    };
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");

    return {
      sceneId: scene.id,
      htmlPath,
      metaPath,
      hash,
      duration: scene.duration
    };
  }

  private buildVisualContent(scene: StoryboardScene, design: any): string {
    switch (scene.visual_type) {
      case "statistic":
        return `
          <div class="card stat-card" id="stat-element">
            <div class="stat-number">+280%</div>
            <div class="stat-label">HBM3e Spot Price Surge (2024–2026)</div>
          </div>
        `;
      case "chart":
        return `
          <div class="card chart-card" id="chart-element">
            <svg width="800" height="320" viewBox="0 0 800 320">
              <path class="chart-grid" d="M 50 280 L 750 280 M 50 200 L 750 200 M 50 120 L 750 120 M 50 40 L 750 40" stroke="rgba(255,255,255,0.08)" stroke-dasharray="4" />
              <path id="curve" class="chart-line" d="M 60 270 Q 250 260 400 180 T 740 45" fill="none" stroke="${design.colors.primary}" stroke-width="6" stroke-linecap="round" />
              <circle cx="740" cy="45" r="10" fill="${design.colors.accent}" />
            </svg>
          </div>
        `;
      case "diagram":
        return `
          <div class="card diagram-card" id="diagram-element">
            <svg width="700" height="260" viewBox="0 0 700 260">
              <rect x="50" y="80" width="160" height="100" rx="12" fill="#161924" stroke="${design.colors.secondary}" stroke-width="3" />
              <text x="130" y="135" fill="#fff" font-size="20" font-weight="bold" text-anchor="middle">TSMC CoWoS</text>
              <line x1="210" y1="130" x2="310" y2="130" stroke="${design.colors.primary}" stroke-width="4" stroke-dasharray="6" />
              <rect x="310" y="50" width="220" height="160" rx="12" fill="#161924" stroke="${design.colors.primary}" stroke-width="3" />
              <text x="420" y="115" fill="${design.colors.primary}" font-size="22" font-weight="bold" text-anchor="middle">HBM3e Stack</text>
              <text x="420" y="150" fill="#94a3b8" font-size="16" text-anchor="middle">12-Hi 3D Silicon</text>
            </svg>
          </div>
        `;
      case "comparison":
        return `
          <div class="comparison-grid" id="comparison-element">
            <div class="card compare-box">
              <h3 style="color: #94a3b8; margin-bottom: 12px;">Conventional DDR5</h3>
              <p style="color: #64748b; font-size: 20px;">Standard Packaging</p>
              <div style="font-size: 32px; font-weight: bold; margin-top: 16px; color: #fff;">~$4.50 / GB</div>
            </div>
            <div class="card compare-box active">
              <h3 style="color: ${design.colors.primary}; margin-bottom: 12px;">HBM3e Silicon</h3>
              <p style="color: ${design.colors.accent}; font-size: 20px;">3D Through-Silicon Vias</p>
              <div style="font-size: 32px; font-weight: bold; margin-top: 16px; color: ${design.colors.primary};">~$18.00 / GB</div>
            </div>
          </div>
        `;
      case "timeline":
        return `
          <div class="timeline-row" id="timeline-element">
            <div class="card timeline-node"><span class="badge">2023 Q4</span><p>Hyperscaler AI Rush</p></div>
            <div class="timeline-connector"></div>
            <div class="card timeline-node"><span class="badge">2024 Q3</span><p>Blackwell Allocation Sold Out</p></div>
            <div class="timeline-connector"></div>
            <div class="card timeline-node active"><span class="badge">2026</span><p>HBM4 Wafer Pivot</p></div>
          </div>
        `;
      default:
        return `
          <div class="card text-card" id="text-element">
            <div style="font-size: 36px; font-weight: 700; color: #fff; max-width: 800px;">
              "${scene.narration.slice(0, 100)}..."
            </div>
          </div>
        `;
    }
  }

  private buildCustomStyles(scene: StoryboardScene, design: any): string {
    return `
      .stat-card {
        padding: 50px 80px;
      }
      .stat-number {
        font-size: 110px;
        font-weight: 900;
        color: ${design.colors.accent};
        text-shadow: 0 0 50px rgba(255, 0, 127, 0.4);
        line-height: 1;
        margin-bottom: 16px;
      }
      .stat-label {
        font-size: 26px;
        color: ${design.colors.textMuted};
        letter-spacing: 1px;
      }
      .comparison-grid {
        display: flex;
        gap: 40px;
      }
      .compare-box {
        width: 380px;
        padding: 36px;
      }
      .compare-box.active {
        border-color: ${design.colors.primary};
        box-shadow: 0 0 30px rgba(0, 245, 255, 0.2);
      }
      .timeline-row {
        display: flex;
        align-items: center;
        gap: 16px;
      }
      .timeline-node {
        padding: 24px 32px;
      }
      .timeline-node.active {
        border-color: ${design.colors.primary};
      }
      .badge {
        font-size: 16px;
        background: ${design.colors.primary};
        color: #000;
        padding: 4px 12px;
        border-radius: 6px;
        font-weight: bold;
        margin-bottom: 12px;
        display: inline-block;
      }
      .timeline-connector {
        width: 40px;
        height: 3px;
        background: ${design.colors.surfaceBorder};
      }
    `;
  }

  private buildGsapScript(scene: StoryboardScene, design: any): string {
    return `
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    window.__timelines["${scene.id}"] = tl;

    // Timeline padding to guarantee full scene duration
    tl.to({}, { duration: ${scene.duration} }, 0);

    // Kinetic entrance
    tl.from("#headline", { opacity: 0, y: 30, duration: 0.8, ease: "${design.motion.easeDefault}" }, 0.1);
    tl.from("#visual-element", { opacity: 0, scale: 0.94, duration: 0.9, ease: "${design.motion.easeDefault}" }, 0.3);
    tl.from("#description", { opacity: 0, y: 20, duration: 0.8, ease: "${design.motion.easeDefault}" }, 0.5);

    // Subtle continuous camera drift
    tl.to("#stage", { scale: 1.03, duration: ${scene.duration}, ease: "none" }, 0);
  </script>
    `;
  }
}
