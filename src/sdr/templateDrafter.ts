import type { Drafter, DraftRequest, DrafterResult } from "./drafter.js";

export const TEMPLATE_NAME = "template-v1";

/** Deterministic, offline, no model. Always labeled so it can never be mistaken for an AI draft. */
export class TemplateDrafter implements Drafter {
  readonly name = "template";

  async draft(req: DraftRequest): Promise<DrafterResult> {
    const { firstName, companyName, facts } = req.context;
    const chosen = facts.slice(0, 2);
    const who = companyName ?? "your team";
    const body = [
      `Hi ${firstName},`,
      "",
      `I am reaching out because this may be relevant for ${who}.`,
      ...chosen.map((f) => f.text),
      "",
      "If that is on your radar, a quick reply with a good time to talk is all I need.",
    ].join("\n");
    return {
      ok: true,
      draft: { subject: `A quick idea for ${who}`, body, claimsUsed: chosen.map((f) => f.id), cta: "reply_question" },
      usage: { inputTokens: 0, outputTokens: 0 },
      model: TEMPLATE_NAME,
      drafter: this.name,
    };
  }
}
