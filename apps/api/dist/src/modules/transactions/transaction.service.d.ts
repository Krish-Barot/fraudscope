import { CreateTransactionInput } from './transaction.schema';
export declare function ingestTransaction(input: CreateTransactionInput): Promise<any>;
export interface ListTransactionsFilters {
    status?: string;
    min_amount?: number;
    max_amount?: number;
    country_code?: string;
    account_id?: string;
    channel?: string;
    page?: number;
    limit?: number;
    sort?: string;
}
export declare function listTransactions(filters: ListTransactionsFilters): Promise<{
    data: any[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
    };
}>;
export declare function getTransactionById(id: string): Promise<any>;
//# sourceMappingURL=transaction.service.d.ts.map