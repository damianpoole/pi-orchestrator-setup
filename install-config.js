'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PACKAGE = 'npm:pi-subagents';
const PROVIDERS = ['openai-codex', 'github-copilot'];
const MANAGED_PATHS = [
  ['defaultProvider'],
  ['defaultModel'],
  ['defaultThinkingLevel'],
  ['subagents', 'agentOverrides', 'easy'],
  ['subagents', 'agentOverrides', 'medium'],
  ['subagents', 'agentOverrides', 'hard'],
  ['subagents', 'agentOverrides', 'very-hard'],
  ['subagents', 'modelScope'],
  ['subagents', 'maxSubagentDepth'],
  ['subagents', 'globalConcurrencyLimit'],
  ['subagents', 'maxSubagentSpawnsPerRun'],
];
const CONTAINER_PATHS = [
  ['subagents'],
  ['subagents', 'agentOverrides'],
];
const AGENTS_FILE = 'AGENTS.md';
const INSTALL_DIR = path.join('agents', 'pi-orchestrator');
const MARKER_START = '<!-- pi-orchestrator-setup:start -->';
const MARKER_END = '<!-- pi-orchestrator-setup:end -->';

function usage() {
  return [
    'Usage: node install-config.js --agent-dir DIR --config-dir DIR (--plan|--apply) [--provider PROVIDER] [--uninstall]',
    '',
    `Providers: ${PROVIDERS.join(', ')}`,
  ].join('\n');
}

function fail(message, code = 1) {
  process.exitCode = code;
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function same(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray || bIsArray) {
    return aIsArray && bIsArray
      && a.length === b.length
      && a.every((value, index) => same(value, b[index]));
  }
  if (typeof a === 'object') {
    if (!isRecord(a) || !isRecord(b)) return false;
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    return aKeys.length === bKeys.length
      && aKeys.every((key, index) => key === bKeys[index] && same(a[key], b[key]));
  }
  return false;
}

function readJson(file, label, { optional = true } = {}) {
  if (!fs.existsSync(file)) {
    if (optional) return { exists: false, value: {} };
    fail(`${label} does not exist: ${file}`);
  }
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return { exists: true, value: {} };
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    fail(`could not parse ${label} ${file}: ${error.message}`);
  }
  if (!isRecord(value)) fail(`${label} must contain a JSON object: ${file}`);
  return { exists: true, value };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, file);
  } catch (error) {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch {
      // Keep the original error useful if cleanup itself fails.
    }
    fail(`could not write ${file}: ${error.message}`);
  }
}

function getEntry(root, segments) {
  let parent = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (!isRecord(parent) || !Object.hasOwn(parent, segments[index])) {
      return { present: false };
    }
    parent = parent[segments[index]];
  }
  const key = segments[segments.length - 1];
  if (!isRecord(parent) || !Object.hasOwn(parent, key)) return { present: false };
  return { present: true, value: clone(parent[key]) };
}

function setPath(root, segments, value) {
  let parent = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index];
    if (!Object.hasOwn(parent, key) || !isRecord(parent[key])) parent[key] = {};
    parent = parent[key];
  }
  parent[segments[segments.length - 1]] = clone(value);
}

function deletePath(root, segments) {
  let parent = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (!isRecord(parent) || !Object.hasOwn(parent, segments[index])) return;
    parent = parent[segments[index]];
  }
  if (isRecord(parent)) delete parent[segments[segments.length - 1]];
}

function pathKey(segments) {
  return segments.join('.');
}

function validProvider(provider) {
  return PROVIDERS.includes(provider);
}

