const { cpSync, existsSync } = require("node:fs");
const path = require("node:path");

module.exports = async function afterPack(context) {
  const source = path.join(__dirname, "..", "resources", "agentd", "node_modules");
  if (!existsSync(source)) throw new Error(`agentd dependencies missing: ${source}`);
  const resources =
    context.packager.platform.name === "mac"
      ? path.join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          "Contents",
          "Resources",
        )
      : path.join(context.appOutDir, "resources");
  const destination = path.join(resources, "agentd", "node_modules");
  cpSync(source, destination, { recursive: true });
  console.log(`copied agentd dependencies -> ${destination}`);
};
