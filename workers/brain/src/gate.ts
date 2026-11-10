import { DurableObject } from "cloudflare:workers";

// These live here and not in index.ts: the Workers runtime only lets the entry module export handlers and classes.
export const WEB_MAX_CHARS = 500;
/** Messages one visitor's demo chat may send before it's told to find Poppy on WhatsApp. */
export const WEB_MAX_MESSAGES = 10;
/** Messages the demo chat takes in a day, across every visitor. */
export const WEB_DAILY_MAX = 500;

/**
 * Counts the messages the landing page's demo chat has taken today, across every visitor. The page is public and every
 * reply spends Claude tokens, so there's a ceiling per day. One object, shared by everyone.
 */
export class WebGate extends DurableObject<Env> {
  /** Takes one message from today's allowance. False when today's is used up. */
  async take(day: string, max: number): Promise<boolean> {
    const today = (await this.ctx.storage.get<{ day: string; used: number }>("today")) ?? { day, used: 0 };
    const used = today.day === day ? today.used : 0;
    if (used >= max) return false;
    await this.ctx.storage.put("today", { day, used: used + 1 });
    return true;
  }
}

export const gateOf = (env: Env) => env.WEB_GATE.get(env.WEB_GATE.idFromName("web")) as unknown as { take(day: string, max: number): Promise<boolean> };
