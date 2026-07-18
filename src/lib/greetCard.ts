/**
 * Renders the welcome/goodbye HUD card as a PNG buffer, in-process.
 *
 * This is a direct port of Aqua-API's `packages/aqua/src/apis/canvas/greet.ts`
 * canvas drawing code — join.ts/leave.ts used to call that as an HTTP API to
 * get an image back. This module inlines the same drawing logic instead, so
 * there's no network round trip, no API server to keep running, and no
 * failure mode where the greet card silently doesn't send because the API
 * was down. Only the pieces join.ts/leave.ts actually need were kept: the
 * Telegram-sized card only (Aqua-API's Discord layout was dropped), and the
 * optional background-photo option was dropped since neither event has one
 * to pass. Everything else — panel geometry, avatar hex frame, chip/badge
 * drawing, the named-color palette — matches the original exactly.
 */
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

type Rgb = [number, number, number];
type LoadedImage = Awaited<ReturnType<typeof loadImage>>;
export type GreetEventType = "welcome" | "goodbye";

export interface GreetCardOptions {
  type: GreetEventType;
  /** Display name of the member joining/leaving. */
  username: string;
  /** User's avatar image URL. Falls back to a generated emblem when omitted. */
  avatarUrl?: string | null;
  /** Group name, shown beneath the username. */
  serverName?: string | null;
  /** Optional small readout line beneath the status chip. */
  message?: string | null;
  /** Current member count, badged in the top-right corner. */
  memberCount?: number | null;
  /** Named accent color. Defaults to Green for welcome, Red for goodbye. */
  color?: string;
}

/** Accent palette — vivid, high-contrast tones tuned for a dark cybernetic HUD surface. */
const NAMED_COLORS: { name: string; hex: string }[] = [
  { name: "Cyan", hex: "#33d0fb" },
  { name: "Blue", hex: "#3b82f6" },
  { name: "Purple", hex: "#8b5cf6" },
  { name: "Pink", hex: "#ec4899" },
  { name: "Red", hex: "#ef4444" },
  { name: "Orange", hex: "#f97316" },
  { name: "Yellow", hex: "#eab308" },
  { name: "Green", hex: "#22c55e" },
];

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

const NAMED_COLOR_LOOKUP = new Map(NAMED_COLORS.map((c) => [normalizeKey(c.name), c.hex]));

function resolveColor(value: string | undefined, fallback: string): Rgb {
  if (!value || !value.trim()) {
    return hexToRgb(NAMED_COLOR_LOOKUP.get(normalizeKey(fallback))!);
  }
  const hex = NAMED_COLOR_LOOKUP.get(normalizeKey(value));
  // Unrecognized color name: fall back quietly rather than throwing, since
  // there's no HTTP caller here to report a 400 back to.
  return hex ? hexToRgb(hex) : hexToRgb(NAMED_COLOR_LOOKUP.get(normalizeKey(fallback))!);
}

// Telegram card geometry — full 1200x600 (exact 2:1) angular HUD panel.
const WIDTH = 1200;
const HEIGHT = 600;
const PANEL_PAD = 48;
const PANEL_R = 22;
const PANEL_CUT = 42;
const BRACKET_LEN = 30;
const BRACKET_INSET = 16;
const AVATAR_CX_OFFSET = 196;
const AVATAR_R = 122;
const CONTENT_X_OFFSET = 100;
const RIGHT_EDGE_OFFSET = 60;
const CHIP_FONT = 18;
const CHIP_FONT_MIN = 12;
const CHIP_HEIGHT_PAD = 24;
const CHIP_HEIGHT_MIN = 34;
const EYEBROW_FONT_SIZE = 15;
const EYEBROW_SHADOW_BLUR = 10;
const USERNAME_FONT_MAX = 46;
const USERNAME_FONT_MIN = 26;
const REL_EYEBROW_BASELINE = 11;
const REL_USERNAME_GAP = 58;
const REL_CHIP_GAP = 38;
const REL_READOUT_GAP = 34;
const BLOCK_EXTRA = 4;
const MSG_FONT_MAX = 18;
const MSG_FONT_MIN = 13;
const MSG_OFFSET_X = 18;
const MSG_RECT_SIZE = 6;
const BADGE_CHIP_HEIGHT = 44;
const BADGE_CHIP_Y = 64;
const BADGE_CUT = 12;
const BADGE_DOT_R = 4;
const BADGE_DOT_OFFSET = 22;
const BADGE_SHADOW_BLUR = 16;
const BADGE_SHADOW_OFFSET_Y = 6;
const BADGE_DOT_SHADOW_BLUR = 8;
const BADGE_LABEL_FONT_SIZE = 11;
const BADGE_LABEL_OFFSET_X = 36;
const BADGE_LABEL_OFFSET_Y = -8;
const BADGE_VALUE_OFFSET_X = 36;
const BADGE_VALUE_OFFSET_Y = 10;
const BADGE_MEASURE_PAD = 54;
const BADGE_MAX_WIDTH_PANEL_PAD = 32;
const BADGE_MAX_WIDTH_AVATAR_GAP = 40;

