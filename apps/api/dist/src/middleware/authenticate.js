"use strict";
// apps/api/src/middleware/authenticate.ts
// Verifies JWT tokens on protected routes
// Attaches the decoded user payload to req.user
// so downstream handlers know who is making the request
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
function authenticate(req, res, next) {
    // JWT comes in the Authorization header as "Bearer <token>"
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
            error: {
                code: 'UNAUTHORIZED',
                message: 'Missing or invalid Authorization header. Expected: Bearer <token>',
                request_id: req.requestId,
            },
        });
        return;
    }
    // Extract just the token part (remove "Bearer " prefix)
    const token = authHeader.split(' ')[1];
    try {
        // jwt.verify() does two things:
        // 1. Checks the signature — was this token actually signed by us?
        // 2. Checks expiry — has the token expired?
        // If either fails, it throws an error
        const secret = process.env.JWT_ACCESS_SECRET;
        if (!secret) {
            throw new Error('JWT_ACCESS_SECRET not configured');
        }
        const decoded = jsonwebtoken_1.default.verify(token, secret);
        // Attach user info to the request object
        // Now any route handler can access req.user.role, req.user.userId, etc.
        req.user = decoded;
        next();
    }
    catch (error) {
        if (error instanceof jsonwebtoken_1.default.TokenExpiredError) {
            res.status(401).json({
                error: {
                    code: 'TOKEN_EXPIRED',
                    message: 'Your session has expired. Please log in again.',
                    request_id: req.requestId,
                },
            });
            return;
        }
        if (error instanceof jsonwebtoken_1.default.JsonWebTokenError) {
            res.status(401).json({
                error: {
                    code: 'INVALID_TOKEN',
                    message: 'Invalid token',
                    request_id: req.requestId,
                },
            });
            return;
        }
        next(error);
    }
}
//# sourceMappingURL=authenticate.js.map