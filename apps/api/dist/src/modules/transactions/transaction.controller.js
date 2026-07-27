"use strict";
// apps/api/src/modules/transactions/transaction.controller.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTransaction = createTransaction;
exports.getTransactions = getTransactions;
exports.getTransaction = getTransaction;
const zod_1 = require("zod");
const transaction_schema_1 = require("./transaction.schema");
const transaction_service_1 = require("./transaction.service");
// POST /api/v1/transactions — FS-04 (unchanged)
async function createTransaction(req, res, next) {
    try {
        const input = transaction_schema_1.createTransactionSchema.parse(req.body);
        const transaction = await (0, transaction_service_1.ingestTransaction)(input);
        res.status(202).json({
            transaction,
            queued: true,
            message: 'Transaction accepted and queued for fraud evaluation',
        });
    }
    catch (error) {
        if (error instanceof zod_1.ZodError) {
            res.status(400).json({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Invalid transaction payload',
                    details: error.errors.map((e) => ({
                        field: e.path.join('.'),
                        message: e.message,
                    })),
                    request_id: req.requestId,
                    timestamp: new Date().toISOString(),
                },
            });
            return;
        }
        if (error.code === '23505') {
            res.status(409).json({
                error: {
                    code: 'CONFLICT',
                    message: `Transaction with external_id '${req.body.external_id}' already exists`,
                    request_id: req.requestId,
                    timestamp: new Date().toISOString(),
                },
            });
            return;
        }
        next(error);
    }
}
// GET /api/v1/transactions — FS-05
async function getTransactions(req, res, next) {
    try {
        // Parse and sanitize query parameters
        // req.query values are always strings — convert numbers explicitly
        const filters = {
            status: req.query.status,
            min_amount: req.query.min_amount
                ? Number(req.query.min_amount)
                : undefined,
            max_amount: req.query.max_amount
                ? Number(req.query.max_amount)
                : undefined,
            country_code: req.query.country_code,
            account_id: req.query.account_id,
            channel: req.query.channel,
            page: req.query.page ? Number(req.query.page) : 1,
            limit: req.query.limit ? Number(req.query.limit) : 25,
            sort: req.query.sort,
        };
        const result = await (0, transaction_service_1.listTransactions)(filters);
        res.status(200).json(result);
    }
    catch (error) {
        next(error);
    }
}
// GET /api/v1/transactions/:id — FS-05
async function getTransaction(req, res, next) {
    try {
        const result = await (0, transaction_service_1.getTransactionById)(req.params.id);
        if (!result) {
            res.status(404).json({
                error: {
                    code: 'NOT_FOUND',
                    message: `Transaction ${req.params.id} not found`,
                    request_id: req.requestId,
                },
            });
            return;
        }
        res.status(200).json(result);
    }
    catch (error) {
        next(error);
    }
}
//# sourceMappingURL=transaction.controller.js.map