function hexToRgb(hex: string): Rgb {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const int = parseInt(h, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function rgba([r, g, b]: Rgb, a: number): string {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function lighten([r, g, b]: Rgb, amt: number): Rgb {
  return [Math.min(255, r + amt), Math.min(255, g + amt), Math.min(255, b + amt)];
}

/**
 * Resolves a remote avatar URL to a temp file and loads it with loadImage().
 * Writing to disk first avoids the "@napi-rs/canvas" "Invalid SVG image" bug
 * that occurs when passing a raw Buffer directly. Returns null (rather than
 * throwing) on any fetch/decode failure so the card falls back to the
 * generated emblem instead of failing the whole join/leave event.
 */
async function loadRemoteImage(source: string, prefix: string): Promise<LoadedImage | null> {
  try {
    const res = await fetch(source);
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const ext =
      contentType.split("/")[1]?.replace("jpeg", "jpg")?.replace("svg+xml", "svg")?.split(";")[0] ||
      "jpg";
    const buf = Buffer.from(await res.arrayBuffer());

    const tmp = join(tmpdir(), `${prefix}_${randomBytes(8).toString("hex")}.${ext}`);
    writeFileSync(tmp, buf);
    try {
      return await loadImage(tmp);
    } finally {
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore cleanup errors */
      }
    }
  } catch {
    return null;
  }
}

/** Rounded rect with two opposite corners clipped diagonally — the core "tech panel" silhouette. */
function cyberPanelPath(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number, cut: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - cut, y);
  ctx.lineTo(x + w, y + cut);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + cut, y + h);
  ctx.lineTo(x, y + h - cut);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawHexPath(ctx: SKRSContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    const px = cx + r * Math.cos(angle);
    const py = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** Thin HUD corner bracket, drawn pointing inward from (x, y) by dx/dy sign. */
function drawCornerBracket(ctx: SKRSContext2D, x: number, y: number, dx: number, dy: number, len: number, color: Rgb): void {
  ctx.save();
  ctx.strokeStyle = rgba(color, 0.85);
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.shadowColor = rgba(color, 0.8);
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(x, y + dy * len);
  ctx.lineTo(x, y);
  ctx.lineTo(x + dx * len, y);
  ctx.stroke();
  ctx.restore();
}

/** Deep-space background: gradient base, faint dot grid, and two restrained accent glows. */
function drawBackground(ctx: SKRSContext2D, color: Rgb, width: number, height: number): void {
  const base = ctx.createLinearGradient(0, 0, width, height);
  base.addColorStop(0, "#05070b");
  base.addColorStop(0.55, "#080a10");
  base.addColorStop(1, "#050609");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  const glowTL = ctx.createRadialGradient(width * 0.1, height * 0.05, 0, width * 0.1, height * 0.05, 560);
  glowTL.addColorStop(0, rgba(color, 0.16));
  glowTL.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = glowTL;
  ctx.fillRect(0, 0, width, height);

  const glowBR = ctx.createRadialGradient(width * 0.98, height * 1.02, 0, width * 0.98, height * 1.02, 460);
  glowBR.addColorStop(0, rgba(color, 0.1));
  glowBR.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = glowBR;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
  for (let gy = 20; gy < height; gy += 28) {
    for (let gx = 20; gx < width; gx += 28) {
      ctx.fillRect(gx, gy, 1, 1);
    }
  }
  ctx.restore();
}

/** Angular cyber panel that hosts all content, with a gradient edge, hairline border, and corner brackets. */
function drawPanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, color: Rgb): void {
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 22;
  cyberPanelPath(ctx, x, y, w, h, PANEL_R, PANEL_CUT);
  ctx.fillStyle = "#0c0e13";
  ctx.fill();
  ctx.restore();

  ctx.save();
  cyberPanelPath(ctx, x, y, w, h, PANEL_R, PANEL_CUT);
  ctx.clip();
  const sheen = ctx.createLinearGradient(0, y, 0, y + h);
  sheen.addColorStop(0, "rgba(255, 255, 255, 0.04)");
  sheen.addColorStop(0.35, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, w, h);
  ctx.restore();

  ctx.save();
  cyberPanelPath(ctx, x + 0.75, y + 0.75, w - 1.5, h - 1.5, PANEL_R, PANEL_CUT);
  const borderGrad = ctx.createLinearGradient(x, y, x + w, y + h);
  borderGrad.addColorStop(0, rgba(color, 0.55));
  borderGrad.addColorStop(0.5, "rgba(255, 255, 255, 0.08)");
  borderGrad.addColorStop(1, rgba(color, 0.4));
  ctx.strokeStyle = borderGrad;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + w - PANEL_CUT, y);
  ctx.lineTo(x + w, y + PANEL_CUT);
  ctx.lineTo(x + w, y);
  ctx.closePath();
  ctx.fillStyle = rgba(color, 0.7);
  ctx.fill();
  ctx.restore();

  drawCornerBracket(ctx, x + BRACKET_INSET, y + BRACKET_INSET, 1, 1, BRACKET_LEN, color);
  drawCornerBracket(ctx, x + w - BRACKET_INSET, y + h - BRACKET_INSET, -1, -1, BRACKET_LEN, color);
}

