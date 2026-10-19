import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "..");
const repo = path.resolve(desktop, "..");
const agentd = path.join(repo, "agentd");
const target = path.join(desktop, "resources", "agentd");

console.log("building agentd...");
execFileSync("npm", ["run", "build"], { cwd: agentd, stdio: "inherit" });

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const entry of ["package.json", "package-lock.json", "dist"]) {
  cpSync(path.join(agentd, entry), path.join(target, entry), { recursive: true });
}
console.log("installing production dependencies...");
execFileSync("npm", ["ci", "--omit=dev", "--ignore-scripts"], {
  cwd: target,
  stdio: "inherit",
});
if (!existsSync(path.join(target, "node_modules", "ws"))) {
  throw new Error("agentd production dependencies were not installed");
}
console.log(`prepared ${target}`);
