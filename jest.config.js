module.exports = {
    transform: {
      // The .babelrc presets, given inline: a .babelrc is file-relative and
      // does not reach node_modules, where @mapbox/vector-tile and pbf ship
      // ES modules only (item 270 part 2).
      '^.+\\.js$': ['babel-jest', { babelrc: false, configFile: false, presets: [['@babel/preset-env', { modules: 'commonjs' }]] }],
    },
    transformIgnorePatterns: [
      "/node_modules/(?!(@open-wc|lit|@esm-bundle|@mapbox|pbf)).+\\.js$"
    ],
    moduleFileExtensions: ['js', 'json'],
    testEnvironment: 'jsdom',
  };