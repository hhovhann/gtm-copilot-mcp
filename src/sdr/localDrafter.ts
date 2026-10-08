import { z } from "zod";
import { draftFieldsSchema, DrafterUnavailableError, type Drafter, type DraftRequest, type DrafterResult } from "./drafter.js";

export interface LocalConfig {
  baseUrl: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  maxTokens: number;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function assertLoopback(baseUrl: string, allowRemote: boolean): void {
  const host = new URL(baseUrl).hostname;
  if (!allowRemote && !LOOPBACK_HOSTS.has(host)) {
    throw new DrafterUnavailableError(
      `Refusing to send lead data to ${host}: the local model URL must be loopback (127.0.0.1, localhost or ::1). Set SDR_ALLOW_REMOTE_LLM=1 only if you mean it.`,
    );
  }
}

const { $schema: _ignored, ...DRAFT_JSON_SCHEMA } = z.toJSONSchema(draftFieldsSchema) as Record<string, unknown>;
export { DRAFT_JSON_SCHEMA };

/** Remove a leading reasoning block (<think>...</think>) and markdown code fences some models add. */
export function cleanModelText(content: string): string {
  return content
    .replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

interface ChatResponse {
  model?: string;
  choices?: { message?: { content?: unknown }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Talks to LM Studio's OpenAI-compatible endpoint. The server's schema enforcement is never trusted. */
export class LocalDrafter implements Drafter {
  readonly name = "local";

  constructor(
    private readonly cfg: LocalConfig,
    private readonly opts: { fetch?: typeof fetch; allowRemote?: boolean } = {},
  ) {
    assertLoopback(cfg.baseUrl, opts.allowRemote ?? false);
  }

  async draft(req: DraftRequest): Promise<DrafterResult> {
    const { baseUrl, model, temperature, timeoutMs, maxTokens } = this.cfg;
    const doFetch = this.opts.fetch ?? fetch;

    let res: Response;
    try {
      res = await doFetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model,
          temperature,
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: req.prompt.system },
            { role: "user", content: req.prompt.user },
          ],
          response_format: { type: "json_schema", json_schema: { name: "draft", strict: true, schema: DRAFT_JSON_SCHEMA } },
        }),
      });
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new DrafterUnavailableError(`LM Studio at ${baseUrl} did not answer within ${Math.round(timeoutMs / 1000)}s (a model may still be loading).`);
      }
      throw new DrafterUnavailableError(`Could not reach LM Studio at ${baseUrl}. Start its server (lms server start) and make sure a chat model is available.`);
    }

    if (!res.ok) {
      const text = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
      throw new DrafterUnavailableError(`LM Studio at ${baseUrl} returned HTTP ${res.status}${text ? `: ${text}` : ""}`);
    }

    const data = (await res.json().catch(() => null)) as ChatResponse | null;
    const usage = { inputTokens: data?.usage?.prompt_tokens ?? 0, outputTokens: data?.usage?.completion_tokens ?? 0 };
    const used = data?.model ?? model;
    const fail = (code: "output_truncated" | "invalid_model_output"): DrafterResult => ({ ok: false, code, usage, model: used, drafter: this.name });

    const choice = data?.choices?.[0];
    if (choice?.finish_reason === "length") return fail("output_truncated");
    const content = choice?.message?.content;
    if (typeof content !== "string" || !content.trim()) return fail("invalid_model_output");

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleanModelText(content));
    } catch {
      return fail("invalid_model_output");
    }
    const checked = draftFieldsSchema.safeParse(parsed);
    return checked.success ? { ok: true, draft: checked.data, usage, model: used, drafter: this.name } : fail("invalid_model_output");
  }
}
