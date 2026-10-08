import { z } from "zod";

export const pingInputSchema = z.object({
  message: z.string().max(200).optional(),
});

export type PingInput = z.infer<typeof pingInputSchema>;

export function ping(input: PingInput): string {
  return input.message ? `pong: ${input.message}` : "pong";
}
