import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";

/** Compiles rules/schema/rule.schema.json (JSON Schema draft 2020-12). */
export function compileRuleSchema(schemaJson: object): ValidateFunction {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return ajv.compile(schemaJson);
}

/** Formats ajv errors into one readable line each. */
export function schemaErrors(validate: ValidateFunction): string[] {
  return (validate.errors ?? []).map(
    (e) => `${e.instancePath || "(root)"} ${e.message ?? "invalid"}`,
  );
}
