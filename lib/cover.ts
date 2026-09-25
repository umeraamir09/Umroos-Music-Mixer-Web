import sharp from "sharp";
import { join } from "node:path";
import type { MixPlan } from "@/lib/types";

const COVER_FONT = join(process.cwd(), "assets/fonts/DejaVuSans-Bold.ttf");

function xml(value: string) {
  return value.replace(/[<>&'"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[char]!);
}

function hash(value: string) {
  return [...value].reduce((sum, char) => ((sum << 5) - sum + char.charCodeAt(0)) | 0, 0);
}

function palette(value: string) {
  const palettes = [
    ["#182229", "#A34C34", "#E0B68E"], ["#201B2E", "#654B7A", "#E8B89A"],
    ["#142923", "#3E6A55", "#D2A36D"], ["#252019", "#9D6E3C", "#E8D4AF"],
    ["#121821", "#304F72", "#E28A69"], ["#251922", "#7A3E55", "#D7A074"],
  ];
  return palettes[Math.abs(hash(value)) % palettes.length];
}

function wrapTitle(title: string) {
  const words = title.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (`${current} ${word}`.trim().length > 18 && current) { lines.push(current); current = word; }
    else current = `${current} ${word}`.trim();
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function fallbackArtwork(plan: MixPlan) {
  const [dark, mid, light] = palette(`${plan.name}${plan.genres.join("")}`);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <defs><radialGradient id="g" cx="72%" cy="18%"><stop stop-color="${light}"/><stop offset=".32" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></radialGradient><filter id="grain"><feTurbulence baseFrequency=".75" numOctaves="3" seed="4"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .12 0"/></filter></defs>
    <rect width="1024" height="1024" fill="url(#g)"/><circle cx="760" cy="245" r="115" fill="${light}" opacity=".76"/><path d="M0 730 Q210 510 420 720 T1024 590 V1024 H0Z" fill="${dark}" opacity=".72"/><path d="M0 800 Q270 650 520 790 T1024 700 V1024 H0Z" fill="#0c1115" opacity=".68"/><rect width="1024" height="1024" filter="url(#grain)" opacity=".32"/>
  </svg>`);
}

type CloudflareImageResponse = {
  result?: { image?: unknown };
  image?: unknown;
  errors?: unknown;
  messages?: unknown;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function cloudflareErrorDetails(body: string, token: string) {
  let detail = body.trim();
  try {
    const parsed = JSON.parse(body) as CloudflareImageResponse;
    const messages = [parsed.errors, parsed.messages]
      .flatMap((value) => Array.isArray(value) ? value : value == null ? [] : [value])
      .map((value) => {
        if (typeof value === "string") return value;
        if (value && typeof value === "object" && "message" in value) return String(value.message);
        return "";
      })
      .filter(Boolean);
    detail = messages.join("; ") || "Cloudflare returned an error response.";
  } catch {
    // Keep a short text detail for proxy and gateway error pages.
  }
  return detail.replaceAll(token, "[redacted]").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 400);
}

function decodeBase64Image(value: string) {
  const payload = value
    .replace(/^data:image\/[^,]*;base64,/i, "")
    .replace(/\s/g, "");
  if (!payload || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload) || payload.length % 4 === 1) {
    throw new Error("Cloudflare image response contained invalid Base64 data.");
  }

  const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
  const image = Buffer.from(padded, "base64");
  if (!image.length || image.toString("base64").replace(/=+$/, "") !== payload.replace(/=+$/, "")) {
    throw new Error("Cloudflare image response contained invalid Base64 data.");
  }
  return image;
}

async function cloudflareArtwork(plan: MixPlan) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) return fallbackArtwork(plan);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const gatewayId = process.env.CLOUDFLARE_AI_GATEWAY_ID;
  if (gatewayId) headers["cf-aig-gateway-id"] = gatewayId;

  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      prompt: `${plan.coverPrompt},
      square album cover composition,
      1:1 aspect ratio,
      centered composition,
      designed specifically as square cover artwork,
      clean composition,
      minimalist illustration,
      no text,
      no letters,
      no words,
      no watermark`,
      steps: 4,
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Cloudflare image API error (${response.status}): ${cloudflareErrorDetails(body, token)}`);
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new Error("Cloudflare image response was not valid JSON.");
  }
  const data = parsed && typeof parsed === "object" ? parsed as CloudflareImageResponse : {};

  const encodedImage = data.result?.image ?? data.image;
  if (typeof encodedImage !== "string" || !encodedImage.trim()) {
    throw new Error("Cloudflare image response did not include a Base64 image in result.image or image.");
  }

  const image = decodeBase64Image(encodedImage);
  try {
    const metadata = await sharp(image, { failOn: "error" }).metadata();
    if (!metadata.format || !metadata.width || !metadata.height) throw new Error("Image metadata is incomplete.");
  } catch (error) {
    throw new Error(`Cloudflare returned an unsupported or invalid image: ${errorMessage(error)}`);
  }
  return image;
}

const SPOTIFY_MAX_IMAGE_PAYLOAD = 256 * 1024;

async function renderJpeg(artwork: Buffer, overlay: Buffer) {
  // Spotify limits the Base64 request body to 256 KB. Try smaller quality
  // values at 1024px first so ordinary covers keep their full dimensions.
  for (const quality of [78, 72, 66, 60, 54, 48, 42, 36, 30]) {
    const jpeg = await sharp(artwork).resize(1024, 1024, { fit: "cover" })
      .composite([{ input: overlay }]).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (jpeg.toString("base64").length <= SPOTIFY_MAX_IMAGE_PAYLOAD) return jpeg;
  }

  // Only reduce dimensions for unusually detailed source images that remain
  // above Spotify's request limit at low JPEG quality.
  for (const size of [768, 640]) {
    for (const quality of [68, 58, 48]) {
      const jpeg = await sharp(artwork).resize(size, size, { fit: "cover" })
        .composite([{ input: await sharp(overlay).resize(size, size).toBuffer() }])
        .jpeg({ quality, mozjpeg: true }).toBuffer();
      if (jpeg.toString("base64").length <= SPOTIFY_MAX_IMAGE_PAYLOAD) return jpeg;
    }
  }
  throw new Error("Could not reduce playlist cover below Spotify's 256 KB image limit.");
}

async function coverText(value: string, size: number, maxWidth: number, color = "#fffaf3") {
  const rendered = await sharp({
    text: {
      text: `<span foreground="${color}">${xml(value)}</span>`,
      font: `DejaVu Sans Bold ${size}`,
      fontfile: COVER_FONT,
      rgba: true,
    },
  }).png().toBuffer();
  const { width } = await sharp(rendered).metadata();
  return width && width > maxWidth
    ? sharp(rendered).resize({ width: maxWidth }).png().toBuffer()
    : rendered;
}

async function coverOverlay(plan: MixPlan) {
  const lines = wrapTitle(plan.name);
  const startY = 680 - (lines.length - 1) * 66;
  const shade = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
    <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset=".18" stop-color="#000" stop-opacity=".04"/><stop offset="1" stop-color="#000" stop-opacity=".8"/></linearGradient></defs>
    <rect width="1024" height="1024" fill="url(#shade)"/>
  </svg>`);
  const titleImages = await Promise.all(lines.map((line) => coverText(line, 78, 888)));
  const watermark = await coverText("GENERATED BY UMROO'S MUSIC MIXER", 21, 880, "#c6c3be");
  const layers = await Promise.all([...titleImages, watermark].map(async (input) => ({
    input,
    height: (await sharp(input).metadata()).height || 0,
  })));
  return sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#00000000" } })
    .composite([
      { input: shade, left: 0, top: 0 },
      ...layers.slice(0, -1).map(({ input, height }, index) => ({ input, left: 68, top: startY + index * 90 - height })),
      { input: watermark, left: 72, top: 953 - layers.at(-1)!.height },
    ])
    .png().toBuffer();
}

export async function createCover(plan: MixPlan) {
  let artwork: Buffer;
  let usingCloudflare = Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN);
  try { artwork = await cloudflareArtwork(plan); } catch (error) {
    console.warn("Using local cover fallback:", errorMessage(error));
    artwork = fallbackArtwork(plan);
    usingCloudflare = false;
  }
  const overlay = await coverOverlay(plan);
  let jpeg: Buffer;
  try {
    jpeg = await renderJpeg(artwork, overlay);
  } catch (error) {
    console.error("Cover Sharp processing failed:", errorMessage(error));
    if (!usingCloudflare) throw error;
    try {
      jpeg = await renderJpeg(fallbackArtwork(plan), overlay);
    } catch (fallbackError) {
      console.error("Local fallback cover Sharp processing failed:", errorMessage(fallbackError));
      throw fallbackError;
    }
  }
  const base64 = jpeg.toString("base64");
  return { jpeg, dataUrl: `data:image/jpeg;base64,${base64}` };
}

export function coverBufferFromDataUrl(value?: string) {
  if (!value?.startsWith("data:image/jpeg;base64,")) return undefined;
  try { return decodeBase64Image(value); } catch { return undefined; }
}

export async function normalizeCustomCover(value: string) {
  if (!/^data:image\/(jpeg|png|webp);base64,/i.test(value)) throw new Error("Choose a JPEG, PNG, or WebP cover image.");
  let source: Buffer;
  try { source = decodeBase64Image(value); } catch { throw new Error("The cover image data is invalid."); }
  const metadata = await sharp(source, { limitInputPixels: 25_000_000 }).metadata();
  if (!metadata.width || !metadata.height) throw new Error("The cover image could not be read.");
  for (const quality of [82, 70, 58, 46, 36, 28, 20, 12]) {
    const jpeg = await sharp(source).resize(1024, 1024, { fit: "cover" })
      .flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (jpeg.toString("base64").length <= SPOTIFY_MAX_IMAGE_PAYLOAD) return jpeg;
  }
  throw new Error("This cover is too detailed for Spotify’s image limit. Try a simpler image or fewer effects.");
}
