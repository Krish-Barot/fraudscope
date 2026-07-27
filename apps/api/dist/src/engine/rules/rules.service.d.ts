import { CreateRuleInput, UpdateRuleInput } from './rules.schema';
export declare function validateRuleParameters(type: string, parameters: Record<string, unknown>): void;
export declare function listRules(filters: {
    type?: string;
    severity?: string;
    is_active?: boolean;
}): Promise<any[]>;
export declare function getRuleById(id: string): Promise<any>;
export declare function createRule(input: CreateRuleInput, actorId: string): Promise<any>;
export declare function updateRule(id: string, input: UpdateRuleInput, actorId: string): Promise<any>;
export declare function toggleRule(id: string, is_active: boolean, actorId: string): Promise<any>;
export declare function deleteRule(id: string, actorId: string): Promise<{
    deleted: boolean;
    alertCount?: number;
}>;
//# sourceMappingURL=rules.service.d.ts.map