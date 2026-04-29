import test from "node:test";
import assert from "node:assert/strict";
import { getProviderCatalogEntry, matchCatalogModel } from "../src/providers/registry";

test("provider catalog preset exposes provider payload fields without importing models", async () => {
  const entry = await getProviderCatalogEntry("github-models", { source: "free" });
  assert.ok(entry);
  assert.equal(entry.preset.id, "openrouter");
  assert.equal(entry.preset.protocol, "openai");
  assert.equal(entry.preset.supportsRouting, true);
  assert.match(entry.preset.baseUrl, /openrouter/i);
  assert.equal(entry.modelSummary.total > 0, true);
});

test("provider catalog model matching supports both public id and upstream id", async () => {
  const entry = await getProviderCatalogEntry("openrouter", { source: "free" });
  assert.ok(entry);

  const byId = matchCatalogModel(entry, "gpt-4.1");
  assert.ok(byId);
  assert.equal(byId.free, true);

  const byUpstream = matchCatalogModel(entry, "openai/gpt-4.1");
  assert.ok(byUpstream);
  assert.equal(byUpstream.id, "gpt-4.1");
  assert.equal(typeof byUpstream.benchmark?.livebench, "number");
});

test("cloudflare catalog preset resolves the native base URL and keeps only chat-capable models", async () => {
  const previous = process.env.CLOUDFLARE_AI_ACCOUNT_ID;
  process.env.CLOUDFLARE_AI_ACCOUNT_ID = "account-test-123";

  try {
    const entry = await getProviderCatalogEntry("cloudflare", { source: "free" });
    assert.ok(entry);
    assert.equal(entry.readiness, "ready");
    assert.equal(entry.preset.protocol, "cloudflare");
    assert.equal(
      entry.preset.baseUrl,
      "https://api.cloudflare.com/client/v4/accounts/account-test-123/ai/v1"
    );
    assert.ok(entry.modelSummary.total > 0);
    assert.ok(
      entry.models.every((model) => {
        const output = model.capabilities?.output ?? [];
        return output.includes("text") && !output.includes("embedding");
      })
    );
  } finally {
    if (previous === undefined) {
      delete process.env.CLOUDFLARE_AI_ACCOUNT_ID;
    } else {
      process.env.CLOUDFLARE_AI_ACCOUNT_ID = previous;
    }
  }
});

test("ollama catalog preset is ready as a native protocol and keeps chat-capable models", async () => {
  const entry = await getProviderCatalogEntry("ollama-cloud", { source: "free" });
  assert.ok(entry);
  assert.equal(entry.readiness, "ready");
  assert.equal(entry.preset.protocol, "ollama");
  assert.equal(entry.preset.baseUrl, "https://ollama.com/api");
  assert.ok(entry.modelSummary.total > 0);
  assert.ok(
    entry.models.every((model) => {
      const output = model.capabilities?.output ?? [];
      return output.includes("text") && !output.includes("embedding");
    })
  );
});

test("gemini catalog preset is ready as a native protocol and keeps chat-capable models", async () => {
  const entry = await getProviderCatalogEntry("gemini", { source: "free" });
  assert.ok(entry);
  assert.equal(entry.readiness, "ready");
  assert.equal(entry.preset.protocol, "gemini");
  assert.equal(entry.preset.baseUrl, "https://generativelanguage.googleapis.com/v1beta");
  assert.ok(entry.modelSummary.total > 0);
  assert.ok(
    entry.models.some((model) => {
      const input = model.capabilities?.input ?? [];
      const output = model.capabilities?.output ?? [];
      return input.includes("image") && output.includes("text");
    })
  );
});