function parseArgs(argv) {
  let agentDir;
  let configDir;
  let provider;
  let mode;
  let uninstall = false;
  let quiet = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--agent-dir' || arg === '--config-dir' || arg === '--provider') {
      if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
        fail(`${arg} requires a value`, 2);
      }
      const value = argv[index + 1];
      if (arg === '--agent-dir') agentDir = value;
      if (arg === '--config-dir') configDir = value;
      if (arg === '--provider') provider = value;
      index += 1;
    } else if (arg.startsWith('--provider=')) {
      provider = arg.slice('--provider='.length);
      if (!provider) fail('--provider requires a value', 2);
    } else if (['--plan', '--apply', '--package-sources', '--restore-package-filters'].includes(arg)) {
      if (mode && mode !== arg.slice(2)) fail('choose exactly one of --plan or --apply', 2);
      mode = arg.slice(2);
    } else if (arg === '--uninstall') {
      uninstall = true;
    } else if (arg === '--quiet') {
      quiet = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      fail(`unknown option: ${arg}\n${usage()}`, 2);
    }
  }

  if (!agentDir || !configDir) fail(`--agent-dir and --config-dir are required\n${usage()}`, 2);
  if (!mode) fail(`one of --plan or --apply is required\n${usage()}`, 2);
  if (provider !== undefined && !validProvider(provider)) {
    fail(`invalid provider "${provider}" (choose ${PROVIDERS.join(' or ')})`, 2);
  }
  if (!uninstall && provider === undefined) provider = 'openai-codex';
  return { agentDir, configDir, provider, mode, uninstall, quiet };
}

function profilePath(configDir, provider) {
  return path.join(configDir, provider === 'openai-codex' ? 'settings.json' : 'settings.github-copilot.json');
}

function loadProfiles(configDir) {
  const profiles = {};
  for (const provider of PROVIDERS) {
    const loaded = readJson(profilePath(configDir, provider), `${provider} profile`, { optional: false });
    const profile = loaded.value;
    if (profile.defaultProvider !== provider) {
      fail(`${profilePath(configDir, provider)} has defaultProvider ${JSON.stringify(profile.defaultProvider)}, expected ${provider}`);
    }
    for (const segments of MANAGED_PATHS.slice(0, -3)) {
      if (!getEntry(profile, segments).present) {
        fail(`${profilePath(configDir, provider)} is missing ${pathKey(segments)}`);
      }
    }
    if (!isRecord(profile.subagents) || !Array.isArray(profile.subagents.modelScope.allow)) {
      fail(`${profilePath(configDir, provider)} has an invalid model scope`);
    }
    validateProfile(profile);
    profiles[provider] = profile;
  }
  return profiles;
}

function loadState(statePath) {
  const loaded = readJson(statePath, 'installer state');
  if (!loaded.exists) return null;
  const state = loaded.value;
  if (state.version === 2) {
    if (!validProvider(state.provider) || !isRecord(state.documents) || !isRecord(state.packages)) fail('invalid version 2 installer state');
    return state;
  }
  if (state.version !== 1 || !validProvider(state.provider) || !isRecord(state.managed)
      || !isRecord(state.previous) || !isRecord(state.previousContainers)) {
    fail(`installer state is invalid; remove or repair ${statePath}`);
  }
  if (!Number.isInteger(state.packageAdded) || state.packageAdded < 0) {
    fail(`installer state has an invalid package count: ${statePath}`);
  }
  return state;
}

function hasLegacyInstallMarker(agentDir) {
  const agentsFile = path.join(agentDir, AGENTS_FILE);
  if (fs.existsSync(agentsFile)) {
    const text = fs.readFileSync(agentsFile, 'utf8');
    if (text.includes(MARKER_START) && text.includes(MARKER_END)) return true;
  }

  const installDir = path.join(agentDir, INSTALL_DIR);
  if (!fs.existsSync(installDir) || !fs.statSync(installDir).isDirectory()) return false;
  return fs.readdirSync(installDir).some((entry) => entry.endsWith('.md'));
}

