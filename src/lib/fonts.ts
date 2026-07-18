/**
 * Registers the fonts every HUD canvas card (greetCard.ts, rankUpCard.ts)
 * needs, exactly once per process.
 *
 * @napi-rs/canvas ships with zero fonts and no system-font fallback —
 * ctx.fillText() silently draws nothing instead of throwing when no font
 * is registered. A dev machine with fonts installed hides this; a bare
 * container (Railway's default Node image included) has none, which is
 * why a card can render its shapes/colors fine while every piece of text
 * on it is blank.
 *
 * These two .ttf files are bundled directly in assets/fonts/ (Instrument
 * Sans + JetBrains Mono, both SIL Open Font License — free to redistribute)
 * so text always renders regardless of the host, with no manual download
 * step required.
 */
import { GlobalFonts } from "@napi-rs/canvas";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FONTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../assets/fonts");

export const SANS_FONT = "Greet Sans";
export const MONO_FONT = "Greet Mono";

let fontsRegistered = false;

export function ensureFontsRegistered(): void {
  if (fontsRegistered) return;
  fontsRegistered = true;
  const files: [string, string][] = [
    ["InstrumentSans-Regular.ttf", SANS_FONT],
    ["InstrumentSans-Bold.ttf", SANS_FONT],
    ["JetBrainsMono-Regular.ttf", MONO_FONT],
  ];
  for (const [file, family] of files) {
    try {
      GlobalFonts.registerFromPath(path.join(FONTS_DIR, file), family);
    } catch (error) {
      console.error(`fonts: failed to register ${file} — text will render blank:`, error);
    }
  }
}
