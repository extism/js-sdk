const { build } = require("esbuild");
const { peerDependencies } = require('./package.json')

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
});

build({
    ...sharedConfig,
    entryPoints: ["src/index.browser.ts"],
    outfile: "dist/browser/index.esm.js",
    platform: 'neutral', // for ESM
    format: "esm",
});
