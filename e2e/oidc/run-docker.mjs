import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const composeFile = path.join(__dirname, "docker-compose.yml");
const projectName = "rybbit-oidc-e2e";
const repoRoot = path.resolve(__dirname, "../..");

function run(args) {
  const child = spawn("docker", ["compose", "-p", projectName, "-f", composeFile, ...args], {
    cwd: repoRoot,
    stdio: "inherit",
  });

  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", code => {
      if (code === 0) resolve();
      else reject(new Error(`docker compose ${args.join(" ")} exited with ${code}`));
    });
  });
}

try {
  await run(["run", "--rm", "--build", "runner"]);
} finally {
  await run(["down", "-v"]).catch(error => {
    console.error(error);
  });
}
