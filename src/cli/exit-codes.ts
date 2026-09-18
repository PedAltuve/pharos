/** Stable process-level outcomes. `usage` is Commander grammar failure, not an envelope outcome. */
export type CliOutcome =
  | "succeeded"
  | "failed"
  | "usage"
  | "refused"
  | "inconclusive"
  | "interrupted"
  | "internal";

const EXIT_CODES: Readonly<Record<CliOutcome, 0 | 1 | 2 | 3 | 4 | 5 | 10>> = {
  succeeded: 0,
  failed: 1,
  usage: 2,
  refused: 3,
  inconclusive: 4,
  interrupted: 5,
  internal: 10,
};

export function exitCodeFor(outcome: CliOutcome): 0 | 1 | 2 | 3 | 4 | 5 | 10 {
  return EXIT_CODES[outcome];
}
