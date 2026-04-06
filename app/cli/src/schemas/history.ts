export interface HistoryEntry {
  readonly hash: string;
  readonly type: "transfer";
  readonly from: string;
  readonly to: string;
  readonly amount: string;
  readonly formatted: string;
  readonly tokenName: string;
  readonly tokenId: string;
  readonly network: string;
  readonly status: string;
  readonly timestamp: string;
  readonly explorerUrl: string | null;
  readonly route: "fast" | "evm-to-fast" | "fast-to-evm";
  readonly chainId: number | null;
}

export const makeHistoryEntry = (
  fields: Omit<HistoryEntry, "route" | "chainId"> & {
    route?: HistoryEntry["route"];
    chainId?: number | null;
  },
): HistoryEntry => ({
  ...fields,
  route: fields.route ?? "fast",
  chainId: fields.chainId ?? null,
});
