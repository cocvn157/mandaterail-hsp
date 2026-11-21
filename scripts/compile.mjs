import fs from "node:fs";
import path from "node:path";
import solc from "solc";

const rootDir = process.cwd();
const contractPath = path.join(rootDir, "contracts", "MandateSettlementVault.sol");
const artifactDir = path.join(rootDir, "artifacts");
const artifactPath = path.join(artifactDir, "MandateSettlementVault.json");

export function compileVaultContract() {
  const source = fs.readFileSync(contractPath, "utf8");
  const input = {
    language: "Solidity",
    sources: {
      "MandateSettlementVault.sol": {
        content: source
      }
    },
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"]
        }
      }
    }
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = output.errors || [];
  const fatalErrors = errors.filter((e) => e.severity === "error");
  const warnings = errors.filter((e) => e.severity !== "error");

  for (const w of warnings) {
    console.warn(`[solc warning] ${w.formattedMessage}`);
  }

  if (fatalErrors.length > 0) {
    for (const err of fatalErrors) {
      console.error(`[solc error] ${err.formattedMessage}`);
    }
    throw new Error(`Solidity compilation failed with ${fatalErrors.length} error(s).`);
  }

  const compiled = output.contracts["MandateSettlementVault.sol"].MandateSettlementVault;
  if (!compiled) {
    throw new Error("MandateSettlementVault contract output missing from solc.");
  }

  const bytecode = `0x${compiled.evm.bytecode.object}`;
  const deployedBytecode = `0x${compiled.evm.deployedBytecode.object}`;
  const artifact = {
    contractName: "MandateSettlementVault",
    compiler: solc.version(),
    abi: compiled.abi,
    bytecode,
    deployedBytecode,
    bytecodeBytes: compiled.evm.bytecode.object.length / 2,
    compiledAt: new Date().toISOString()
  };

  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));

  return artifact;
}

const isCli = import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("compile.mjs");
if (isCli) {
  const artifact = compileVaultContract();
  console.log(
    `Compiled ${artifact.contractName} (solc ${artifact.compiler}) -> ${artifact.bytecodeBytes} bytes -> ${path.relative(rootDir, artifactPath)}`
  );
}
