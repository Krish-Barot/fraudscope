"use strict";
// apps/api/src/middleware/requestId.ts
// Attaches a unique ID to every incoming request
// This lets you search logs for all events related to one request
// e.g. "show me everything that happened during request abc-123"
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestIdMiddleware = requestIdMiddleware;
const uuid_1 = require("uuid");
function requestIdMiddleware(req, res, next) {
    // Check if the caller sent their own request ID (useful for tracing across services)
    // Otherwise generate a new one
    req.requestId = req.headers['x-request-id'] || (0, uuid_1.v4)();
    // Send it back in the response so the caller can correlate their request
    res.setHeader('x-request-id', req.requestId);
    next(); // pass control to the next middleware
}
//# sourceMappingURL=requestId.js.map