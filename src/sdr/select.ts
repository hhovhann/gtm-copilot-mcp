import type { SdrConfig } from "./config.js";
import { DrafterUnavailableError, type Drafter } from "./drafter.js";
import { LocalDrafter } from "./localDrafter.js";
import { TemplateDrafter } from "./templateDrafter.js";

/** Picks the drafter from SDR_DRAFTER. Never falls back silently to a different one. */
export function createDrafter(config: SdrConfig, env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch): Drafter {
  const choice = (env["SDR_DRAFTER"] || "local").toLowerCase();
  switch (choice) {
    case "local":
      return new LocalDrafter(
        { ...config.local, baseUrl: env["SDR_LOCAL_BASE_URL"] || config.local.baseUrl, model: env["SDR_LOCAL_MODEL"] || config.local.model },
        { fetch: fetchImpl, allowRemote: env["SDR_ALLOW_REMOTE_LLM"] === "1" },
      );
    case "template":
      return new TemplateDrafter();
    case "anthropic":
      throw new DrafterUnavailableError("SDR_DRAFTER=anthropic is reserved for Phase 5c and is not built yet. Use 'local' or 'template'.");
    default:
      throw new DrafterUnavailableError(`Unknown SDR_DRAFTER '${choice}'. Use 'local' or 'template'.`);
  }
}
