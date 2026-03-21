import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import {
  resolveBinaryOutputPolicy,
  validateAtMostOneImageInput,
  validateSingleImageInput,
} from "../src/mcp/policy";

test("resolveBinaryOutputPolicy defaults outputDir to baseDir/generated-images", () => {
  const baseDir = path.join(path.sep, "Users", "example", ".config", "waypoi");
  const resolved = resolveBinaryOutputPolicy({}, { defaultBaseDir: baseDir });
  assert.equal(resolved.outputBaseRoot, baseDir);
  assert.equal(resolved.outputDir, path.join(baseDir, "generated-images"));
  assert.equal(resolved.includeData, false);
});

test("resolveBinaryOutputPolicy WAYPOI_MCP_OUTPUT_ROOT overrides baseDir", () => {
  const baseDir = path.join(path.sep, "Users", "example", ".config", "waypoi");
  const customRoot = path.join(path.sep, "Users", "example", "projects");
  const resolved = resolveBinaryOutputPolicy(
    {},
    { defaultBaseDir: baseDir, env: { WAYPOI_MCP_OUTPUT_ROOT: customRoot } }
  );
  assert.equal(resolved.outputBaseRoot, customRoot);
  assert.equal(resolved.outputDir, path.join(customRoot, "generated-images"));
});

test("resolveBinaryOutputPolicy WAYPOI_MCP_OUTPUT_SUBDIR narrows output path", () => {
  const baseDir = path.join(path.sep, "Users", "example", ".config", "waypoi");
  const resolved = resolveBinaryOutputPolicy(
    {},
    { defaultBaseDir: baseDir, env: { WAYPOI_MCP_OUTPUT_SUBDIR: "work" } }
  );
  assert.equal(resolved.outputBaseRoot, baseDir);
  assert.equal(resolved.outputDir, path.join(baseDir, "work"));
});

test("resolveBinaryOutputPolicy strict mode requires WAYPOI_MCP_OUTPUT_ROOT", () => {
  assert.throws(
    () =>
      resolveBinaryOutputPolicy(
        {},
        { env: { WAYPOI_MCP_STRICT_OUTPUT_ROOT: "true" } }
      ),
    /requires WAYPOI_MCP_OUTPUT_ROOT/
  );
});

test("resolveBinaryOutputPolicy strict mode rejects non-absolute WAYPOI_MCP_OUTPUT_ROOT", () => {
  assert.throws(
    () =>
      resolveBinaryOutputPolicy(
        {},
        {
          env: {
            WAYPOI_MCP_STRICT_OUTPUT_ROOT: "true",
            WAYPOI_MCP_OUTPUT_ROOT: "relative/path",
          },
        }
      ),
    /must be an absolute path/
  );
});

test("resolveBinaryOutputPolicy rejects absolute WAYPOI_MCP_OUTPUT_SUBDIR", () => {
  assert.throws(
    () =>
      resolveBinaryOutputPolicy(
        {},
        { env: { WAYPOI_MCP_OUTPUT_SUBDIR: path.sep + "absolute" } }
      ),
    /WAYPOI_MCP_OUTPUT_SUBDIR must be relative/
  );
});

test("resolveBinaryOutputPolicy defaults includeData to false", () => {
  const resolved = resolveBinaryOutputPolicy({});
  assert.equal(resolved.includeData, false);
});

test("resolveBinaryOutputPolicy respects include_data=true", () => {
  const resolved = resolveBinaryOutputPolicy({ include_data: true });
  assert.equal(resolved.includeData, true);
});

test("validateSingleImageInput enforces xor behavior", () => {
  assert.throws(() => validateSingleImageInput({}), /Exactly one image source/);
  assert.throws(
    () => validateSingleImageInput({ image_path: "/tmp/a.png", image_url: "https://example.com/a.png" }),
    /Exactly one image source/
  );
  assert.doesNotThrow(() => validateSingleImageInput({ image_path: "/tmp/a.png" }));
  assert.doesNotThrow(() => validateSingleImageInput({ image_url: "https://example.com/a.png" }));
});

test("validateAtMostOneImageInput allows none or one image source", () => {
  assert.doesNotThrow(() => validateAtMostOneImageInput({}));
  assert.doesNotThrow(() => validateAtMostOneImageInput({ image_path: "/tmp/a.png" }));
  assert.doesNotThrow(() => validateAtMostOneImageInput({ image_url: "https://example.com/a.png" }));
  assert.throws(
    () => validateAtMostOneImageInput({ image_path: "/tmp/a.png", image_url: "https://example.com/a.png" }),
    /Provide either image_path or image_url/
  );
});
