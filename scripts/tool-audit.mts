// Prints what the agent can actually reach, per role. Run with:
//   npx tsx scripts/tool-audit.mts
// Used to confirm "the AI has access to every feature" against the real
// registry rather than against intent.
import { agentToolNames } from "../src/lib/agent/tools";

const roles = ["OWNER", "STAFF", "REP", "TECHNICIAN", "DRIVER"] as const;
for (const role of roles) {
  console.log(`${role.padEnd(11)} ${String(agentToolNames(role).length).padStart(3)} tools`);
}
console.log("\nOWNER:\n" + agentToolNames("OWNER").sort().join(", "));
