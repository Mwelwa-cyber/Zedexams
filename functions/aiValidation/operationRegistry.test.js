/**
 * Node test for functions/aiValidation/operationRegistry.js — the AI operation
 * inventory + provenance builder. No firebase deps.
 *
 * Run: node functions/aiValidation/operationRegistry.test.js
 */

const assert = require("node:assert");
const {
  OPERATIONS, getOperationContract, listOperations, validateContract,
  buildProvenance,
} = require("./operationRegistry");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// ── registry integrity ───────────────────────────────────────────────────────
ok("registry is non-empty", OPERATIONS.length > 0);

const ids = listOperations();
ok("operation ids are unique", new Set(ids).size === ids.length);

let allValid = true;
for (const op of OPERATIONS) {
  const problems = validateContract(op);
  if (problems.length) {
    allValid = false;
    console.error(`  BAD ${op && op.operation}: ${problems.join("; ")}`);
  }
}
ok("every contract is well-formed", allValid);

ok("assessment operation is registered", ids.includes("generate_assessment"));
ok("past-paper import is registered", ids.includes("past_paper_import"));
ok("quiz generation is registered", ids.includes("generate_quiz"));

// validateContract catches breakage
ok("validateContract flags a missing provider", validateContract({operation: "x", label: "x", frontendTrigger: "x", cloudFunction: "x", promptVersion: "x", schemaVersion: "x", validatorVersion: "x", responseType: "assessment", framework: "cbc", destination: "x", usageChargePoint: "x", failureBehaviour: "x", draftFirst: true, idempotent: false}).length > 0);
ok("validateContract flags unknown responseType", validateContract({...OPERATIONS[0], responseType: "made_up"}).some((p) => /responseType/.test(p)));
ok("validateContract flags unknown framework", validateContract({...OPERATIONS[0], framework: "klingon"}).some((p) => /framework/.test(p)));
ok("validateContract flags non-boolean draftFirst", validateContract({...OPERATIONS[0], draftFirst: "yes"}).some((p) => /draftFirst/.test(p)));

// ── getOperationContract ─────────────────────────────────────────────────────
ok("unknown operation → null", getOperationContract("nope") === null);
const asmt = getOperationContract("generate_assessment");
ok("assessment contract has version quadruple", asmt.promptVersion && asmt.schemaVersion && asmt.validatorVersion);
ok("assessment charges after validation", asmt.usageChargePoint === "after-validated-result");
ok("assessment is idempotent + draft-first", asmt.idempotent === true && asmt.draftFirst === true);

// ── buildProvenance (§35) ────────────────────────────────────────────────────
const prov = buildProvenance("generate_assessment");
ok("provenance carries the quadruple + provider + model", prov.promptVersion && prov.schemaVersion && prov.validatorVersion && prov.provider === "anthropic" && prov.model);
ok("provenance curriculumVersion defaults null", prov.curriculumVersion === null);
const prov2 = buildProvenance("generate_assessment", {model: "claude-x", curriculumVersion: "cbc-2023-v6", promptVersion: "assessment-v11"});
ok("provenance overrides win", prov2.model === "claude-x" && prov2.curriculumVersion === "cbc-2023-v6" && prov2.promptVersion === "assessment-v11");
ok("provenance keeps registry values not overridden", prov2.schemaVersion === asmt.schemaVersion);
ok("provenance for unknown op → null", buildProvenance("nope") === null);

console.log(`\n${passed} assertions passed.`);
