const { build } = require("esbuild");
const { peerDependencies } = require('./package.json')
const fs = require('fs')

const sharedConfig = {
    bundle: true,
    minify: false,
    drop: [], // preseve debugger statements
    external: Object.keys(peerDependencies || {}),
};

build({
    ...sharedConfig,
    entryPoints: ["src/index.node.ts"],
    platform: 'node', // for CJS
    outfile: "dist/node/index.js",
    external: [ './src/index.deno.ts' ]
});

build({
    ...sharedConfig,
    entryPoints: ["src/index.browser.ts"],
    outfile: "dist/browser/index.js",
    platform: 'neutral',
    format: "esm",
});

build({
    ...sharedConfig,
    entryPoints: ["src/index.browser.ts"],
    outfile: "dist/browser/estism.js",
    platform: 'neutral',
    format: "iife",
});

if (!fs.existsSync("dist/deno")) {
    fs.mkdirSync("dist/deno", { recursive: true});
}