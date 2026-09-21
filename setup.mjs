import fs from "node:fs";
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(resolve => rl.question(q, resolve));

console.log("\nKSR Studio V7 — local setup\n");
console.log("Your Gemini API key stays on this computer and is written only to .env.\n");

const key = (await ask("Paste GEMINI_API_KEY here: ")).trim();
rl.close();

if (!key) {
  console.log("No key entered. Setup cancelled.");
  process.exit(1);
}

const env = `GEMINI_API_KEY=${key}\nVEO_MODEL=veo-3.1-generate-preview\nPORT=3000\n`;
fs.writeFileSync(".env", env, { encoding: "utf8" });
console.log("\nDone. .env created.");
console.log("Now run: npm start\n");
