"use strict";
// apps/api/src/modules/rules/rules.routes.ts
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authenticate_1 = require("../../middleware/authenticate");
const authorize_1 = require("../../middleware/authorize");
const rules_controller_1 = require("./rules.controller");
const router = (0, express_1.Router)();
// GET /api/v1/rules — analysts and admins can list rules
router.get('/', authenticate_1.authenticate, (0, authorize_1.authorize)('analyst', 'admin'), rules_controller_1.getRules);
// GET /api/v1/rules/:id — analysts and admins can view rule detail + stats
router.get('/:id', authenticate_1.authenticate, (0, authorize_1.authorize)('analyst', 'admin'), rules_controller_1.getRule);
// POST /api/v1/rules — admin only
router.post('/', authenticate_1.authenticate, (0, authorize_1.authorize)('admin'), rules_controller_1.postRule);
// PUT /api/v1/rules/:id — admin only
router.put('/:id', authenticate_1.authenticate, (0, authorize_1.authorize)('admin'), rules_controller_1.putRule);
// PATCH /api/v1/rules/:id/toggle — admin only
// Note: this route must come BEFORE /:id to avoid Express matching 'toggle' as an ID
router.patch('/:id/toggle', authenticate_1.authenticate, (0, authorize_1.authorize)('admin'), rules_controller_1.patchRuleToggle);
// DELETE /api/v1/rules/:id — admin only
router.delete('/:id', authenticate_1.authenticate, (0, authorize_1.authorize)('admin'), rules_controller_1.removeRule);
exports.default = router;
//# sourceMappingURL=rules.routes.js.map