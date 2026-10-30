// Run the agent's probe_oauth tool by hand: node scripts/probe.ts <domain...> [--authorize <url>]
import { probeOAuth } from "../src/lib/probe.ts";

const args = process.argv.slice(2);
const i = args.indexOf("--authorize");
const authorizeUrl = i >= 0 ? args[i + 1] : undefined;
const domains = i >= 0 ? args.filter((_, j) => j !== i && j !== i + 1) : args;
console.log(JSON.stringify(await probeOAuth({ domains, authorizeUrl }), null, 2));
