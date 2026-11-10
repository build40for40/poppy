import { DurableObject } from "cloudflare:workers";

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
