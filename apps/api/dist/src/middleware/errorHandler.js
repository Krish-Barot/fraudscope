"use strict";
// apps/api/src/middleware/errorHandler.ts
// Global error handler — catches any error thrown in route handlers
// Must be registered LAST (after all routes) in Express
// Must have 4 parameters (err, req, res, next) — Express identifies it by arity
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppError = void 0;
exports.errorHandler = errorHandler;
// Custom error class so we can attach HTTP status codes to errors
class AppError extends Error {
    statusCode;
    code;
    constructor(statusCode, code, message) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.name = 'AppError';
    }
}
exports.AppError = AppError;
function errorHandler(err, req, res, next // eslint-disable-line @typescript-eslint/no-unused-vars
) {
    // Handle our custom errors (thrown intentionally)
    if (err instanceof AppError) {
        res.status(err.statusCode).json({
            error: {
                code: err.code,
                message: err.message,
                request_id: req.requestId,
                timestamp: new Date().toISOString(),
            },
        });
        return;
    }
    // Handle PostgreSQL unique constraint violations
    // Error code 23505 is PostgreSQL's code for unique_violation
    if (err.code === '23505') {
        res.status(409).json({
            error: {
                code: 'CONFLICT',
                message: 'A record with this identifier already exists',
                request_id: req.requestId,
                timestamp: new Date().toISOString(),
            },
        });
        return;
    }
    // Unexpected errors — log them and return a generic message
    // Never expose internal error details to the client
    console.error('Unhandled error:', {
        error: err.message,
        stack: err.stack,
        request_id: req.requestId,
        path: req.path,
        method: req.method,
    });
    res.status(500).json({
        error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
            request_id: req.requestId,
            timestamp: new Date().toISOString(),
        },
    });
}
//# sourceMappingURL=errorHandler.js.map