function detectProvider(settings, profiles, agentDir) {
  if (!hasLegacyInstallMarker(agentDir)) return undefined;

  const defaultProvider = getEntry(settings, ['defaultProvider']);
  if (defaultProvider.present && validProvider(defaultProvider.value)) return defaultProvider.value;

  const scores = {};
  for (const provider of PROVIDERS) {
    let score = 0;
    for (const segments of MANAGED_PATHS) {
      const current = getEntry(settings, segments);
      const expected = getEntry(profiles[provider], segments);
      if (current.present && expected.present && same(current.value, expected.value)) score += 1;
    }
    scores[provider] = score;
  }
  const best = PROVIDERS.filter((provider) => scores[provider] > 0)
    .sort((a, b) => scores[b] - scores[a]);
  if (best.length > 0 && (best.length === 1 || scores[best[0]] > scores[best[1]])) return best[0];
  return undefined;
}

function assertSettingsShape(settings) {
  for (const segments of [['subagents'], ['subagents', 'agentOverrides']]) {
    const entry = getEntry(settings, segments);
    if (entry.present && entry.value !== null && !isRecord(entry.value)) {
      fail(`settings.json has a non-object ${pathKey(segments)}; refusing to replace it`);
    }
  }
  const packages = getEntry(settings, ['packages']);
  if (packages.present && !Array.isArray(packages.value)) {
    fail('settings.json has non-array packages; refusing to replace it');
  }
}

function removePackageOccurrences(packages, count) {
  let remaining = count;
  for (let index = packages.length - 1; index >= 0 && remaining > 0; index -= 1) {
    if (packages[index] === PACKAGE) {
      packages.splice(index, 1);
      remaining -= 1;
    }
  }
}

function restoreContainers(settings, previousContainers) {
  for (const segments of [...CONTAINER_PATHS].reverse()) {
    const key = pathKey(segments);
    const previous = previousContainers[key] || { present: false };
    const current = getEntry(settings, segments);
    if (!current.present || !isRecord(current.value) || Object.keys(current.value).length !== 0) continue;
    if (previous.present) setPath(settings, segments, previous.value);
    else deletePath(settings, segments);
  }
}

function uninstallTarget(options, profiles, settings, state) {
  if (state) return options.provider || state.provider;
  if (!hasLegacyInstallMarker(options.agentDir)) return undefined;
  return options.provider || detectProvider(settings.value, profiles, options.agentDir);
}

function profileSummary(provider, profile) {
  const overrides = profile.subagents.agentOverrides;
  return [
    `Provider: ${provider}`,
    `Default model: ${provider}/${profile.defaultModel}`,
    `Default thinking: ${profile.defaultThinkingLevel}`,
    'Role models:',
    ...Object.keys(overrides).map((role) => `  ${role}: ${overrides[role].model}:${overrides[role].thinking}`),
    `Allowed models: ${profile.subagents.modelScope.allow.join(', ')}`,
  ];
}

function plan(options, profiles, settings, state) {
  const { provider, uninstall } = options;
  const target = uninstall
    ? uninstallTarget(options, profiles, settings, state)
    : options.provider;
  console.log(`Settings: ${path.join(options.agentDir, 'settings.json')}`);
  if (uninstall) {
    if (state && provider && state.provider !== provider) {
      fail(`provider ${provider} is not active (active provider is ${state.provider}); rerun uninstall without --provider or select ${state.provider}`);
    }
    if (target) {
      console.log(`Uninstall profile: ${target}`);
      console.log('Actions: remove this setup\'s settings, agents, package entry, and managed AGENTS.md block');
    } else {
      console.log('Uninstall profile: none detected (only setup-owned files/markers will be removed)');
    }
    return target;
  }
  console.log(profileSummary(provider, profiles[provider]).join('\n'));
  console.log(`Packages: ${profiles[provider].packages.map(packageSource).join(', ')}`);
  console.log('Extension config: ' + path.join(options.agentDir, 'extensions/subagent/config.json'));
  console.log('Actions: install pinned packages, merge shared settings and extension config, install agents and managed AGENTS.md block');
  return provider;
}

// Profiles own declared leaf values; arrays are replaced as a unit. Track the
// previous values so removed declarations and uninstall can restore local state.
function assertSafeKeys(value) {
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) fail(`unsupported configuration key: ${key}`);
    assertSafeKeys(child);
  }
}