/** Simple stylized silhouette used as the fallback avatar when none is supplied. */
function drawFallbackGlyph(ctx: SKRSContext2D, cx: number, cy: number, r: number, color: Rgb): void {
  ctx.save();
  ctx.fillStyle = rgba(lighten(color, 0), 0.16);
  drawHexPath(ctx, cx, cy, r);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = rgba(color, 0.9);
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.22, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.5, cy + r * 0.55);
  ctx.quadraticCurveTo(cx - r * 0.5, cy + r * 0.1, cx, cy + r * 0.1);
  ctx.quadraticCurveTo(cx + r * 0.5, cy + r * 0.1, cx + r * 0.5, cy + r * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = rgba(color, 0.35);
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 12; i++) {
    if (i % 2 === 0) continue;
    const angle = (Math.PI * 2 * i) / 12;
    const rr1 = r * 0.86;
    const rr2 = r * 0.96;
    ctx.beginPath();
    ctx.moveTo(cx + rr1 * Math.cos(angle), cy + rr1 * Math.sin(angle));
    ctx.lineTo(cx + rr2 * Math.cos(angle), cy + rr2 * Math.sin(angle));
    ctx.stroke();
  }
  ctx.restore();
}

/** Hex avatar frame with tick-marked ring and a small badge overlapping the bottom-right — a "+" for welcome, a "–" for goodbye. */
function drawAvatar(ctx: SKRSContext2D, image: LoadedImage | null, cx: number, cy: number, r: number, color: Rgb, eventType: GreetEventType): void {
  ctx.save();
  ctx.strokeStyle = rgba(color, 0.28);
  ctx.lineWidth = 2;
  drawHexPath(ctx, cx, cy, r + 22);
  ctx.stroke();

  ctx.strokeStyle = rgba(color, 0.9);
  ctx.lineWidth = 3;
  ctx.shadowColor = rgba(color, 0.85);
  ctx.shadowBlur = 20;
  drawHexPath(ctx, cx, cy, r + 10);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  drawHexPath(ctx, cx, cy, r);
  ctx.clip();
  if (image) {
    ctx.drawImage(image, cx - r, cy - r, r * 2, r * 2);
  } else {
    const bgGrad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    bgGrad.addColorStop(0, "#14161d");
    bgGrad.addColorStop(1, "#0a0b0f");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.restore();

  if (!image) drawFallbackGlyph(ctx, cx, cy, r, color);

  ctx.save();
  ctx.strokeStyle = rgba(color, 1);
  ctx.lineWidth = 2;
  drawHexPath(ctx, cx, cy, r);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = rgba(color, 0.65);
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 24; i++) {
    if (i % 3 === 0) continue;
    const angle = (Math.PI * 2 * i) / 24;
    const rr1 = r + 30;
    const rr2 = r + 36;
    ctx.beginPath();
    ctx.moveTo(cx + rr1 * Math.cos(angle), cy + rr1 * Math.sin(angle));
    ctx.lineTo(cx + rr2 * Math.cos(angle), cy + rr2 * Math.sin(angle));
    ctx.stroke();
  }
  ctx.restore();

  const badgeR = r * 0.24;
  const badgeCx = cx + r * 0.78;
  const badgeCy = cy + r * 0.78;

  ctx.save();
  drawHexPath(ctx, badgeCx, badgeCy, badgeR + 6);
  ctx.fillStyle = "#0a0b0f";
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.shadowColor = rgba(color, 0.6);
  ctx.shadowBlur = 16;
  drawHexPath(ctx, badgeCx, badgeCy, badgeR);
  const badgeGrad = ctx.createLinearGradient(badgeCx, badgeCy - badgeR, badgeCx, badgeCy + badgeR);
  badgeGrad.addColorStop(0, rgba(lighten(color, 30), 1));
  badgeGrad.addColorStop(1, rgba(color, 1));
  ctx.fillStyle = badgeGrad;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "#0a0b0f";
  ctx.lineWidth = Math.max(2.5, badgeR * 0.22);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const armLen = badgeR * 0.55;
  if (eventType === "welcome") {
    ctx.beginPath();
    ctx.moveTo(badgeCx - armLen, badgeCy);
    ctx.lineTo(badgeCx + armLen, badgeCy);
    ctx.moveTo(badgeCx, badgeCy - armLen);
    ctx.lineTo(badgeCx, badgeCy + armLen);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(badgeCx - armLen, badgeCy);
    ctx.lineTo(badgeCx + armLen, badgeCy);
    ctx.stroke();
  }
  ctx.restore();
}

