import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ChannelDesign, ChannelDesignSchema } from "../schemas/design.js";

export class DesignDirectorAgent {
  private designPath: string;
  private versionPath: string;

  constructor(options?: { designPath?: string; versionPath?: string }) {
    this.designPath = options?.designPath || resolve(process.cwd(), "design/channel-design.json");
    this.versionPath = options?.versionPath || resolve(process.cwd(), "design/design-version.txt");
  }

  public getDesign(): ChannelDesign {
    if (!existsSync(this.designPath)) {
      throw new Error(`Channel design specification not found at ${this.designPath}`);
    }
    const raw = readFileSync(this.designPath, "utf-8");
    return ChannelDesignSchema.parse(JSON.parse(raw));
  }

  public getVersion(): string {
    if (existsSync(this.versionPath)) {
      return readFileSync(this.versionPath, "utf-8").trim();
    }
    return "1.0.0";
  }
}
