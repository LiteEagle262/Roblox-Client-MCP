import fs from "node:fs";
import path from "node:path";

const assets = [["src/relay/agent.lua", "dist/relay/agent.lua"]];

for (const [from, to] of assets) {
  const source = path.resolve(process.cwd(), from);
  const target = path.resolve(process.cwd(), to);
  if (!fs.existsSync(source)) {
    console.error(`[copy-assets] missing ${from}`);
    process.exitCode = 1;
    continue;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  console.log(`[copy-assets] ${from} -> ${to}`);
}