/** Draws left-aligned text, shrinking the font size (down to minSize) until it fits maxWidth. */
function fitText(ctx: SKRSContext2D, text: string, x: number, y: number, maxWidth: number, weight: string, maxSize: number, minSize: number, fillStyle: string): void {
  let size = maxSize;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  while (size > minSize) {
    ctx.font = `${weight} ${size}px -apple-system, "SF Pro Display", "Roboto", sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 1;
  }
  ctx.font = `${weight} ${size}px -apple-system, "SF Pro Display", "Roboto", sans-serif`;
  let out = text;
  while (ctx.measureText(out).width > maxWidth && out.length > 1) {
    out = out.slice(0, -1);
  }
  if (out !== text) out = `${out.slice(0, -1)}…`;
  ctx.fillStyle = fillStyle;
  ctx.shadowColor = "rgba(0, 0, 0, 0.75)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  ctx.fillText(out, x, y);
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/** Angular tech chip (rounded rect with two small clipped corners) sized to its own text. */
function drawChip(ctx: SKRSContext2D, x: number, y: number, text: string, opts: { fill: string; textColor: string; fontSize: number; weight: string; height: number; border?: string }): void {
  const paddingX = 18;
  const h = opts.height;
  const font = `${opts.weight} ${opts.fontSize}px -apple-system, "SF Pro Display", "Roboto", sans-serif`;
  ctx.save();
  ctx.font = font;
  const textW = ctx.measureText(text).width;
  const w = textW + paddingX * 2;
  const cut = h * 0.32;

  ctx.beginPath();
  ctx.moveTo(x + cut, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - cut);
  ctx.lineTo(x + w - cut, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + cut);
  ctx.closePath();

  ctx.fillStyle = opts.fill;
  ctx.fill();
  if (opts.border) {
    ctx.strokeStyle = opts.border;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  ctx.fillStyle = opts.textColor;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + paddingX, y + h / 2 + 1);
  ctx.restore();
}

/** Renders the card and returns it as a PNG buffer. */
export async function generateGreetCard(opts: GreetCardOptions): Promise<Buffer> {
  const defaultColor = opts.type === "welcome" ? "Green" : "Red";
  const color = resolveColor(opts.color, defaultColor);

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  drawBackground(ctx, color, WIDTH, HEIGHT);

  const panelX = PANEL_PAD;
  const panelY = PANEL_PAD;
  const panelW = WIDTH - panelX * 2;
  const panelH = HEIGHT - panelY * 2;
  drawPanel(ctx, panelX, panelY, panelW, panelH, color);

  const avatarImg = opts.avatarUrl ? await loadRemoteImage(opts.avatarUrl, "greet_avatar") : null;
  const cx = panelX + AVATAR_CX_OFFSET;
  const cy = HEIGHT / 2;
  const r = AVATAR_R;
  drawAvatar(ctx, avatarImg, cx, cy, r, color, opts.type);

  const contentX = cx + r + CONTENT_X_OFFSET;
  const rightEdge = panelX + panelW - RIGHT_EDGE_OFFSET;
  const maxContentW = Math.max(80, rightEdge - contentX);

  const statusLabel = opts.type === "welcome" ? "NEW MEMBER" : "MEMBER LEFT";
  let chipFont = CHIP_FONT;
  const measureChipWidth = (fs: number): number => {
    ctx.font = `700 ${fs}px -apple-system, "SF Pro Display", "Roboto", sans-serif`;
    return ctx.measureText(statusLabel).width + 36;
  };
  while (chipFont > CHIP_FONT_MIN && measureChipWidth(chipFont) > maxContentW) chipFont -= 1;
  const chipH = Math.max(CHIP_HEIGHT_MIN, chipFont + CHIP_HEIGHT_PAD);

  const relUsernameBaseline = REL_EYEBROW_BASELINE + REL_USERNAME_GAP;
  const relChipTop = relUsernameBaseline + REL_CHIP_GAP;
  const relChipBottom = relChipTop + chipH;
  const relReadoutBaseline = relChipBottom + REL_READOUT_GAP;
  const blockHeight = opts.message ? relReadoutBaseline + BLOCK_EXTRA : relChipBottom;

  const blockTop = cy - blockHeight / 2;
  const eyebrowY = blockTop + REL_EYEBROW_BASELINE;
  const usernameY = blockTop + relUsernameBaseline;
  const chipRowY = blockTop + relChipTop;
  const readoutY = blockTop + relReadoutBaseline;

  ctx.save();
  ctx.font = `700 ${EYEBROW_FONT_SIZE}px "Courier New", monospace`;
  ctx.fillStyle = rgba(color, 1);
  ctx.shadowColor = rgba(color, 0.7);
  ctx.shadowBlur = EYEBROW_SHADOW_BLUR;
  ctx.textAlign = "left";
  ctx.fillText(opts.type === "welcome" ? "[ WELCOME ]" : "[ GOODBYE ]", contentX, eyebrowY);
  ctx.restore();

  fitText(ctx, opts.username, contentX, usernameY, maxContentW, "700", USERNAME_FONT_MAX, USERNAME_FONT_MIN, "#f5f6f8");

  drawChip(ctx, contentX, chipRowY, statusLabel, {
    fill: opts.type === "welcome" ? rgba(color, 1) : "rgba(10, 12, 16, 0.55)",
    textColor: opts.type === "welcome" ? "#05070b" : "rgba(255, 255, 255, 0.75)",
    fontSize: chipFont,
    weight: "700",
    height: chipH,
    border: opts.type === "welcome" ? undefined : "rgba(255, 255, 255, 0.2)",
  });

  const readoutText = [opts.serverName ?? null, opts.message ?? null].filter(Boolean).join("  ·  ") || opts.message || opts.serverName;
  if (readoutText) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(contentX, readoutY - (MSG_RECT_SIZE + 2), MSG_RECT_SIZE, MSG_RECT_SIZE);
    ctx.fillStyle = rgba(color, 0.9);
    ctx.fill();
    ctx.restore();

    fitText(ctx, readoutText, contentX + MSG_OFFSET_X, readoutY, maxContentW - MSG_OFFSET_X, "500", MSG_FONT_MAX, MSG_FONT_MIN, "rgba(255, 255, 255, 0.55)");
  }

  if (opts.memberCount != null) {
    const chipLabel = `#${opts.memberCount}`;
    let badgeFont = CHIP_FONT;
    ctx.font = `700 ${badgeFont}px -apple-system, "SF Pro Display", "Roboto", sans-serif`;
    let badgeChipW = ctx.measureText(chipLabel).width + ctx.measureText("MEMBERS").width + BADGE_MEASURE_PAD;
    const maxBadgeChipW = panelW - BADGE_MAX_WIDTH_PANEL_PAD - (cx + r + BADGE_MAX_WIDTH_AVATAR_GAP - panelX);
    while (badgeFont > CHIP_FONT_MIN && badgeChipW > maxBadgeChipW) {
      badgeFont -= 1;
      ctx.font = `700 ${badgeFont}px -apple-system, "SF Pro Display", "Roboto", sans-serif`;
      badgeChipW = ctx.measureText(chipLabel).width + ctx.measureText("MEMBERS").width + BADGE_MEASURE_PAD;
    }
    const chipW = Math.min(badgeChipW, maxBadgeChipW);
    const chipHgt = BADGE_CHIP_HEIGHT;
    const chipX = rightEdge - chipW;
    const chipY = BADGE_CHIP_Y;

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
    ctx.shadowBlur = BADGE_SHADOW_BLUR;
    ctx.shadowOffsetY = BADGE_SHADOW_OFFSET_Y;
    const cut = BADGE_CUT;
    ctx.beginPath();
    ctx.moveTo(chipX + cut, chipY);
    ctx.lineTo(chipX + chipW, chipY);
    ctx.lineTo(chipX + chipW, chipY + chipHgt - cut);
    ctx.lineTo(chipX + chipW - cut, chipY + chipHgt);
    ctx.lineTo(chipX, chipY + chipHgt);
    ctx.lineTo(chipX, chipY + cut);
    ctx.closePath();
    ctx.fillStyle = "rgba(255, 255, 255, 0.045)";
    ctx.fill();
    ctx.strokeStyle = rgba(color, 0.45);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(chipX + BADGE_DOT_OFFSET, chipY + chipHgt / 2, BADGE_DOT_R, 0, Math.PI * 2);
    ctx.fillStyle = rgba(color, 1);
    ctx.shadowColor = rgba(color, 0.9);
    ctx.shadowBlur = BADGE_DOT_SHADOW_BLUR;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.font = `600 ${BADGE_LABEL_FONT_SIZE}px -apple-system, "SF Pro Display", "Roboto", sans-serif`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("MEMBERS", chipX + BADGE_LABEL_OFFSET_X, chipY + chipHgt / 2 + BADGE_LABEL_OFFSET_Y);
    ctx.font = `700 ${badgeFont}px -apple-system, "SF Pro Display", "Roboto", sans-serif`;
    ctx.fillStyle = "#f5f6f8";
    ctx.fillText(chipLabel, chipX + BADGE_VALUE_OFFSET_X, chipY + chipHgt / 2 + BADGE_VALUE_OFFSET_Y);
    ctx.restore();
  }

  const bufferArr = await canvas.encode("png");
  return Buffer.from(bufferArr);
}
