import * as fs from "fs";
import * as path from "path";
import hre from "hardhat";
import { deploymentsDir, type DeploymentRecord } from "./lib/exportAbi";

/**
 * Verifies the ChestFactory and the router on the explorer, from the record
 * deploy.ts wrote for this network.
 *
 *   npm run verify:robinhood
 */
async function main() {
  const file = path.join(deploymentsDir, `${hre.network.name}.json`);
  if (!fs.existsSync(file)) throw new Error(`No deployment record at ${file} — run deploy first.`);
  const record = JSON.parse(fs.readFileSync(file, "utf8")) as DeploymentRecord;
  console.log(`Verifying on ${hre.network.name}: ChestFactory ${record.chestFactory}, router ${record.router}`);
  for (const job of [
    { address: record.chestFactory, constructorArguments: [] as unknown[], contract: "contracts/ChestFactory.sol:ChestFactory" },
    { address: record.router, constructorArguments: [record.ponsFactory, record.chestFactory, record.treasury, record.deployer], contract: "contracts/LootpadRouter.sol:LootpadRouter" },
  ]) {
    try {
      await hre.run("verify:verify", job);
      console.log(`  verified ${job.contract} at ${job.address}`);
    } catch (e) {
      console.log(`  ${job.contract}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  console.log("Per-launch chests are created by the ChestFactory; verify them the same way with their constructor arguments if the explorer asks.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
