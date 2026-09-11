import { z } from "zod";

export const ChannelDesignSchema = z.object({
  version: z.string(),
  name: z.string(),
  canvas: z.object({
    width: z.number().default(1920),
    height: z.number().default(1080),
    fps: z.number().default(30),
    safeZone: z.object({
      top: z.number(),
      bottom: z.number(),
      left: z.number(),
      right: z.number()
    })
  }),
  typography: z.object({
    fontFamilyDisplay: z.string(),
    fontFamilyBody: z.string(),
    fontFamilyCode: z.string(),
    scale: z.object({
      hero: z.string(),
      h1: z.string(),
      h2: z.string(),
      h3: z.string(),
      body: z.string(),
      caption: z.string()
    }),
    lineHeight: z.number(),
    weights: z.object({
      bold: z.number(),
      semi: z.number(),
      normal: z.number()
    })
  }),
  colors: z.object({
    background: z.string(),
    backgroundElevated: z.string(),
    surface: z.string(),
    surfaceBorder: z.string(),
    primary: z.string(),
    secondary: z.string(),
    accent: z.string(),
    success: z.string(),
    warning: z.string(),
    text: z.string(),
    textMuted: z.string(),
    textFaint: z.string(),
    gridLine: z.string()
  }),
  motion: z.object({
    easeDefault: z.string(),
    easeEmphasis: z.string(),
    durationFast: z.number(),
    durationMedium: z.number(),
    durationSlow: z.number(),
    staggerDefault: z.number()
  }),
  visualStyles: z.object({
    density: z.string(),
    cardBorderRadius: z.string(),
    cardGlow: z.string(),
    chartTheme: z.object({
      gridColor: z.string(),
      lineColor: z.string(),
      fillColor: z.string(),
      barColor: z.string(),
      accentColor: z.string()
    }),
    diagramTheme: z.object({
      nodeBackground: z.string(),
      nodeBorder: z.string(),
      edgeColor: z.string(),
      edgeActive: z.string()
    })
  })
});
export type ChannelDesign = z.infer<typeof ChannelDesignSchema>;
