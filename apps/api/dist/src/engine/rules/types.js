"use strict";
// apps/api/src/engine/rules/types.ts
// Shared types for all rule modules
//
// Every rule must implement the RuleEvaluator interface.
// This contract means the scorer can call any rule the same way
// without knowing which specific rule it is.
// Adding a new rule = create a new file, export evaluate + parameterSchema.
// The scorer picks it up automatically from the DB.
// apps/api/src/engine/rules/types.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.severityToScore = severityToScore;
// Maps severity to fixed score contribution
// Every rule uses this same mapping per the spec
function severityToScore(severity) {
    switch (severity) {
        case "critical":
            return 30;
        case "high":
            return 25;
        case "medium":
            return 20;
        case "low":
            return 15;
        default:
            return 15;
    }
}
//# sourceMappingURL=types.js.map