function packageSource(entry) {
  return typeof entry === 'string' ? entry : entry?.source;
}

function packageIdentity(entry) {
  const source = packageSource(entry);
  if (typeof source !== 'string') return undefined;
  const npm = /^(?:npm:)?(@[^/]+\/[^@]+|[^@/:]+)(?:@.*)?$/.exec(source);
  return npm ? `npm:${npm[1]}` : source;
}

function validateProfile(profile) {
  assertSafeKeys(profile);
  if (!Array.isArray(profile.packages)) fail('profile packages must be an array');
  const seen = new Set();
  for (const entry of profile.packages) {
    const source = packageSource(entry);
    if (typeof source !== 'string' || !/^npm:(?:@[^/\s]+\/)?[^@/\s]+@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(source)) {
      fail('shared packages require exact npm versions (npm:name@1.2.3); unpinned, git and local sources are not supported');
    }
    const identity = packageIdentity(entry);
    if (seen.has(identity)) fail(`duplicate shared package: ${identity}`);
    seen.add(identity);
  }
}

function restoreDocument(value, state) {
  if (!state) return;
  for (const record of [...state.records].reverse()) {
    if (!same(getEntry(value, record.path), record.after)) continue;
    if (record.before.present) setPath(value, record.path, record.before.value);
    else deletePath(value, record.path);
  }
  for (const record of [...state.containers].reverse()) {
    const current = getEntry(value, record.path);
    if (current.present && isRecord(current.value) && Object.keys(current.value).length === 0) {
      if (record.before.present) setPath(value, record.path, record.before.value);
      else deletePath(value, record.path);
    }
  }
}

function mergeDocument(value, desired) {
  const state = { records: [], containers: [] };
  function visit(object, prefix = []) {
    for (const [key, child] of Object.entries(object)) {
      const segments = [...prefix, key];
      const before = getEntry(value, segments);
      if (isRecord(child) && Object.keys(child).length > 0) {
        if (before.present && !isRecord(before.value)) fail(`cannot merge object into non-object ${segments.join('.')}`);
        state.containers.push({ path: segments, before });
        visit(child, segments);
      } else {
        setPath(value, segments, child);
        state.records.push({ path: segments, before, after: getEntry(value, segments) });
      }
    }
  }
  visit(desired);
  return state;
}

function restorePackages(settings, state) {
  if (!state) return;
  const current = settings.packages || [];
  for (const record of state.records) {
    const matches = current.filter((entry) => packageIdentity(entry) === record.identity);
    if (!same(matches, record.after)) continue;
    const index = current.findIndex((entry) => packageIdentity(entry) === record.identity);
    for (let i = current.length - 1; i >= 0; i--) {
      if (packageIdentity(current[i]) === record.identity) current.splice(i, 1);
    }
    current.splice(index < 0 ? current.length : index, 0, ...clone(record.before));
  }
  if (current.length || state.present) settings.packages = current;
  else delete settings.packages;
}

function mergePackages(settings, desired) {
  const state = { present: Object.hasOwn(settings, 'packages'), records: [] };
  const current = settings.packages || [];
  for (const entry of desired) {
    const identity = packageIdentity(entry);
    const before = current.filter((item) => packageIdentity(item) === identity);
    const index = current.findIndex((item) => packageIdentity(item) === identity);
    for (let i = current.length - 1; i >= 0; i--) {
      if (packageIdentity(current[i]) === identity) current.splice(i, 1);
    }
    current.splice(index < 0 ? current.length : index, 0, clone(entry));
    state.records.push({ identity, before: clone(before), after: [clone(entry)] });
  }
  if (current.length || state.present) settings.packages = current;
  return state;
}

