const fs = require("fs");
const crypto = require("crypto");

async function main() {
  const pluginPath = "src/plugin.ts";
  let pluginContents = await fs.promises.readFile(pluginPath, "utf8");

  const kernelPath = "wasm/extism-runtime.wasm";
  const kernelContents = await fs.promises.readFile(kernelPath);
  const kernelBase64 = kernelContents.toString("base64");
  const kernelHash = await crypto.createHash("sha256").update(kernelContents)
    .digest("hex");
  console.log(kernelHash);

  pluginContents = pluginContents.replace(
    /embeddedRuntime =[ \n]*'.*'/,
    `embeddedRuntime =\n    '${kernelBase64}'`,
  );
  pluginContents = pluginContents.replace(
    /embeddedRuntimeHash =[ \n]*'[.\n]*'/,
    `embeddedRuntimeHash =\n    '${kernelHash}'`,
  );

  await fs.promises.writeFile(pluginPath, pluginContents);
}

main();
