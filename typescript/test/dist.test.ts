import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const built = existsSync(new URL("../dist/index.cjs", import.meta.url));

describe.skipIf(!built)("built package (dist)", () => {
  it("loads as CommonJS", () => {
    const require = createRequire(import.meta.url);
    const mod = require("../dist/index.cjs");
    const c = new mod.Lilambd({ fetch: async () => new Response("{}") });
    expect(typeof c.airports.getByCode).toBe("function");
    expect(mod.ROUTES.length).toBe(170);
  });
  it("loads as ESM", async () => {
    const mod = await import("../dist/index.js");
    expect(typeof mod.Lilambd).toBe("function");
    expect(typeof mod.PaymentRequiredError).toBe("function");
  });
});
