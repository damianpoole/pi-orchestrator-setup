'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const source = path.resolve(__dirname, '..');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-setup-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'checkout');
  fs.mkdirSync(repo);
  for (const name of ['config', 'agents', 'install.sh', 'install-config.js', 'check-runtime.js']) {
    fs.cpSync(path.join(source, name), path.join(repo, name), { recursive: true });
  }
  const agent = path.join(root, 'agent with spaces');
  fs.mkdirSync(agent);
  const npmPackage = path.join(root, 'npm-pi');
  const binary = path.join(npmPackage, 'dist/cli.js');
  write(path.join(npmPackage, 'package.json'), { name: '@earendil-works/pi-coding-agent', version: read(path.join(repo, 'config/runtime.json')).piVersion });
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_PI_LOG, JSON.stringify(args)+'\\n');
if (process.env.TEST_PI_FAIL === '1') process.exit(7);
const file = path.join(process.env.PI_CODING_AGENT_DIR, 'settings.json');
const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
const identity = (e) => (typeof e === 'string' ? e : e.source).replace(/@[^@/]+$/, '');
settings.packages = settings.packages.filter(e => identity(e) !== identity(args[1]));
settings.packages.push(args[1]);
fs.writeFileSync(file, JSON.stringify(settings));
`);
  fs.chmodSync(binary, 0o755);
  const settings = path.join(agent, 'settings.json');
  const extension = path.join(agent, 'extensions/subagent/config.json');
  const log = path.join(root, 'calls.jsonl');
  const env = { ...process.env, PI_AGENT_DIR: agent, PI_BINARY: binary, TEST_PI_LOG: log };
  function run(args = [], overrides = {}) {
    return spawnSync('bash', [path.join(repo, 'install.sh'), ...args], { cwd: root, env: { ...env, ...overrides }, encoding: 'utf8' });
  }
  function ok(args, overrides) {
    const result = run(args, overrides);
    assert.equal(result.status, 0, result.stderr + result.stdout);
  }
  function editProfile(fn, filename = 'settings.json') {
    const file = path.join(repo, 'config', filename); const value = read(file); fn(value); write(file, value);
  }
  return { root, repo, agent, binary, npmPackage, settings, extension, log, run, ok, editProfile };
}

test('dry run, install, repeat, provider switch and uninstall preserve local state', t => {
  const f = fixture(t);
  const original = { theme: 'local', defaultModel: 'local-model', packages: ['npm:unrelated@1.0.0'], subagents: { local: true } };
  write(f.settings, original);
  write(f.extension, { globalConcurrencyLimit: 2, local: true });
  fs.writeFileSync(path.join(f.agent, 'AGENTS.md'), 'Local instructions.\n');
  fs.writeFileSync(path.join(f.agent, 'auth.json'), 'auth-canary');
  f.ok(['--dry-run']); assert.deepEqual(read(f.settings), original); assert.equal(fs.existsSync(f.log), false);
  f.ok(); const installed = read(f.settings);
  assert.equal(installed.subagents.globalConcurrencyLimit, undefined);
  assert.equal(read(f.extension).globalConcurrencyLimit, 4);
  assert.equal(read(f.extension).maxSubagentSpawnsPerRun, 16);
  assert.equal(fs.readdirSync(path.join(f.agent, 'agents/pi-orchestrator')).length, 4);
  f.ok(); assert.deepEqual(read(f.settings), installed);
  f.ok(['--provider', 'github-copilot']); assert.equal(read(f.settings).defaultProvider, 'github-copilot');
  assert.notEqual(f.run(['--uninstall', '--provider', 'openai-codex']).status, 0);
  f.ok(['--uninstall']); assert.deepEqual(read(f.settings), original);
  assert.deepEqual(read(f.extension), { globalConcurrencyLimit: 2, local: true });
  assert.equal(fs.readFileSync(path.join(f.agent, 'AGENTS.md'), 'utf8'), 'Local instructions.\n');
  assert.equal(fs.readFileSync(path.join(f.agent, 'auth.json'), 'utf8'), 'auth-canary');
});

test('new preferences and filtered packages deploy and removed declarations restore local values', t => {
  const f = fixture(t);
  const localPackage = { source: 'npm:extra@1.0.0', extensions: [] };
  write(f.settings, { theme: 'local', markdown: { mermaid: 'off', local: true }, packages: [localPackage] });
  const extra = { source: 'npm:extra@2.0.0', skills: ['selected'], extensions: [] };
  f.editProfile(p => { p.theme = 'shared'; p.markdown = { mermaid: 'streaming' }; p.packages.push(extra); });
  f.ok(); assert.equal(read(f.settings).theme, 'shared');
  assert.deepEqual(read(f.settings).markdown, { mermaid: 'streaming', local: true });
  assert.deepEqual(read(f.settings).packages.find(p => typeof p === 'object'), extra);
  const calls = fs.readFileSync(f.log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls, [['install', 'npm:pi-subagents@0.66.0', '--no-approve'], ['install', 'npm:@ff-labs/pi-fff@0.10.6', '--no-approve'], ['install', 'npm:extra@2.0.0', '--no-approve']]);
  f.editProfile(p => { delete p.theme; delete p.markdown; p.packages = p.packages.slice(0, 1); });
  f.ok(); assert.equal(read(f.settings).theme, 'local');
  assert.deepEqual(read(f.settings).markdown, { mermaid: 'off', local: true });
  assert.ok(read(f.settings).packages.some(p => JSON.stringify(p) === JSON.stringify(localPackage)));
  f.ok(['--uninstall']); assert.deepEqual(read(f.settings).packages, [localPackage]);
});

test('uninstall keeps edits made locally after install', t => {
  const f = fixture(t); f.ok();
  const settings = read(f.settings); settings.defaultModel = 'user-change'; settings.packages = ['npm:pi-subagents@9.9.9']; write(f.settings, settings);
  const extension = read(f.extension); extension.globalConcurrencyLimit = 3; write(f.extension, extension);
  f.ok(['--uninstall']); assert.equal(read(f.settings).defaultModel, 'user-change');
  assert.deepEqual(read(f.settings).packages, ['npm:pi-subagents@9.9.9']);
  assert.deepEqual(read(f.extension), { globalConcurrencyLimit: 3 });
});

test('version-one state migrates misplaced limits and retains original ownership', t => {
  const f = fixture(t);
  const managed = read(path.join(f.repo, 'config/settings.json'));
  Object.assign(managed.subagents, { maxSubagentDepth: 1, globalConcurrencyLimit: 4, maxSubagentSpawnsPerRun: 16 });
  managed.packages = ['npm:pi-subagents'];
  write(f.settings, managed);
  const previous = {};
  for (const key of ['defaultProvider', 'defaultModel', 'defaultThinkingLevel']) previous[key] = { present: false };
  previous.defaultModel = { present: true, value: 'original-model' };
  write(path.join(f.agent, '.pi-orchestrator-setup.json'), { version: 1, provider: 'openai-codex', managed, previous, previousContainers: {}, packageAdded: 1 });
  f.ok(); assert.equal(read(f.settings).subagents.globalConcurrencyLimit, undefined);
  assert.equal(read(f.extension).globalConcurrencyLimit, 4);
  assert.deepEqual(read(f.settings).packages, ['npm:pi-subagents@0.66.0', 'npm:@ff-labs/pi-fff@0.10.6']);
  f.ok(['--uninstall']); assert.deepEqual(read(f.settings), { defaultModel: 'original-model' });
});

test('wrong runtime and invalid shared packages fail before configuration writes', t => {
  const f = fixture(t);
  write(path.join(f.npmPackage, 'package.json'), { name: '@earendil-works/pi-coding-agent', version: '0.0.1' });
  assert.notEqual(f.run().status, 0); assert.equal(fs.existsSync(f.settings), false);
  write(path.join(f.npmPackage, 'package.json'), { name: '@earendil-works/pi-coding-agent', version: read(path.join(f.repo, 'config/runtime.json')).piVersion });
  f.editProfile(p => p.packages.push('npm:unversioned'));
  assert.notEqual(f.run().status, 0); assert.equal(fs.existsSync(f.settings), false); assert.equal(fs.existsSync(f.log), false);
});

test('package installation failure is recoverable by rerun', t => {
  const f = fixture(t); write(f.settings, { theme: 'local' });
  assert.notEqual(f.run([], { TEST_PI_FAIL: '1' }).status, 0);
  f.ok(); f.ok(['--uninstall']); assert.deepEqual(read(f.settings), { theme: 'local' });
});
