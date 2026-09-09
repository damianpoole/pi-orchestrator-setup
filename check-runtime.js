'use strict';

const fs = require('node:fs');
const path = require('node:path');
const runtime = require('./config/runtime.json');

function resolveExecutable(input) {
  let executable = fs.realpathSync(input);
  for (let depth = 0; depth < 4; depth += 1) {
    fs.accessSync(executable, fs.constants.X_OK);
    const lines = fs.readFileSync(executable, 'utf8').split(/\r?\n/);
    const shim = /^# aube-bin-shim v2 target=([^\r\n]+)$/.exec(lines[1] || '');
    if (shim) {
      const target = shim[1];
      if (!target || path.isAbsolute(target) || target.includes('\0')) {
        throw new Error('The Pi launcher is an invalid aube-bin-shim wrapper.');
      }
      const next = fs.realpathSync(path.resolve(path.dirname(executable), target));
      if (next === executable) throw new Error('The Pi launcher wrapper points to itself.');
      executable = next;
      continue;
    }
    if (lines[0].startsWith('#!') && !/\bnode(?:js)?(?:\s|$)/.test(lines[0])) {
      throw new Error('Unknown Pi wrapper detected; use the actual npm Pi executable, not a shell wrapper.');
    }
    return executable;
  }
  throw new Error('The Pi launcher has too many nested wrappers.');
}

try {
  if (Number(process.versions.node.split('.')[0]) < runtime.nodeMinimumMajor) {
    throw new Error(`Node.js ${runtime.nodeMinimumMajor}+ is required; found ${process.versions.node}`);
  }
  const resolveOnly = process.argv[2] === '--resolve';
  const input = resolveOnly ? process.argv[3] : process.argv[2];
  if (!input) throw new Error('A Pi executable path is required.');
  const executable = resolveExecutable(input);
  let directory = path.dirname(executable);
  let found;
  while (true) {
    const manifest = path.join(directory, 'package.json');
    if (fs.existsSync(manifest)) {
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (pkg.name === '@earendil-works/pi-coding-agent') {
        found = pkg;
        break;
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  if (!found || found.version !== runtime.piVersion) {
    throw new Error(`Use the npm installation of Pi ${runtime.piVersion}. Install with npm install -g --ignore-scripts @earendil-works/pi-coding-agent@${runtime.piVersion}, then set PI_BINARY to its actual pi executable (for example, $(npm prefix -g)/bin/pi). Standalone binaries and auto-updating wrappers are not supported.`);
  }
  if (resolveOnly) console.log(executable);
  else console.log(`Runtime: Pi ${found.version} (npm), Node ${process.versions.node}`);
} catch (error) {
  console.error(`Runtime check: ${error.message}`);
  process.exitCode = 1;
}
