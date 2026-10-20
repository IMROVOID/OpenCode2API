import { runStartCommand, type StartOptions } from "./commands/start.js";

const VERSION = "1.0.0";

function printHelp(): void {
  console.log(`
OpenCode2API-Proxy v${VERSION}
OpenCode Zen and Go to an OpenAI-compatible API proxy

Usage:
  opencode2api-proxy <command> [options]

Commands:
  start               Start the local API daemon and control WebUI (default)
  version             Display version information

Options:
  -p, --port <number>     Override the API server port
  -h, --host <host>       Override the API server host
  -k, --key <string>      Set the Bearer API key clients authenticate with
  -c, --config <path>     Path to the config file (default: ./config.json)
      --no-webui          Disable the control WebUI
  -v, --version           Display version information
      --help              Display this help message

Examples:
  opencode2api-proxy start --port 8080 --key sk-my-secret-key
  opencode2api-proxy start --config ./config.json
`);
}

// CliOptions are the options the command line accepts.
export interface CliOptions extends StartOptions {
  version?: boolean;
  help?: boolean;
}

// parseArgs reads the command line.
export function parseArgs(args: string[]): {
  command: string;
  options: CliOptions;
  extraArgs: string[];
} {
  let command = "start";
  const options: CliOptions = {};
  const extraArgs: string[] = [];
  const knownCommands = new Set(["start", "version"]);
  let index = 0;
  if (args[0] !== undefined && knownCommands.has(args[0])) {
    command = args[0];
    index = 1;
  }
  while (index < args.length) {
    const arg = args[index];
    if (arg === undefined) {
      index += 1;
      continue;
    }
    if (arg === "-p" || arg === "--port") {
      options.port = Number(args[(index += 1)] ?? "8080");
    } else if (arg === "-h" || arg === "--host") {
      const host = args[index + 1];
      if (host !== undefined) {
        options.host = host;
      }
      index += 1;
    } else if (arg === "-k" || arg === "--key") {
      const key = args[index + 1];
      if (key !== undefined) {
        options.key = key;
      }
      index += 1;
    } else if (arg === "-c" || arg === "--config") {
      const config = args[index + 1];
      if (config !== undefined) {
        options.config = config;
      }
      index += 1;
    } else if (arg === "--no-webui") {
      options.webui = false;
    } else if (arg === "-v" || arg === "--version") {
      options.version = true;
    } else if (arg === "--help") {
      options.help = true;
    } else {
      extraArgs.push(arg);
    }
    index += 1;
  }
  return { command, options, extraArgs };
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (options.version === true || command === "version") {
    console.log(`opencode2api-proxy v${VERSION}`);
    return;
  }
  if (options.help === true) {
    printHelp();
    return;
  }
  await runStartCommand(options);
}

main().catch((error) => {
  console.error("[OpenCode2API] Fatal error:", error);
  process.exit(1);
});
