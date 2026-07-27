"use strict";
// apps/api/src/index.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// ── Env validation FIRST ──────────────────────────────────────────
// Must run before any other module that reads process.env
// If validation fails, process.exit(1) is called here and nothing else runs
const env_1 = require("./config/env");
const env = (0, env_1.validateApiEnv)();
// ─────────────────────────────────────────────────────────────────
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const database_1 = require("./config/database");
const requestId_1 = require("./middleware/requestId");
const errorHandler_1 = require("./middleware/errorHandler");
const transaction_routes_1 = __importDefault(require("./modules/transactions/transaction.routes"));
const app = (0, express_1.default)();
app.use(requestId_1.requestIdMiddleware);
app.use(express_1.default.json());
app.use((0, cors_1.default)({
    origin: env.CORS_ORIGIN,
    credentials: true,
}));
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'fraudscope-api',
        timestamp: new Date().toISOString(),
        request_id: req.requestId,
    });
});
app.use('/api/v1/transactions', transaction_routes_1.default);
app.use(errorHandler_1.errorHandler);
async function start() {
    await (0, database_1.connectDatabase)();
    app.listen(env.PORT, () => {
        console.log(`✓ FraudScope API running on port ${env.PORT}`);
    });
}
start().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map