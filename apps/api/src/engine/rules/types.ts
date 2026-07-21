// apps/api/src/engine/rules/types.ts
// Shared types for all rule modules
//
// Every rule must implement the RuleEvaluator interface.
// This contract means the scorer can call any rule the same way
// without knowing which specific rule it is.
// Adding a new rule = create a new file, export evaluate + parameterSchema.
// The scorer picks it up automatically from the DB.

import { z } from 'zod';
import Redis from 'ioredis';
import { Knex } from 'knex';

// The transaction data passed to every rule
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

// Dependencies injected into each rule's evaluate function
// Rules need Redis for caching and counters, DB for historical queries
export interface RuleContext {
  redis: Redis;
  db: Knex;
}

// What every rule's evaluate() must return
export interface RuleResult {
  triggered: boolean;               // did this rule fire?
  score: number;                    // how many points to add (0 if not triggered)
  details: Record<string, unknown>; // explanation for the alert_rules table
}

// The interface every rule module must implement
export interface RuleEvaluator {
  parameterSchema: z.ZodObject<any>;
  evaluate: (
    transaction: TransactionData,
    parameters: Record<string, unknown>,
    context: RuleContext
  ) => Promise<RuleResult>;
}

// A rule as loaded from the database
export interface DbRule {
  id: string;
  name: string;
  type: string;
  parameters: Record<string, unknown>;
  severity: string;
  score_weight: number;
  is_active: boolean;
}