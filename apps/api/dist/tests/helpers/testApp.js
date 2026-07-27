"use strict";
// apps/api/tests/helpers/testApp.ts
// Creates a fresh Express app instance for testing
//
// Why not import the main app from index.ts?
// index.ts calls app.listen() which starts a real server on a port.
// For testing, supertest manages the server internally — we just need
// the Express app object, not a running server.
// Supertest calls app.listen(0) internally which picks a random free port.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTestApp = createTestApp;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const requestId_1 = require("../../src/middleware/requestId");
const errorHandler_1 = require("../../src/middleware/errorHandler");
const transaction_routes_1 = __importDefault(require("../../src/modules/transactions/transaction.routes"));
function createTestApp() {
    const app = (0, express_1.default)();
    app.use(requestId_1.requestIdMiddleware);
    app.use(express_1.default.json());
    app.use((0, cors_1.default)());
    app.get('/health', (req, res) => {
        res.json({ status: 'ok' });
    });
    app.use('/api/v1/transactions', transaction_routes_1.default);
    app.use(errorHandler_1.errorHandler);
    return app;
}
//# sourceMappingURL=testApp.js.map