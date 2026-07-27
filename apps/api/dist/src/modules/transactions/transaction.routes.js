"use strict";
// apps/api/src/modules/transactions/transaction.routes.ts
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const apiKeyAuth_1 = require("../../middleware/apiKeyAuth");
const authenticate_1 = require("../../middleware/authenticate");
const authorize_1 = require("../../middleware/authorize");
const transaction_controller_1 = require("./transaction.controller");
const router = (0, express_1.Router)();
// POST /api/v1/transactions
// Machine-to-machine — protected by API key
router.post('/', apiKeyAuth_1.apiKeyAuth, transaction_controller_1.createTransaction);
// GET /api/v1/transactions
// Human analyst — protected by JWT
// authorize('analyst', 'admin') means both roles can access
router.get('/', authenticate_1.authenticate, (0, authorize_1.authorize)('analyst', 'admin'), transaction_controller_1.getTransactions);
// GET /api/v1/transactions/:id
router.get('/:id', authenticate_1.authenticate, (0, authorize_1.authorize)('analyst', 'admin'), transaction_controller_1.getTransaction);
exports.default = router;
//# sourceMappingURL=transaction.routes.js.map