function migrateLegacy(settings, state, profiles, activeProvider) {
  if (!state && !activeProvider) return;
  const expected = state?.managed || profiles[activeProvider];
  for (const segments of MANAGED_PATHS) {
    const current = getEntry(settings, segments);
    const managed = getEntry(expected, segments);
    // Old profiles stored execution limits in settings instead of extension config.
    const oldLimit = { maxSubagentDepth: 1, globalConcurrencyLimit: 4, maxSubagentSpawnsPerRun: 16 };
    const after = managed.present ? managed : { present: true, value: oldLimit[segments[1]] };
    if (!same(current, after)) continue;
    const before = state?.previous[pathKey(segments)] || { present: false };
    if (before.present) setPath(settings, segments, before.value);
    else deletePath(settings, segments);
  }
  if (!state || state.packageAdded > 0) {
    const packages = settings.packages || [];
    removePackageOccurrences(packages, state?.packageAdded || 1);
    if (packages.length) settings.packages = packages;
    else delete settings.packages;
  }
  restoreContainers(settings, state?.previousContainers || {});
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  options.agentDir = path.resolve(options.agentDir);
  options.configDir = path.resolve(options.configDir);
  options.settingsPath = path.join(options.agentDir, 'settings.json');
  options.statePath = path.join(options.agentDir, '.pi-orchestrator-setup.json');
  const extensionPath = path.join(options.agentDir, 'extensions/subagent/config.json');
  const profiles = loadProfiles(options.configDir);
  if (options.mode === 'package-sources') {
    console.log(profiles[options.provider].packages.map(packageSource).join('\n'));
    return;
  }
  const settingsInfo = readJson(options.settingsPath, 'settings.json');
  const extensionInfo = readJson(extensionPath, 'subagent config');
  const settings = clone(settingsInfo.value);
  const extension = clone(extensionInfo.value);
  const state = loadState(options.statePath);
  assertSettingsShape(settings);
  assertSafeKeys(settings);
  assertSafeKeys(extension);
  const activeProvider = state?.provider || detectProvider(settings, profiles, options.agentDir);
  if (options.uninstall && state && options.provider && state.provider !== options.provider) {
    fail(`provider ${options.provider} is not active (active provider is ${state.provider})`);
  }
  if (options.mode === 'restore-package-filters') {
    // pi install can normalize package entries; restore the selected filters
    // without recapturing installer ownership or modifying unrelated settings.
    mergePackages(settings, profiles[options.provider].packages);
    writeJson(options.settingsPath, settings);
    return;
  }
  if (state?.version === 2) {
    restoreDocument(settings, state.documents.settings);
    restoreDocument(extension, state.documents.extension);
    restorePackages(settings, state.packages);
  } else {
    migrateLegacy(settings, state, profiles, activeProvider);
  }
  let nextState;
  if (!options.uninstall) {
    const desired = clone(profiles[options.provider]);
    delete desired.packages;
    const extensionDesired = readJson(path.join(options.configDir, 'subagents.json'), 'shared subagent config', { optional: false }).value;
    assertSafeKeys(extensionDesired);
    for (const key of ['maxSubagentDepth', 'globalConcurrencyLimit', 'maxSubagentSpawnsPerRun']) {
      if (!Number.isSafeInteger(extensionDesired[key]) || extensionDesired[key] < 1) fail(`invalid subagent config ${key}`);
    }
    nextState = {
      version: 2,
      provider: options.provider,
      documents: {
        settings: mergeDocument(settings, desired),
        extension: mergeDocument(extension, extensionDesired),
      },
      packages: mergePackages(settings, profiles[options.provider].packages),
    };
  }
  if (options.mode === 'plan') {
    plan(options, profiles, settingsInfo, state);
    return;
  }
  if (!same(settingsInfo.value, settings)) writeJson(options.settingsPath, settings);
  if (!same(extensionInfo.value, extension)) writeJson(extensionPath, extension);
  if (nextState) writeJson(options.statePath, nextState);
  else if (state) fs.unlinkSync(options.statePath);
}

try {
  main();
} catch (error) {
  if (process.exitCode === undefined || process.exitCode === 0) process.exitCode = 1;
  console.error(`install-config: ${error instanceof Error ? error.message : String(error)}`);
}
