const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const sourceDist = path.join(rootDir, "dist");
const targetDist = path.join(rootDir, "functions", "dist");

if (!fs.existsSync(sourceDist)) {
  console.error("Root dist/ not found. Run `npm run build` first.");
  process.exit(1);
}

fs.rmSync(targetDist, { recursive: true, force: true });
fs.cpSync(sourceDist, targetDist, { recursive: true });
console.log("Copied dist/ to functions/dist/");
