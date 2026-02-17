import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, platform } from "node:os";

const cwd = process.cwd();
const children = [];

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  children.forEach((child) => {
    if (!child.killed) child.kill();
  });
  process.exit(0);
});

async function ask(rl, prompt, fallback) {
  const answer = (await rl.question(prompt)).trim();
  if (!answer && fallback !== undefined) return fallback;
  return answer;
}

async function writeEnvFile(rl, vars) {
  const envPath = join(cwd, ".env");
  if (existsSync(envPath)) {
    const overwrite = await ask(rl, "  .env already exists. Overwrite? (y/n): ");
    if (overwrite.toLowerCase() !== "y") {
      console.log("  Keeping existing .env\n");
      return;
    }
  }
  const content = Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n";
  writeFileSync(envPath, content);
  console.log("  .env written\n");
}

function spawnBackground(label, cmd, args) {
  const child = spawn(cmd, args, { cwd, stdio: "pipe" });
  children.push(child);

  const ready = new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log(`  [${label}] still starting (continuing anyway)`);
      resolve();
    }, 15000);

    child.stdout.on("data", (data) => {
      const line = data.toString();
      process.stdout.write(`  [${label}] ${line}`);
      if (line.includes("running on") || line.includes("listening") || line.includes("Running on") || line.includes("localhost")) {
        clearTimeout(timeout);
        resolve();
      }
    });

    child.stderr.on("data", (data) => {
      process.stderr.write(`  [${label}] ${data}`);
    });

    child.on("error", (err) => {
      console.error(`  [${label}] error: ${err.message}`);
      clearTimeout(timeout);
      resolve();
    });

    child.on("exit", (code) => {
      if (code !== null && code !== 0) {
        console.log(`  [${label}] exited with code ${code}`);
      }
      clearTimeout(timeout);
      resolve();
    });
  });

  return { child, ready };
}

function openUrl(url) {
  try {
    if (platform() === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" });
    } else if (platform() === "linux") {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    } else {
      console.log(`  Open in browser: ${url}`);
    }
  } catch {
    console.log(`  Open in browser: ${url}`);
  }
}

function openApp(name) {
  try {
    if (platform() === "darwin") {
      spawn("open", ["-a", name], { detached: true, stdio: "ignore" });
    } else {
      console.log(`  Please open ${name} manually`);
    }
  } catch {
    console.log(`  Please open ${name} manually`);
  }
}

function getClaudeConfigPath() {
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
}

