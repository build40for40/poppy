import { Resvg } from "@cf-wasm/resvg";
import { STARTER_PICTURES } from "./starter-pictures";

/**
 * The pictures that go on top of a suggestion. Every picture is the same flat house style: one of three scenes (a room, a
 * garden, or the floor seen from above) with simple shapes on top, no people and no words. WhatsApp only shows JPEG or PNG,
 * so the SVG is drawn into a PNG when someone (Twilio or Meta) fetches it.
 */
export type Scene = "indoor" | "outdoor" | "floor";
export const SCENES: Scene[] = ["indoor", "outdoor", "floor"];

export const PICTURE_WIDTH = 600;
export const PICTURE_HEIGHT = 340;
/** Rendered at twice the drawing's size, so it stays sharp on a phone. */
const PNG_WIDTH = 1200;
const MAX_BODY_CHARS = 16_000;

export interface PictureEntry {
  id: string;
  about: string;
}

export interface Picture extends PictureEntry {
  scene: Scene;
  body: string;
}

const BACKDROPS: Record<Scene, string> = {
  indoor: '<rect width="600" height="340" fill="#E6F1FB"/><rect y="250" width="600" height="90" fill="#FAEEDA"/><rect y="244" width="600" height="8" fill="#D3D1C7"/>',
  outdoor: '<rect width="600" height="340" fill="#E6F1FB"/><circle cx="540" cy="52" r="28" fill="#FAC775"/><rect y="240" width="600" height="100" fill="#C0DD97"/>',
  floor: `<rect width="600" height="340" fill="#FAEEDA"/>${[68, 136, 204, 272].map((y) => `<rect y="${y}" width="600" height="3" fill="#FAC775" opacity="0.35"/>`).join("")}`,
};

/** The whole drawing: the scene's backdrop, then the shapes. */
export function toSvg({ scene, body }: Pick<Picture, "scene" | "body">): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PICTURE_WIDTH} ${PICTURE_HEIGHT}" width="${PICTURE_WIDTH}" height="${PICTURE_HEIGHT}">${BACKDROPS[scene]}${body}</svg>`;
}

export async function renderPng(picture: Pick<Picture, "scene" | "body">): Promise<Uint8Array> {
  const resvg = await Resvg.async(toSvg(picture), { fitTo: { mode: "width", value: PNG_WIDTH } });
  return resvg.render().asPng();
}

export function starterPicture(id: string): Picture | undefined {
  return STARTER_PICTURES.find((p) => p.id === id);
}

/** Picture ids are part of a URL and a play note: lower-case words joined by hyphens. */
export const PICTURE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_PICTURE_ID = 48;

/** Turns a name into an id: "Dino swamp!" becomes "dino-swamp". */
export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_PICTURE_ID)
    .replace(/-+$/, "");
}

const ELEMENTS = new Set(["g", "rect", "circle", "ellipse", "path", "polygon", "polyline", "line"]);
const ATTRIBUTES = new Set([
  "x", "y", "width", "height", "rx", "ry", "cx", "cy", "r", "d", "points", "x1", "y1", "x2", "y2",
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "opacity", "fill-opacity", "stroke-opacity", "transform",
]);

/**
 * Checks the shapes Claude drew for a new picture. Only plain shapes with plain attributes get through: no text, images,
 * links, styles, scripts or references to anything else, so a picture can only ever be shapes and colours. Returns the
 * body, or what was wrong with it.
 */
export function checkBody(body: string): { body: string } | { error: string } {
  const trimmed = body.trim();
  if (!trimmed) return { error: "The drawing is empty." };
  if (trimmed.length > MAX_BODY_CHARS) return { error: `The drawing is longer than ${MAX_BODY_CHARS} characters.` };
  if (/[&]|<!|<\?|url\s*\(/i.test(trimmed)) return { error: "The drawing has entities, declarations or url() in it." };
  const tags = trimmed.match(/<[^>]*>/g) ?? [];
  if (!tags.length) return { error: "The drawing has no shapes." };
  if (trimmed.replace(/<[^>]*>/g, "").trim()) return { error: "The drawing has text outside its tags." };
  for (const tag of tags) {
    const open = tag.match(/^<\s*([a-z]+)((?:\s+[a-z][a-z0-9-]*\s*=\s*"[^"<>]*")*)\s*\/?\s*>$/i);
    const close = tag.match(/^<\/\s*([a-z]+)\s*>$/i);
    const name = (open?.[1] ?? close?.[1])?.toLowerCase();
    if (!name || !ELEMENTS.has(name)) return { error: `The drawing uses something other than plain shapes: ${tag.slice(0, 40)}` };
    for (const [, attribute] of (open?.[2] ?? "").matchAll(/([a-z][a-z0-9-]*)\s*=\s*"/gi)) {
      if (!ATTRIBUTES.has(attribute.toLowerCase())) return { error: `The drawing uses an attribute that isn't allowed: ${attribute}` };
    }
  }
  return { body: trimmed };
}
