import type { Result } from "../../shared/result.js";

export interface ContractValidationError {
  readonly rule: "invalid-contract";
  readonly field: string;
  readonly keyword: string;
}

/** Runtime validation boundary for untrusted JSON-shaped ingress. */
export interface ContractValidator {
  validateProjectInit(input: unknown): Result<unknown, readonly ContractValidationError[]>;
  validateAnnotation(input: unknown): Result<unknown, readonly ContractValidationError[]>;
}
