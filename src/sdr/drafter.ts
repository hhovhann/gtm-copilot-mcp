import { z } from "zod";
import type { Queue } from "../leads/config.js";
import { ToolError } from "../tools/errors.js";
import type { Fact } from "./config.js";

export const CTAS = ["book_call", "reply_question", "share_resource"] as const;

/** Loose shape check only. Length and content rules belong to the guardrails, so bad drafts are stored and explained. */
export const draftFieldsSchema = z.object({
  subject: z.string(),
  body: z.string(),
  claimsUsed: z.array(z.string()),
  cta: z.enum(CTAS),
});
export type DraftFields = z.infer<typeof draftFieldsSchema>;

export interface DraftRequest {
  prompt: { system: string; user: string };
  /** Structured context for drafters that do not read the prompt (the template drafter). */
  context: { firstName: string; companyName?: string; queue: Queue; facts: Fact[] };
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export type DrafterFailureCode = "model_refusal" | "output_truncated" | "invalid_model_output";

export type DrafterResult =
  | { ok: true; draft: DraftFields; usage: Usage; model: string; drafter: string }
  | { ok: false; code: DrafterFailureCode; usage: Usage; model: string; drafter: string };

export interface Drafter {
  readonly name: string;
  draft(req: DraftRequest): Promise<DrafterResult>;
}

/** The model could not be reached or answered with an error. Nothing is stored; the tool reports it. */
export class DrafterUnavailableError extends ToolError {}
