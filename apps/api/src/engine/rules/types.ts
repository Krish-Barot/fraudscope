// apps/api/src/engine/rules/types.ts
// Shared types for all rule modules
//
// Every rule must implement the RuleEvaluator interface.
// This contract means the scorer can call any rule the same way
// without knowing which specific rule it is.
// Adding a new rule = create a new file, export evaluate + parameterSchema.
// The scorer picks it up automatically from the DB.
// apps/api/src/engine/rules/types.ts

import { z } from "zod";
import Redis from "ioredis";
import { Knex } from "knex";

export interface TransactionData {
  id: string;
  external_id: string;
  account_id: string;
  amount: number;
  currency: string;
  country_code: string;
  channel: string;
  created_at: string;
  merchant_name?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  ip_address?: string;
}

export interface RuleContext {
  redis: Redis;
  db: Knex;
  // Severity of the rule as configured in the database
  // Used by rules to return the correct fixed score
  severity: "low" | "medium" | "high" | "critical";
}

export interface RuleResult {
  triggered: boolean;
  score: number;
  details: Record<string, unknown>;
}

export interface RuleEvaluator {
  parameterSchema: z.ZodObject<any>;
  evaluate: (
    transaction: TransactionData,
    parameters: Record<string, unknown>,
    context: RuleContext,
  ) => Promise<RuleResult>;
}

export interface DbRule {
  id: string;
  name: string;
  type: string;
  parameters: Record<string, unknown>;
  severity: "low" | "medium" | "high" | "critical";
  score_weight: number;
  is_active: boolean;
}

// Maps severity to fixed score contribution
// Every rule uses this same mapping per the spec
export function severityToScore(severity: string): number {
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
