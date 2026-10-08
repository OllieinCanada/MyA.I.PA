const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveRunCommand, run, npmCommand } = require("../scripts/_helpers");

test("Windows npm invocations use Node and the CLI without shell argument interpolation", () => {
  const args = ["run", "build", "--", "a & b", "$value"];
  const result = resolveRunCommand("npm.cmd", args, { platform: "win32", nodePath: "node-test", npmCli: __filename });
  assert.equal(result.command, "node-test");
  assert.deepEqual(result.args, [__filename, ...args]);
  assert.deepEqual(resolveRunCommand("npm", args, { platform: "linux" }), { command: "npm", args });
  assert.deepEqual(resolveRunCommand("git", args, { platform: "win32" }), { command: "git", args });
});

test("run preserves literal arguments and supports the installed npm CLI", () => {
  const result = run(process.execPath, ["-e", "process.stdout.write(process.argv[1])", "a & b $value"], { capture: true });
  assert.equal(result.stdout, "a & b $value");
  const version = run(npmCommand(), ["--version"], { capture: true });
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);
});
