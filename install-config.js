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

function capturePaths(root, paths) {
  const result = {};
  for (const segments of paths) result[pathKey(segments)] = getEntry(root, segments);
  return result;
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
    } else if (arg === '--plan' || arg === '--apply') {
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
    for (const segments of MANAGED_PATHS) {
      if (!getEntry(profile, segments).present) {
        fail(`${profilePath(configDir, provider)} is missing ${pathKey(segments)}`);
      }
    }
    if (!isRecord(profile.subagents) || !Array.isArray(profile.subagents.modelScope.allow)) {
      fail(`${profilePath(configDir, provider)} has an invalid model scope`);
    }
    profiles[provider] = profile;
  }
  return profiles;
}

function loadState(statePath) {
  const loaded = readJson(statePath, 'installer state');
  if (!loaded.exists) return null;
  const state = loaded.value;
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

function makeLegacyPrevious(settings, profiles, activeProvider) {
  const activeProfile = activeProvider ? profiles[activeProvider] : undefined;
  const previous = {};
  for (const segments of MANAGED_PATHS) {
    const current = getEntry(settings, segments);
    const expected = activeProfile && getEntry(activeProfile, segments);
    previous[pathKey(segments)] = expected?.present && current.present && same(current.value, expected.value)
      ? { present: false }
      : current;
  }
  return previous;
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
  console.log('Actions: install/update pi-subagents, settings, agents, and managed AGENTS.md block');
  return provider;
}

function applyInstall(options, profiles, settingsInfo, state, activeProvider) {
  const profile = profiles[options.provider];
  const settings = settingsInfo.value;
  assertSettingsShape(settings);

  let previous;
  let previousContainers;
  let packageAdded;
  if (state) {
    previous = state.previous;
    previousContainers = state.previousContainers;
    packageAdded = state.packageAdded;
  } else {
    previous = makeLegacyPrevious(settings, profiles, activeProvider);
    previousContainers = capturePaths(settings, CONTAINER_PATHS);
    const currentPackages = getEntry(settings, ['packages']);
    packageAdded = currentPackages.present && currentPackages.value.includes(PACKAGE) ? 0 : 1;
  }

  for (const segments of MANAGED_PATHS) {
    setPath(settings, segments, getEntry(profile, segments).value);
  }

  const packages = getEntry(settings, ['packages']);
  if (!packages.present) setPath(settings, ['packages'], []);
  const updatedPackages = getEntry(settings, ['packages']).value;
  if (!updatedPackages.includes(PACKAGE)) {
    updatedPackages.push(PACKAGE);
    setPath(settings, ['packages'], updatedPackages);
  }

  writeJson(settingsInfo.path, settings);
  writeJson(options.statePath, {
    version: 1,
    provider: options.provider,
    managed: clone(profile),
    previous: clone(previous),
    previousContainers: clone(previousContainers),
    packageAdded,
  });
}

function applyUninstall(options, profiles, settingsInfo, state, target) {
  const settings = settingsInfo.value;
  if (!target) {
    if (state) fs.unlinkSync(options.statePath);
    return false;
  }
  assertSettingsShape(settings);

  if (state) {
    for (const segments of MANAGED_PATHS) {
      const key = pathKey(segments);
      const managed = getEntry(state.managed, segments);
      const current = getEntry(settings, segments);
      if (!managed.present || !current.present || !same(current.value, managed.value)) continue;
      const previous = state.previous[key] || { present: false };
      if (previous.present) setPath(settings, segments, previous.value);
      else deletePath(settings, segments);
    }
    const packages = getEntry(settings, ['packages']);
    if (state.packageAdded > 0 && packages.present) {
      if (!Array.isArray(packages.value)) fail('settings.json has non-array packages; refusing to uninstall');
      const updatedPackages = packages.value;
      removePackageOccurrences(updatedPackages, state.packageAdded);
      if (updatedPackages.length > 0) setPath(settings, ['packages'], updatedPackages);
      else deletePath(settings, ['packages']);
    }
    restoreContainers(settings, state.previousContainers);
  } else {
    const profile = profiles[target];
    let matched = 0;
    for (const segments of MANAGED_PATHS) {
      const expected = getEntry(profile, segments);
      const current = getEntry(settings, segments);
      if (expected.present && current.present && same(current.value, expected.value)) {
        deletePath(settings, segments);
        matched += 1;
      }
    }
    const packages = getEntry(settings, ['packages']);
    if (matched > 0 && packages.present && Array.isArray(packages.value)) {
      removePackageOccurrences(packages.value, 1);
      if (packages.value.length > 0) setPath(settings, ['packages'], packages.value);
      else deletePath(settings, ['packages']);
    }
    for (const segments of [...CONTAINER_PATHS].reverse()) {
      const current = getEntry(settings, segments);
      if (current.present && isRecord(current.value) && Object.keys(current.value).length === 0) {
        deletePath(settings, segments);
      }
    }
  }

  if (settingsInfo.exists && !same(settingsInfo.original, settings)) writeJson(settingsInfo.path, settings);
  if (state) fs.unlinkSync(options.statePath);
  return true;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  options.agentDir = path.resolve(options.agentDir);
  options.configDir = path.resolve(options.configDir);
  options.settingsPath = path.join(options.agentDir, 'settings.json');
  options.statePath = path.join(options.agentDir, '.pi-orchestrator-setup.json');

  const profiles = loadProfiles(options.configDir);
  const settingsInfo = readJson(options.settingsPath, 'settings.json');
  settingsInfo.path = options.settingsPath;
  settingsInfo.original = clone(settingsInfo.value);
  const state = loadState(options.statePath);
  assertSettingsShape(settingsInfo.value);
  const activeProvider = state?.provider || detectProvider(settingsInfo.value, profiles, options.agentDir);
  if (options.uninstall && state && options.provider && state.provider !== options.provider) {
    fail(`provider ${options.provider} is not active (active provider is ${state.provider}); rerun uninstall without --provider or select ${state.provider}`);
  }

  const target = options.mode === 'plan' ? plan(options, profiles, settingsInfo, state) : (options.uninstall
    ? uninstallTarget(options, profiles, settingsInfo, state)
    : options.provider);
  if (options.mode === 'plan') return;

  if (options.uninstall) {
    applyUninstall(options, profiles, settingsInfo, state, target);
  } else {
    applyInstall(options, profiles, settingsInfo, state, activeProvider);
  }
}

try {
  main();
} catch (error) {
  if (process.exitCode === undefined || process.exitCode === 0) process.exitCode = 1;
  console.error(`install-config: ${error instanceof Error ? error.message : String(error)}`);
}
