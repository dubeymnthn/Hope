import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { StoryboardScene, VisualMode } from "../schemas/storyboard.js";
import { ChannelDesign } from "../schemas/design.js";
import { computeSceneFingerprint } from "./scene-hash.js";

export interface GenerationResult {
  sceneId: string;
  htmlPath: string;
  metaPath: string;
  fingerprint: string;
  reused: boolean;
}

export class SceneCompositionGenerator {
  async generateScene(
    scene: StoryboardScene,
    options: {
      design: ChannelDesign;
      designVersion: string;
      outputDir: string;
      videoId?: string;
    }
  ): Promise<GenerationResult> {
    const { design, designVersion, outputDir, videoId = "video-factory" } = options;
    const compositionsDir = join(outputDir, "compositions");
    const scenesMetaDir = join(outputDir, "scenes");
    mkdirSync(compositionsDir, { recursive: true });
    mkdirSync(scenesMetaDir, { recursive: true });

    // Copy GSAP bundle if not present in assets
    const assetsDir = join(outputDir, "assets");
    mkdirSync(assetsDir, { recursive: true });
    const localGsap = join(assetsDir, "gsap.min.js");
    if (!existsSync(localGsap)) {
      const nodeGsap = resolve(outputDir, "node_modules/gsap/dist/gsap.min.js");
      if (existsSync(nodeGsap)) {
        copyFileSync(nodeGsap, localGsap);
      }
    }

    const fingerprint = computeSceneFingerprint({
      videoId,
      scene,
      designVersion
    });

    const htmlPath = join(compositionsDir, `${scene.id}.html`);
    const metaPath = join(scenesMetaDir, `${scene.id}.meta.json`);

    // Idempotency check: Reuse existing scene if fingerprint matches exactly
    if (existsSync(htmlPath) && existsSync(metaPath)) {
      try {
        const existingMeta = JSON.parse(readFileSync(metaPath, "utf-8"));
        if (existingMeta.fingerprint === fingerprint) {
          return {
            sceneId: scene.id,
            htmlPath,
            metaPath,
            fingerprint,
            reused: true
          };
        }
      } catch {
        // regenerate on meta error
      }
    }

    console.log(`[SCENE-GEN] Authoring bespoke composition for ${scene.id} [${scene.visual_mode || scene.visual_type}]...`);

    const mode = (scene.visual_mode || scene.visual_type) as VisualMode;
    const visualContentHtml = this.buildVisualContent(scene, mode, design);
    const customStyles = this.buildCustomStyles(scene, mode, design);
    const gsapScript = this.buildGsapScript(scene, mode, design);
    const footerHtml = this.buildFooter(scene, design);

    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${scene.id} - ${scene.on_screen_text}</title>
  <style>
    @font-face {
      font-family: 'Inter';
      src: local('Inter'), local('Inter-Regular'), local('sans-serif');
      font-weight: 100 900;
      font-display: swap;
    }
    @font-face {
      font-family: 'JetBrains Mono';
      src: local('JetBrains Mono'), local('JetBrainsMono-Regular'), local('monospace');
      font-weight: 100 800;
      font-display: swap;
    }
    @font-face {
      font-family: 'Fira Code';
      src: local('Fira Code'), local('FiraCode-Regular'), local('monospace');
      font-weight: 300 700;
      font-display: swap;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background-color: ${design.colors.background};
      color: ${design.colors.text};
      font-family: ${design.typography.fontFamilyBody}, -apple-system, BlinkMacSystemFont, sans-serif;
      -webkit-font-smoothing: antialiased;
    }

    #root {
      width: ${design.canvas.width}px;
      height: ${design.canvas.height}px;
      position: relative;
      background: radial-gradient(circle at 50% 20%, ${design.colors.backgroundElevated} 0%, ${design.colors.background} 85%);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: ${design.canvas.safeZone.top}px ${design.canvas.safeZone.right}px ${design.canvas.safeZone.bottom}px ${design.canvas.safeZone.left}px;
    }

    .ambient-glow-left {
      position: absolute;
      top: -20%;
      left: -10%;
      width: 800px;
      height: 800px;
      background: radial-gradient(circle, rgba(0, 245, 255, 0.08) 0%, transparent 70%);
      pointer-events: none;
      filter: blur(80px);
    }

    .ambient-glow-right {
      position: absolute;
      bottom: -20%;
      right: -10%;
      width: 900px;
      height: 900px;
      background: radial-gradient(circle, rgba(138, 43, 226, 0.09) 0%, transparent 70%);
      pointer-events: none;
      filter: blur(90px);
    }

