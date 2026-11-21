export interface CompiledVaultArtifact {
  contractName: string;
  compiler: string;
  abi: readonly Record<string, unknown>[];
  bytecode: `0x${string}`;
  deployedBytecode: `0x${string}`;
  bytecodeBytes: number;
  compiledAt: string;
}

export function compileVaultContract(): CompiledVaultArtifact;
