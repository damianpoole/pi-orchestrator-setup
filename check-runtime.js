'use strict';

const fs = require('node:fs');
const path = require('node:path');
const runtime = require('./config/runtime.json');

try {
  if (Number(process.versions.node.split('.')[0]) < runtime.nodeMinimumMajor) {
    throw new Error(`Node.js ${runtime.nodeMinimumMajor}+ is required; found ${process.versions.node}`);
  }
  const executable = fs.realpathSync(process.argv[2]);
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
  console.log(`Runtime: Pi ${found.version} (npm), Node ${process.versions.node}`);
} catch (error) {
  console.error(`Runtime check: ${error.message}`);
  process.exitCode = 1;
}