    .cad-grid {
      position: absolute;
      inset: 0;
      background-image: 
        linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
      background-size: 80px 80px;
      background-position: center center;
      pointer-events: none;
      z-index: 1;
    }

    .doc-header {
      z-index: 10;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid ${design.colors.surfaceBorder};
      padding-bottom: 16px;
    }

    .doc-meta-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .series-title {
      font-family: ${design.typography.fontFamilyCode}, monospace;
      font-size: 14px;
      color: #94a3b8;
      letter-spacing: 2.5px;
      text-transform: uppercase;
    }

    .category-tag {
      background: rgba(0, 245, 255, 0.12);
      border: 1px solid rgba(0, 245, 255, 0.35);
      color: ${design.colors.primary};
      font-family: ${design.typography.fontFamilyCode}, monospace;
      font-size: 12px;
      padding: 4px 10px;
      border-radius: 4px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      font-weight: 700;
    }

    .telemetry-indicator {
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: ${design.typography.fontFamilyCode}, monospace;
      font-size: 12px;
      color: #00ff88;
      letter-spacing: 1.5px;
    }

    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #00ff88;
      box-shadow: 0 0 12px #00ff88;
    }

    .headline-block {
      z-index: 10;
      margin-top: 18px;
      margin-bottom: 20px;
    }

    .headline-block h1 {
      font-size: ${design.typography.scale.h1};
      font-weight: 800;
      letter-spacing: -0.5px;
      line-height: 1.1;
      text-transform: uppercase;
      color: #ffffff;
      margin-bottom: 8px;
    }

    .headline-block h1 .accent-hit {
      color: ${design.colors.primary};
      text-shadow: 0 0 35px rgba(0, 245, 255, 0.3);
    }

    .headline-sub {
      font-size: 20px;
      color: ${design.colors.textMuted};
      font-weight: 400;
      max-width: 1400px;
      line-height: 1.4;
    }

    .visual-viewport {
      z-index: 10;
      flex: 1;
      display: flex;
      justify-content: center;
      align-items: center;
      position: relative;
      margin: 10px 0;
    }

    .doc-footer {
      z-index: 10;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 1px solid ${design.colors.surfaceBorder};
      padding-top: 14px;
      font-family: ${design.typography.fontFamilyCode}, monospace;
      font-size: 12px;
      color: #94a3b8;
      letter-spacing: 1px;
    }

    .doc-footer-source {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .source-label {
      color: #94a3b8;
      font-weight: 700;
    }

    .source-data {
      color: ${design.colors.primary};
      background: rgba(0, 245, 255, 0.08);
      padding: 3px 8px;
      border-radius: 4px;
      border: 1px solid rgba(0, 245, 255, 0.2);
    }

    .glass-card {
      background: rgba(22, 25, 36, 0.75);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: ${design.visualStyles.cardBorderRadius};
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
    }

    ${customStyles}
  </style>
  <script src="assets/gsap.min.js"></script>
</head>
<body>
  <div id="root" data-composition-id="${scene.id}" data-start="0" data-duration="${scene.duration}" data-fps="${design.canvas.fps}" data-width="${design.canvas.width}" data-height="${design.canvas.height}">
    <div class="ambient-glow-left" data-layout-allow-overflow></div>
    <div class="ambient-glow-right" data-layout-allow-overflow></div>
    <div class="cad-grid"></div>

    <header class="doc-header">
      <div class="doc-meta-left">
        <span class="series-title">SPECIAL INVESTIGATION // SILICON ECONOMICS</span>
        <span class="category-tag">${(scene.visual_mode || scene.visual_type).toUpperCase()}</span>
      </div>
      <div class="telemetry-indicator">
        <div class="pulse-dot"></div>
        <span>LIVE TELEMETRY // ACT-${scene.chapter || "I"} // ${(scene.duration).toFixed(1)}S</span>
      </div>
    </header>

    <div class="headline-block">
      <h1 id="scene-headline"><span class="accent-hit">${scene.on_screen_text}</span></h1>
      <div id="scene-subhead" class="headline-sub">${scene.visual_description}</div>
    </div>

    <main class="visual-viewport" id="viewport">
      ${visualContentHtml}
    </main>

    ${footerHtml}
  </div>

  ${gsapScript}
</body>
</html>`;

    writeFileSync(htmlPath, fullHtml, "utf-8");

    const meta = {
      sceneId: scene.id,
      fingerprint,
      visualMode: mode,
      duration: scene.duration,
      renderedAt: new Date().toISOString()
    };
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");

    return {
      sceneId: scene.id,
      htmlPath,
      metaPath,
      fingerprint,
      reused: false
    };
  }

  private buildVisualContent(scene: StoryboardScene, mode: VisualMode, design: ChannelDesign): string {
    switch (mode) {
      case "data_visualization":
      case "chart":
        return this.renderDataVisualizationPrimitive(scene, design);
      case "comparison":
        return this.renderComparisonPrimitive(scene, design);
      case "timeline":
      case "historical_sequence":
        return this.renderTimelinePrimitive(scene, design);
      case "technical_diagram":
      case "architecture_diagram":
        return this.renderTechnicalDiagramPrimitive(scene, design);
      case "supply_chain_flow":
      case "process_animation":
        return this.renderSupplyChainPrimitive(scene, design);
      case "large_typography":
      case "kinetic_emphasis":
      case "abstract_metaphor":
      default:
        return this.renderLargeTypographyPrimitive(scene, design);
    }
  }

  // PRIMITIVE 1: Data Visualization (Metric Counter + High-Precision SVG Curve)
  private renderDataVisualizationPrimitive(scene: StoryboardScene, design: ChannelDesign): string {
    const mainData = scene.data_points?.[0];
    const metricVal = mainData?.value || "+280%";
    const metricLabel = mainData?.metric || "Spot Contract Price Surge";

    return `
      <div class="data-vis-grid">
        <div class="glass-card metric-hero-panel">
          <div class="card-eyebrow">EMPIRICAL METRIC ESCALATION</div>
          <div class="huge-counter" id="main-counter">${metricVal}</div>
          <div class="metric-caption">${metricLabel}</div>
          <div class="metric-subdetail">${mainData?.period || "Global Hardware Spot Market Escalation"}</div>
        </div>

        <div class="glass-card chart-hero-panel">
          <div class="chart-header">
            <span class="chart-title">PRICE DISLOCATION TRAJECTORY (INDEX 100 = BASELINE)</span>
            <span class="chart-status">SYSTEM ANOMALY DETECTED</span>
          </div>
          <svg class="data-svg" viewBox="0 0 900 400">
            <defs>
              <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#00f5ff" stop-opacity="0.45"/>
                <stop offset="100%" stop-color="#00f5ff" stop-opacity="0.0"/>
              </linearGradient>
            </defs>
            <line x1="60" y1="340" x2="860" y2="340" stroke="rgba(255,255,255,0.1)" stroke-width="1.5"/>
            <line x1="60" y1="260" x2="860" y2="260" stroke="rgba(255,255,255,0.06)" stroke-width="1" stroke-dasharray="4"/>
            <line x1="60" y1="180" x2="860" y2="180" stroke="rgba(255,255,255,0.06)" stroke-width="1" stroke-dasharray="4"/>
            <line x1="60" y1="100" x2="860" y2="100" stroke="rgba(255,255,255,0.06)" stroke-width="1" stroke-dasharray="4"/>

            <path id="curveArea" d="M 80 340 Q 300 330 500 240 T 840 70 L 840 340 Z" fill="url(#chartGradient)"/>
            <path id="curvePath" d="M 80 340 Q 300 330 500 240 T 840 70" fill="none" stroke="#00f5ff" stroke-width="5" stroke-linecap="round"/>

            <circle id="node-1" cx="80" cy="340" r="7" fill="#161924" stroke="#00f5ff" stroke-width="3"/>
            <circle id="node-2" cx="500" cy="240" r="7" fill="#161924" stroke="#00f5ff" stroke-width="3"/>
            <circle id="node-3" cx="840" cy="70" r="9" fill="#ff007f" stroke="#ffffff" stroke-width="3"/>
          </svg>
        </div>
      </div>
    `;
  }

  // PRIMITIVE 2: Architectural Comparison (Wafer / Architecture Split)
  private renderComparisonPrimitive(scene: StoryboardScene, design: ChannelDesign): string {
    return `
      <div class="comparison-container">
        <div class="glass-card comp-panel left-panel">
          <div class="panel-header">
            <span class="panel-tag">CONVENTIONAL ARCHITECTURE</span>
            <h2>STANDARD DDR5 DRAM</h2>
          </div>
          <div class="wafer-display">
            <svg class="wafer-svg" viewBox="0 0 340 340">
              <circle cx="170" cy="170" r="160" fill="#0d1117" stroke="rgba(255,255,255,0.2)" stroke-width="3"/>
              ${this.generateWaferGrid(170, 170, 155, 14)}
            </svg>
          </div>
          <div class="wafer-stats">
            <div class="stat-box"><span class="k">DIE YIELD</span><span class="v">~1,200 DIES</span></div>
            <div class="stat-box"><span class="k">PACKAGING</span><span class="v">STANDARD</span></div>
          </div>
        </div>

        <div class="penalty-bridge glass-card">
          <div class="bridge-tag">SILICON CONSUMPTION FACTOR</div>
          <div class="bridge-number" id="penalty-mult">3.0x</div>
          <div class="bridge-desc">SURFACE AREA DEFICIT PER EQUIVALENT GIGABYTE</div>
        </div>

        <div class="glass-card comp-panel right-panel active-focus">
          <div class="panel-header">
            <span class="panel-tag accent">ADVANCED AI SILICON</span>
            <h2>HIGH BANDWIDTH MEMORY (HBM3e)</h2>
          </div>
          <div class="wafer-display">
            <svg class="wafer-svg" viewBox="0 0 340 340">
              <circle cx="170" cy="170" r="160" fill="#0d1117" stroke="#00f5ff" stroke-width="4"/>
              ${this.generateWaferGrid(170, 170, 155, 26, "#00f5ff")}
            </svg>
          </div>
          <div class="wafer-stats">
            <div class="stat-box"><span class="k">DIE YIELD</span><span class="v accent">~380 DIES</span></div>
            <div class="stat-box"><span class="k">INTERCONNECT</span><span class="v accent">3D TSV STACK</span></div>
          </div>
        </div>
      </div>
    `;
  }

  // PRIMITIVE 3: Capacity Lockout Timeline
  private renderTimelinePrimitive(scene: StoryboardScene, design: ChannelDesign): string {
    return `
      <div class="timeline-full-layout">
        <div class="supplier-status-grid">
          <div class="glass-card supplier-card" id="hynix-card">
            <div class="supplier-header">
              <div class="sup-title">SK HYNIX PRODUCTION LINES</div>
              <div class="status-pill sold-out">ALLOCATION: 100% SOLD OUT</div>
            </div>
            <div class="bar-track"><div class="bar-fill full-bar" id="bar-1"></div></div>
            <div class="supplier-footer-meta">
              <span>HBM3e / HBM4 CAPACITY</span>
              <span>COMMITTED THROUGH 2026</span>
            </div>
          </div>

          <div class="glass-card supplier-card" id="micron-card">
            <div class="supplier-header">
              <div class="sup-title">MICRON TECHNOLOGY FAB CAPACITY</div>
              <div class="status-pill sold-out">ALLOCATION: 100% PRE-BOOKED</div>
            </div>
            <div class="bar-track"><div class="bar-fill full-bar" id="bar-2"></div></div>
            <div class="supplier-footer-meta">
              <span>1β HBM3e LINES</span>
              <span>LOCKED TO TIER-1 HYPERSCALERS</span>
            </div>
          </div>
        </div>

        <div class="glass-card timeline-strip-card">
          <div class="timeline-title-bar">SUPPLY LOCKOUT HORIZON CHRONOLOGY</div>
          <div class="strip-container">
            <div class="time-node" id="tn-1">
              <div class="node-badge">MID 2024</div>
              <div class="node-point"></div>
              <div class="node-desc">Entire 2024 HBM inventory fully booked</div>
            </div>
            <div class="time-connector"><div class="con-fill" id="cf-1"></div></div>
            <div class="time-node" id="tn-2">
              <div class="node-badge">LATE 2024</div>
              <div class="node-point"></div>
              <div class="node-desc">2025 wafer runs sold out in earnings releases</div>
            </div>
            <div class="time-connector"><div class="con-fill" id="cf-2"></div></div>
            <div class="time-node active-node" id="tn-3">
              <div class="node-badge highlight">2026 HORIZON</div>
              <div class="node-point pulse"></div>
              <div class="node-desc">HBM4 allocations locked under multi-year contracts</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // PRIMITIVE 4: Technical Diagram (Packaging Interposer / Architecture Cross-Section)
  private renderTechnicalDiagramPrimitive(scene: StoryboardScene, design: ChannelDesign): string {
    return `
      <div class="diagram-schematic-grid">
        <div class="glass-card schematic-main-panel">
          <div class="schematic-header">
            <span class="schematic-title">CROSS-SECTION // TSMC CoWoS ADVANCED PACKAGING</span>
            <span class="schematic-sub">CHIP-ON-WAFER-ON-SUBSTRATE INTEGRATION INTERCONNECT</span>
          </div>

          <svg class="schematic-svg" viewBox="0 0 1100 480">
            <rect x="150" y="380" width="800" height="40" rx="4" fill="#1c2130" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
            <text x="550" y="405" fill="#94a3b8" font-size="14" font-family="JetBrains Mono" text-anchor="middle" letter-spacing="2">PACKAGE SUBSTRATE (ORGANIC BGA)</text>

            <g id="solder-balls">
              ${Array.from({ length: 24 }).map((_, i) => `<circle cx="${185 + i * 32}" cy="360" r="10" fill="#64748b" stroke="#00f5ff" stroke-width="1.5"/>`).join("")}
            </g>

            <rect x="220" y="270" width="660" height="70" rx="4" fill="#10192e" stroke="#00f5ff" stroke-width="3"/>
            <text x="550" y="312" fill="#00f5ff" font-size="16" font-family="JetBrains Mono" font-weight="bold" text-anchor="middle" letter-spacing="3">TSMC SILICON INTERPOSER (PASSIVE WITH HIGH-DENSITY TSVs)</text>

            <g id="pulse-conduits">
              <line x1="320" y1="270" x2="450" y2="270" stroke="#ff007f" stroke-width="6" stroke-linecap="round"/>
              <line x1="650" y1="270" x2="780" y2="270" stroke="#ff007f" stroke-width="6" stroke-linecap="round"/>
            </g>

            <rect x="250" y="80" width="160" height="170" rx="4" fill="#161f38" stroke="#00f5ff" stroke-width="2"/>
            <text x="330" y="150" fill="#ffffff" font-size="16" font-weight="bold" text-anchor="middle">HBM3e</text>
            <text x="330" y="175" fill="#94a3b8" font-size="12" text-anchor="middle">12-Hi Stack</text>

            <rect x="440" y="60" width="220" height="190" rx="4" fill="#241638" stroke="#ff007f" stroke-width="3"/>
            <text x="550" y="150" fill="#ffffff" font-size="18" font-weight="bold" text-anchor="middle">AI PROCESSOR</text>
            <text x="550" y="175" fill="#ff007f" font-size="13" text-anchor="middle">Compute GPU Die</text>

            <rect x="690" y="80" width="160" height="170" rx="4" fill="#161f38" stroke="#00f5ff" stroke-width="2"/>
            <text x="770" y="150" fill="#ffffff" font-size="16" font-weight="bold" text-anchor="middle">HBM3e</text>
            <text x="770" y="175" fill="#94a3b8" font-size="12" text-anchor="middle">12-Hi Stack</text>
          </svg>
        </div>

        <div class="glass-card bottleneck-hud-panel">
          <div class="hud-box">
            <div class="hud-label">MANUFACTURING BOTTLENECK</div>
            <div class="hud-highlight" id="choke-metric">52+ WEEKS</div>
            <div class="hud-sub">ORDER WAIT TIME FOR PACKAGING SLOTS</div>
          </div>
          <div class="hud-divider"></div>
          <div class="hud-box">
            <div class="hud-label">EXPANSION TIMELINE</div>
            <div class="hud-val">TSMC AP6 FAB ACTIVE</div>
            <div class="hud-sub">Capacity remains fully saturated into 2026</div>
          </div>
        </div>
      </div>
    `;
  }

  // PRIMITIVE 5: Supply Chain & Buffer Collapse
  private renderSupplyChainPrimitive(scene: StoryboardScene, design: ChannelDesign): string {
    return `
      <div class="siphon-layout">
        <div class="glass-card split-metric-bar">
          <div class="bar-section ai-allocation">
            <span class="sec-label">AI FAB REALLOCATION</span>
            <span class="sec-val">80% OF INCREMENTAL CAPEX</span>
          </div>
          <div class="bar-section commodity-allocation">
            <span class="sec-label">COMMODITY DRAM DEFICIT</span>
            <span class="sec-val">20% FAB SHARE</span>
          </div>
        </div>

        <div class="inventory-drain-grid">
          <div class="glass-card tank-panel">
            <div class="tank-title">HISTORICAL BUFFER</div>
            <div class="tank-display">
              <div class="tank-liquid normal-liquid"><span class="tank-level-txt">16 WEEKS INVENTORY</span></div>
            </div>
            <div class="tank-desc">HEALTHY SUPPLY RESERVE</div>
          </div>

          <div class="drain-arrow-center">
            <div class="arrow-shape">⬇</div>
            <div class="arrow-txt">COLLAPSE</div>
          </div>

          <div class="glass-card tank-panel alert-tank">
            <div class="tank-title">CRITICAL RESERVE</div>
            <div class="tank-display">
              <div class="tank-liquid depleted-liquid" id="red-tank"><span class="tank-level-txt alert-txt">3 WEEKS INVENTORY</span></div>
            </div>
            <div class="tank-desc red-alert">ACUTE SHORTAGE STATUS</div>
          </div>
        </div>
      </div>
    `;
  }

  // PRIMITIVE 6: Large Typography & Kinetic Synthesis
  private renderLargeTypographyPrimitive(scene: StoryboardScene, design: ChannelDesign): string {
    return `
      <div class="tollbooth-container">
        <div class="network-diagram-card glass-card">
          <div class="net-node-left">
            <div class="node-title">AI HYPERSCALERS</div>
            <div class="node-val">$50B+ CAPEX DEPLOYMENT</div>
          </div>

          <div class="tollbooth-gate" id="central-core">
            <div class="gate-ring"></div>
            <div class="gate-title">THE SILICON TOLLBOOTH</div>
            <div class="gate-sub">HBM MEMORY CONTROL</div>
          </div>

          <div class="net-node-right">
            <div class="node-title">PHYSICAL COMPUTING</div>
            <div class="node-val">STARVED CHANNEL SUPPLY</div>
          </div>
        </div>

        <div class="glass-card conclusion-box">
          <div class="kinetic-text-line" id="hit-1">NOT A TEMPORARY SUPPLY HICCUP</div>
          <div class="kinetic-text-line accent-color" id="hit-2">THE DEFINING SILICON TOLLBOOTH</div>
          <div class="kinetic-text-line" id="hit-3">OF THE ARTIFICIAL INTELLIGENCE REVOLUTION</div>
        </div>
      </div>
    `;
  }

  private buildFooter(scene: StoryboardScene, design: ChannelDesign): string {
    const sources = scene.source_references && scene.source_references.length > 0
      ? scene.source_references.join(" • ")
      : "SEMIANALYSIS • TRENDFORCE • BLOOMBERG INTEL";

    return `
      <footer class="doc-footer">
        <div class="doc-footer-source">
          <span class="source-label">EMPIRICAL DATA CITATIONS:</span>
          <span class="source-data">${sources}</span>
        </div>
        <div class="doc-footer-right">
          <span>CHAPTER: ${scene.chapter || "ANALYSIS"} // AUTHENTICATED AUDIT</span>
        </div>
      </footer>
    `;
  }

  private generateWaferGrid(cx: number, cy: number, radius: number, step: number, strokeColor: string = "rgba(255,255,255,0.2)"): string {
    const lines: string[] = [];
    for (let x = cx - radius; x <= cx + radius; x += step) {
      const dy = Math.sqrt(Math.max(0, radius * radius - (x - cx) * (x - cx)));
      lines.push(`<line x1="${x}" y1="${cy - dy}" x2="${x}" y2="${cy + dy}" stroke="${strokeColor}" stroke-width="0.8"/>`);
    }
    for (let y = cy - radius; y <= cy + radius; y += step) {
      const dx = Math.sqrt(Math.max(0, radius * radius - (y - cy) * (y - cy)));
      lines.push(`<line x1="${cx - dx}" y1="${y}" x2="${cx + dx}" y2="${y}" stroke="${strokeColor}" stroke-width="0.8"/>`);
    }
    return lines.join("\n");
  }

  private buildCustomStyles(scene: StoryboardScene, mode: VisualMode, design: ChannelDesign): string {
    return `
      /* Data Vis */
      .data-vis-grid { display: flex; gap: 30px; width: 100%; height: 100%; }
      .metric-hero-panel { width: 440px; padding: 36px; display: flex; flex-direction: column; justify-content: center; }
      .huge-counter { font-size: 88px; font-weight: 900; color: #00f5ff; line-height: 1; margin: 16px 0; }
      .metric-caption { font-size: 20px; font-weight: 700; color: #ffffff; }
      .metric-subdetail { font-size: 14px; color: #94a3b8; margin-top: 8px; font-family: ${design.typography.fontFamilyCode}; }
      .chart-hero-panel { flex: 1; padding: 30px; display: flex; flex-direction: column; }
      .chart-header { display: flex; justify-content: space-between; font-family: ${design.typography.fontFamilyCode}; font-size: 13px; color: #94a3b8; margin-bottom: 16px; }
      .chart-status { color: #ff007f; font-weight: 700; }
      .data-svg { width: 100%; height: 100%; }

      /* Comparison */
      .comparison-container { display: flex; gap: 24px; width: 100%; height: 100%; align-items: center; }
      .comp-panel { flex: 1; padding: 24px; height: 100%; display: flex; flex-direction: column; justify-content: space-between; align-items: center; }
      .panel-tag { font-family: ${design.typography.fontFamilyCode}; font-size: 12px; color: #94a3b8; letter-spacing: 2px; }
      .panel-tag.accent { color: #00f5ff; }
      .wafer-display { width: 300px; height: 300px; margin: 10px auto; }
      .wafer-stats { display: flex; gap: 16px; width: 100%; justify-content: center; font-family: ${design.typography.fontFamilyCode}; font-size: 13px; }
      .stat-box .accent { color: #00f5ff; font-weight: bold; }
      .penalty-bridge { width: 260px; padding: 20px; text-align: center; }
      .bridge-tag { font-size: 11px; color: #94a3b8; font-family: ${design.typography.fontFamilyCode}; }
      .bridge-number { font-size: 64px; font-weight: 900; color: #ff007f; }
      .bridge-desc { font-size: 11px; color: #94a3b8; }

      /* Timeline */
      .timeline-full-layout { width: 100%; height: 100%; display: flex; flex-direction: column; gap: 24px; }
      .supplier-status-grid { display: flex; gap: 24px; }
      .supplier-card { flex: 1; padding: 20px; }
      .supplier-header { display: flex; justify-content: space-between; font-size: 13px; font-family: ${design.typography.fontFamilyCode}; margin-bottom: 12px; }
      .status-pill.sold-out { color: #ffffff; background: #b91c1c; padding: 3px 8px; border-radius: 4px; font-weight: bold; }
      .bar-track { height: 10px; background: rgba(255,255,255,0.1); border-radius: 5px; overflow: hidden; margin-bottom: 8px; }
      .bar-fill.full-bar { height: 100%; width: 100%; background: #00f5ff; }
      .supplier-footer-meta { display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; font-family: ${design.typography.fontFamilyCode}; }
      .timeline-strip-card { flex: 1; padding: 24px; display: flex; flex-direction: column; justify-content: center; }
      .timeline-title-bar { font-size: 12px; color: #94a3b8; font-family: ${design.typography.fontFamilyCode}; margin-bottom: 24px; }
      .strip-container { display: flex; align-items: center; justify-content: space-between; padding: 0 40px; }
      .time-node { text-align: center; }
      .node-badge { font-size: 13px; color: #00f5ff; font-family: ${design.typography.fontFamilyCode}; margin-bottom: 8px; }
      .node-point { width: 14px; height: 14px; border-radius: 50%; background: #00f5ff; margin: 0 auto 8px; }
      .node-desc { font-size: 13px; color: #ffffff; max-width: 220px; }
      .time-connector { flex: 1; height: 3px; background: rgba(255,255,255,0.1); margin: 0 16px; }

      /* Schematic */
      .diagram-schematic-grid { display: flex; gap: 24px; width: 100%; height: 100%; }
      .schematic-main-panel { flex: 1; padding: 20px; display: flex; flex-direction: column; }
      .schematic-header { margin-bottom: 16px; }
      .schematic-title { font-size: 14px; color: #00f5ff; font-family: ${design.typography.fontFamilyCode}; font-weight: bold; }
      .schematic-sub { font-size: 12px; color: #94a3b8; }
      .schematic-svg { width: 100%; height: 100%; }
      .bottleneck-hud-panel { width: 340px; padding: 30px; display: flex; flex-direction: column; justify-content: space-around; }
      .hud-label { font-size: 12px; color: #94a3b8; font-family: ${design.typography.fontFamilyCode}; }
      .hud-highlight { font-size: 52px; font-weight: 900; color: #ff007f; margin: 8px 0; }
      .hud-sub { font-size: 12px; color: #94a3b8; }
      .hud-val { font-size: 18px; font-weight: bold; color: #00f5ff; margin: 6px 0; }

      /* Siphon */
      .siphon-layout { width: 100%; height: 100%; display: flex; flex-direction: column; gap: 24px; }
      .split-metric-bar { display: flex; height: 70px; border-radius: 8px; overflow: hidden; }
      .bar-section.ai-allocation { flex: 4; background: rgba(0,245,255,0.15); border-right: 2px solid #00f5ff; padding: 12px 20px; }
      .bar-section.commodity-allocation { flex: 1; background: rgba(255,0,127,0.15); padding: 12px 20px; }
      .inventory-drain-grid { flex: 1; display: flex; gap: 24px; align-items: center; }
      .tank-panel { flex: 1; height: 100%; padding: 20px; display: flex; flex-direction: column; align-items: center; justify-content: space-between; }
      .tank-display { width: 160px; height: 220px; border: 2px solid rgba(255,255,255,0.2); border-radius: 8px; position: relative; overflow: hidden; display: flex; align-items: flex-end; }
      .tank-liquid.normal-liquid { width: 100%; height: 80%; background: #00f5ff; display: flex; align-items: center; justify-content: center; }
      .tank-liquid.depleted-liquid { width: 100%; height: 25%; background: #b91c1c; display: flex; align-items: center; justify-content: center; }
      .tank-level-txt { font-size: 12px; font-weight: bold; color: #ffffff; }
      .drain-arrow-center { text-align: center; font-size: 28px; color: #ff007f; }

      /* Typography / Tollbooth */
      .tollbooth-container { width: 100%; height: 100%; display: flex; flex-direction: column; gap: 24px; }
      .network-diagram-card { flex: 1; display: flex; justify-content: space-around; align-items: center; padding: 24px; }
      .tollbooth-gate { width: 220px; height: 220px; border-radius: 50%; border: 3px solid #ff007f; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; box-shadow: 0 0 40px rgba(255,0,127,0.3); }
      .conclusion-box { padding: 28px; text-align: center; }
      .kinetic-text-line { font-size: 28px; font-weight: 800; color: #ffffff; line-height: 1.3; }
      .kinetic-text-line.accent-color { color: #00f5ff; }
    `;
  }

  private buildGsapScript(scene: StoryboardScene, mode: VisualMode, design: ChannelDesign): string {
    const dur = scene.duration;

    return `
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    window.__timelines["${scene.id}"] = tl;

    // Timeline padding to guarantee authoritative duration
    tl.to({}, { duration: ${dur} }, 0);

    // Camera ambient push
    tl.to("#root", { scale: 1.02, duration: ${dur}, ease: "none" }, 0);

    // Headline entrance
    tl.from("#scene-headline", { opacity: 0, y: 25, duration: 0.8, ease: "${design.motion.easeDefault}" }, 0.1);
    tl.from("#scene-subhead", { opacity: 0, y: 15, duration: 0.8, ease: "${design.motion.easeDefault}" }, 0.3);

    // Primitive animations based on mode
    ${this.getModeSpecificGsapScript(mode, dur)}
  </script>
    `;
  }

  private getModeSpecificGsapScript(mode: VisualMode, dur: number): string {
    switch (mode) {
      case "data_visualization":
      case "chart":
        return `
          tl.from("#curvePath", { strokeDashoffset: 1200, strokeDasharray: 1200, duration: 1.8, ease: "power2.out" }, 0.5);
          tl.from("#curveArea", { opacity: 0, duration: 1.5, ease: "power2.out" }, 0.8);
          tl.from("#main-counter", { scale: 0.9, opacity: 0, duration: 0.9, ease: "back.out(1.7)" }, 0.4);
        `;
      case "comparison":
        return `
          tl.from(".left-panel", { x: -40, opacity: 0, duration: 0.9, ease: "power3.out" }, 0.3);
          tl.from(".right-panel", { x: 40, opacity: 0, duration: 0.9, ease: "power3.out" }, 0.5);
          tl.from("#penalty-mult", { scale: 0, opacity: 0, duration: 0.8, ease: "elastic.out(1, 0.75)" }, 0.8);
        `;
      case "timeline":
      case "historical_sequence":
        return `
          tl.from("#hynix-card", { y: 30, opacity: 0, duration: 0.8 }, 0.3);
          tl.from("#micron-card", { y: 30, opacity: 0, duration: 0.8 }, 0.5);
          tl.from(".time-node", { opacity: 0, scale: 0.8, stagger: 0.3, duration: 0.7 }, 0.8);
        `;
      case "technical_diagram":
      case "architecture_diagram":
        return `
          tl.from(".schematic-main-panel", { opacity: 0, scale: 0.95, duration: 1.0 }, 0.3);
          tl.from("#choke-metric", { scale: 1.2, opacity: 0, duration: 0.8, ease: "back.out(1.5)" }, 0.7);
        `;
      case "supply_chain_flow":
      case "process_animation":
        return `
          tl.from(".split-metric-bar", { opacity: 0, y: -20, duration: 0.8 }, 0.2);
          tl.from("#red-tank", { height: "70%", duration: 1.5, ease: "power2.inOut" }, 0.6);
        `;
      default:
        return `
          tl.from(".kinetic-text-line", { opacity: 0, y: 20, stagger: 0.4, duration: 0.9, ease: "power3.out" }, 0.4);
        `;
    }
  }
}
