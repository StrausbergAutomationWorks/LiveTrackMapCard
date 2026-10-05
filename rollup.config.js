import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { bannerFor, buildVersion, readGit, stampVersion } from './build/stamp-version.js';
import { BUNDLED, noticesBanner, readNotice } from './build/notices.js';

// The real version goes into the bundle - see build/stamp-version.js.
const { version: packageVersion } = JSON.parse(readFileSync('package.json', 'utf8'));
const version = buildVersion({ packageVersion, ...readGit(process.cwd()) });

export default {
  input: 'src/index.js',
  output: {
    file: 'dist/live-track-map-card.js',
    format: 'cjs',
    // The version first (parseBanner reads line 1), then every bundled
    // package's licence notice (backlog 272).
    banner: bannerFor(version) + "\n" + noticesBanner(BUNDLED.map((n) => readNotice(process.cwd(), n))),
  },
  plugins: [stampVersion(version), nodeResolve(), commonjs()]
};