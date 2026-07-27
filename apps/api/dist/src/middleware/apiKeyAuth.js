"use strict";
// apps/api/src/middleware/apiKeyAuth.ts
// Protects endpoints that should only be called by trusted systems
// (payment processors, bank feeds, simulators)
//
// API key auth is different from JWT auth:
// - JWT: human users logging into the dashboard
// - API key: machine-to-machine (systems sending transactions to FraudScope)
//
// The key comes in the x-api-key header — standard convention
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiKeyAuth = apiKeyAuth;
function apiKeyAuth(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    // Check the key exists
    if (!apiKey) {
        res.status(401).json({
            error: {
                code: 'UNAUTHORIZED',
                message: 'Missing x-api-key header',
                request_id: req.requestId,
            },
        });
        return;
    }
    // Compare against the configured key
    // In production this would check a database of valid keys
    // For now, one key configured via environment variable
    if (apiKey !== process.env.API_KEY) {
        res.status(401).json({
            error: {
                code: 'UNAUTHORIZED',
                message: 'Invalid API key',
                request_id: req.requestId,
            },
        });
        return;
    }
    next();
}
//# sourceMappingURL=apiKeyAuth.js.map