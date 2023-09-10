const { build } = require("esbuild");
const { peerDependencies } = require('./package.json')
const fs = require('fs')

const sharedConfig = {
    bundle: true,
    minify: false,
    drop: [], // preseve debugger statements
    external: Object.keys(peerDependencies || {}),
};

// NodeJS CSJ
build({
    ...sharedConfig,
    entryPoints: ["src/node/index.ts"],
    platform: 'node', // for CJS
    outfile: "dist/node/index.js",
    external: [ './src/mod.ts', "sync-fetch", "child_process" ]
});

// Browser ESM
build({
    ...sharedConfig,
    entryPoints: ["src/browser/index.ts"],
    outfile: "dist/browser/index.mjs",
    platform: 'neutral',
    external: [ './src/mod.ts', "sync-fetch", "child_process" ],
    format: "esm",
});