import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ScriptResult, ScriptResultSchema } from "../schemas/script.js";

export class ScriptAgent {
  /**
   * Loads and validates the long-form documentary script produced by the Antigravity Script Agent.
   * Ensures companion script/script.md markdown exists.
   */
  public async loadOrValidate(outputDir: string = process.cwd()): Promise<ScriptResult> {
    const scriptDir = join(outputDir, "script");
    const jsonPath = join(scriptDir, "script.json");
    const mdPath = join(scriptDir, "script.md");

    if (!existsSync(jsonPath)) {
      throw new Error(
        `[SCRIPT AGENT] Missing script artifact at ${jsonPath}.\n` +
        `The Antigravity Script Agent must compose a documentary script adhering to ` +
        `ScriptResultSchema at script/script.json.`
      );
    }

    try {
      const raw = readFileSync(jsonPath, "utf-8");
      const parsed = JSON.parse(raw);
      const validated = ScriptResultSchema.parse(parsed);

      const totalWords = validated.scenes.reduce((acc, s) => acc + s.narration.trim().split(/\s+/).length, 0);
      const estimatedMinutes = Math.round((totalWords / 150) * 10) / 10;

      console.log(`[SCRIPT] Successfully verified documentary script: "${validated.title}"`);
      console.log(`  - Scenes: ${validated.scenes.length}`);
      console.log(`  - Chapters: ${validated.chapters?.length || 0}`);
      console.log(`  - Total word count: ${totalWords} words`);
      console.log(`  - Estimated spoken duration: ~${estimatedMinutes} minutes (at 150 wpm)`);

      if (!existsSync(mdPath)) {
        this.generateMarkdown(validated, totalWords, estimatedMinutes, mdPath);
      }

      return validated;
    } catch (err: any) {
      throw new Error(`[SCRIPT AGENT] Script validation failed at ${jsonPath}: ${err.message}`);
    }
  }

  private generateMarkdown(script: ScriptResult, totalWords: number, estimatedMinutes: number, mdPath: string): void {
    const lines: string[] = [
      `# Documentary Script: ${script.title}`,
      ``,
      `*Total Words:* ${totalWords} | *Estimated Duration:* ~${estimatedMinutes} mins`,
      ``,
      `## Cold Open Hook`,
      `> ${script.hook}`,
      ``,
      `## Narrative Scenes`,
      ...script.scenes.map((s, i) =>
        `### Scene ${i + 1}: \`${s.id}\` — ${s.purpose}\n` +
        (s.chapter ? `*Chapter:* ${s.chapter}\n\n` : "") +
        `> "${s.narration}"\n\n` +
        `*Visual Hint:* ${s.visual_hint}\n`
      ),
      ``,
      `## Closing Takeaway`,
      `> ${script.ending}`
    ];

    writeFileSync(mdPath, lines.join("\n"), "utf-8");
    console.log(`[SCRIPT] Emitted companion script markdown to ${mdPath}`);
  }
}
