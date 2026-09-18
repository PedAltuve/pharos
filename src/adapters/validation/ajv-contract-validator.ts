import { createRequire } from "node:module";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import type { ContractValidationError, ContractValidator } from "../../domain/ports/index.js";
import { err, ok, type Result } from "../../shared/result.js";

const require = createRequire(import.meta.url);
const annotationSchema = require("../../contracts/schemas/capture-annotation.schema.json") as object;

function fieldFor(error: ErrorObject): string {
  if (error.keyword !== "additionalProperties") return error.instancePath || "/";
  const property = (error.params as { readonly additionalProperty?: unknown }).additionalProperty;
  return typeof property === "string" ? `${error.instancePath}/${property}` : error.instancePath || "/";
}

function stableErrors(errors: readonly ErrorObject[] | null | undefined): readonly ContractValidationError[] {
  return (errors ?? []).map((error) => ({
    rule: "invalid-contract",
    field: fieldFor(error),
    keyword: error.keyword,
  }));
}

/** Strict 2020-12 ingress validation; policy and semantic mapping remain application-owned. */
export class AjvContractValidator implements ContractValidator {
  private readonly annotation: ValidateFunction;

  constructor() {
    const ajv = new Ajv2020({
      strict: true,
      allErrors: true,
      coerceTypes: false,
      useDefaults: false,
      removeAdditional: false,
    });
    this.annotation = ajv.compile(annotationSchema);
  }

  validateProjectInit(input: unknown): Result<unknown, readonly ContractValidationError[]> {
    void input;
    return err([{ rule: "invalid-contract", field: "/", keyword: "unsupported" }]);
  }

  validateAnnotation(input: unknown): Result<unknown, readonly ContractValidationError[]> {
    return this.annotation(input)
      ? ok(input)
      : err(stableErrors(this.annotation.errors));
  }
}