function readClaudeConfig(configPath) {
  if (!existsSync(configPath)) return {};
  const raw = readFileSync(configPath, "utf-8");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Claude config at ${configPath} is not valid JSON. Fix it manually before running setup.`);
  }
}

function mergeClaudeConfig(existing, entry) {
  const merged = { ...existing };
  if (!merged.mcpServers) {
    merged.mcpServers = {};
  }
  merged.mcpServers["x402-weather"] = entry;
  return merged;
}

const SEMANTIC_FACILITATOR_URL = "https://x402.semanticpay.io";

async function collectEnvVars(rl) {
  console.log("  Environment Variables\n");

  let mnemonic = await ask(rl, "  MNEMONIC (BIP-39 seed phrase): ");
  if (!mnemonic) {
    mnemonic = await ask(rl, "  MNEMONIC is required. Try again: ");
    if (!mnemonic) {
      console.log("  MNEMONIC is required. Aborting.\n");
      process.exit(1);
    }
  }

  let payTo = await ask(rl, "  PAY_TO_ADDRESS (0x...): ");
  if (!payTo || !payTo.startsWith("0x")) {
    payTo = await ask(rl, "  PAY_TO_ADDRESS must start with 0x. Try again: ");
    if (!payTo || !payTo.startsWith("0x")) {
      console.log("  Invalid PAY_TO_ADDRESS. Aborting.\n");
      process.exit(1);
    }
  }

  console.log();
  return { mnemonic, payTo };
}

async function chooseFacilitator(rl) {
  console.log(`  Facilitator\n`);
  console.log(`  1) Semantic  - Use the hosted Semantic facilitator (${SEMANTIC_FACILITATOR_URL})`);
  console.log(`  2) Self-hosted - Run your own facilitator locally\n`);

  const choice = await ask(rl, "  Choice (1 or 2): ", "1");

  if (choice === "2") {
    return { selfHosted: true, url: "http://localhost:4022" };
  }
  return { selfHosted: false, url: SEMANTIC_FACILITATOR_URL };
}

async function runHttpFlow(rl) {
  console.log("\n  HTTP Demo Setup\n");

  const { mnemonic, payTo } = await collectEnvVars(rl);
  const facilitator = await chooseFacilitator(rl);

  await writeEnvFile(rl, {
    MNEMONIC: mnemonic,
    PAY_TO_ADDRESS: payTo,
    FACILITATOR_URL: facilitator.url,
  });

  if (facilitator.selfHosted) {
    console.log("  Starting facilitator...");
    const fac = spawnBackground("facilitator", "node", ["x402/facilitator.js"]);
    await fac.ready;
    console.log();
  }

  console.log("  Starting x402 server...");
  const server = spawnBackground("server", "node", ["x402/server.js"]);
  await server.ready;

  console.log("\n  Starting HTTP demo UI...");
  const ui = spawnBackground("ui", "npm", ["run", "dev", "--prefix", "demo/http"]);
  await ui.ready;

  console.log();
  openUrl("http://localhost:5173");
  console.log("  Opened http://localhost:5173");
  console.log("\n  Press Ctrl+C to stop all servers.\n");

  rl.close();
  await new Promise(() => {});
}

async function finishMcpSetup(rl) {
  const dashboardUrl = "http://localhost:4030";
  openUrl(dashboardUrl);

  console.log(`  ┌─────────────────────────────────────────┐`);
  console.log(`  │  MCP Dashboard: ${dashboardUrl}    │`);
  console.log(`  └─────────────────────────────────────────┘`);
  console.log(`\n  Press Ctrl+C to stop all servers.\n`);

  rl.close();
  await new Promise(() => {});
}

async function runMcpFlow(rl) {
  console.log("\n  MCP Demo Setup\n");

  const { mnemonic, payTo } = await collectEnvVars(rl);
  const facilitator = await chooseFacilitator(rl);

  await writeEnvFile(rl, {
    MNEMONIC: mnemonic,
    PAY_TO_ADDRESS: payTo,
    FACILITATOR_URL: facilitator.url,
  });

  console.log("  Installing dashboard dependencies...");
  try {
    execSync("npm install --prefix demo/mcp", { cwd, stdio: "pipe" });
    console.log("  Dependencies installed");
  } catch {
    console.log("  Warning: dependency install failed\n");
  }

  console.log("  Building dashboard UI...");
  try {
    execSync("npm run build --prefix demo/mcp", { cwd, stdio: "pipe" });
    console.log("  Dashboard built\n");
  } catch {
    console.log("  Dashboard build failed (dashboard will run without pre-built UI)\n");
  }

  if (facilitator.selfHosted) {
    console.log("  Starting facilitator...");
    const fac = spawnBackground("facilitator", "node", ["x402/facilitator.js"]);
    await fac.ready;
    console.log();
  }

  console.log("  Starting x402 server...");
  const server = spawnBackground("server", "node", ["x402/server.js"]);
  await server.ready;

  console.log("\n  Starting MCP dashboard...");
  const dashboard = spawnBackground("dashboard", "node", ["demo/mcp/dashboard.js"]);
  await dashboard.ready;

  console.log("\n  Claude Desktop Configuration\n");

  const mcpMnemonic = await ask(
    rl,
    `  MNEMONIC for MCP server (Enter to reuse same): `,
    mnemonic
  );

  const resourceUrl = await ask(
    rl,
    "  RESOURCE_SERVER_URL (Enter for http://localhost:4021): ",
    "http://localhost:4021"
  );

  const mcpEntry = {
    command: "node",
    args: [join(cwd, "demo/mcp/server.js")],
    env: {
      MNEMONIC: mcpMnemonic,
      RESOURCE_SERVER_URL: resourceUrl,
    },
  };

  const configPath = getClaudeConfigPath();
  console.log(`\n  Claude config: ${configPath}\n`);

  let existing;
  try {
    existing = readClaudeConfig(configPath);
  } catch (err) {
    console.log(`  ${err.message}`);
    console.log("  Skipping Claude config. You can add it manually.\n");
    finishMcpSetup(rl);
    return;
  }

  if (existing.mcpServers?.["x402-weather"]) {
    const overwrite = await ask(rl, "  x402-weather already exists in config. Overwrite? (y/n): ");
    if (overwrite.toLowerCase() !== "y") {
      console.log("  Keeping existing config.\n");
      finishMcpSetup(rl);
      return;
    }
  }

  const merged = mergeClaudeConfig(existing, mcpEntry);

  console.log("\n  Config to write:\n");
  console.log(JSON.stringify(merged, null, 2).split("\n").map((l) => "  " + l).join("\n"));
  console.log();

  const confirm = await ask(rl, "  Write this config? (y/n): ");

  if (confirm.toLowerCase() === "y") {
    const configDir = dirname(configPath);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n");
    console.log("  Claude Desktop config updated.\n");

    console.log("  Opening Claude Desktop...");
    openApp("Claude");
  } else {
    console.log("  Config not written. Add it manually if needed.\n");
  }

  finishMcpSetup(rl);
}

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });

  console.log(`
  x402 USDT0 Demo Setup
  =====================

  1) HTTP  - Payment flow visualization in the browser
  2) MCP   - Connect Claude Desktop to a paid weather tool
  `);

  const choice = await ask(rl, "  Choice (1 or 2): ");

  if (choice === "1") {
    await runHttpFlow(rl);
  } else if (choice === "2") {
    await runMcpFlow(rl);
  } else {
    console.log("\n  Invalid choice. Run again and pick 1 or 2.\n");
    rl.close();
  }
}

main();
