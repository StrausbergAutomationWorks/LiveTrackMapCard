import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';

export default {
  input: 'src/index.js',
  output: {
    file: 'dist/live-track-map-card.js',
    format: 'cjs'
  },
  plugins: [nodeResolve(), commonjs()]
};