#!/usr/bin/env node
/**
 * Copies the built web assets next to the compiled server so that
 * `npm start` serves the dashboard without setting WEB_ROOT.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const from = path.join(root, "web", "dist");
const to = path.join(root, "server", "public");

if (!fs.existsSync(from)) {
  console.error(`[copy-web] ${from} does not exist. Run "npm run build" first.`);
  process.exit(1);
}

fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
console.log(`[copy-web] ${path.relative(root, from)} -> ${path.relative(root, to)}`);
