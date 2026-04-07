/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  /**
   * Empty: allow ts-jest to transpile ESM in `node_modules` (`franc` + `trigram-utils`).
   * Targeted `transformIgnorePatterns` breaks under pnpm’s nested paths; revisit if test time grows.
   */
  transformIgnorePatterns: [],
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};
