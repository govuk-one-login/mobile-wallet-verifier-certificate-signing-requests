import { describe, it, expect, vi } from "vitest";
import { handler } from "./handler";

describe("csr-validator handler", () => {
  it("logs the event and returns void", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const event = { key: "value" };

    await handler(event);

    expect(consoleSpy).toHaveBeenCalledWith(
      "CSR validator invoked test",
      JSON.stringify(event)
    );
  });
});
