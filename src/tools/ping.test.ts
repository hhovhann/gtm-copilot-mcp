import { describe, expect, it } from "vitest";
import { ping, pingInputSchema } from "./ping.js";

describe("ping", () => {
  it("returns pong without a message", () => {
    expect(ping({})).toBe("pong");
  });

  it("echoes the message", () => {
    expect(ping({ message: "hi" })).toBe("pong: hi");
  });

  it("rejects messages over 200 characters", () => {
    const result = pingInputSchema.safeParse({ message: "x".repeat(201) });
    expect(result.success).toBe(false);
  });
});
