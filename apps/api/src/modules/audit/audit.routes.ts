// apps/api/src/modules/audit/audit.routes.ts

import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { getAuditLogs, exportAuditLogs } from './audit.controller';
import { db } from '../../config/database';

const router = Router();

// Both endpoints admin-only — audit logs are sensitive
router.get('/', authenticate, authorize('admin'), getAuditLogs);
router.get('/export', authenticate, authorize('admin'), exportAuditLogs);
router.get('/users', authenticate, authorize('admin'), async (req, res, next) => {
    try {
        const users = await db('users')
            .select('id', 'email', 'first_name', 'last_name', 'role', 'is_active', 'last_login_at', 'created_at')
            .orderBy('created_at', 'desc');
        res.json({ users });
    } catch (err) { next(err); }
});

router.patch('/users/:id', authenticate, authorize('admin'), async (req: any, res, next) => {
    try {
        const { role, is_active } = req.body;
        const [user] = await db('users')
            .where({ id: req.params.id })
            .update({ role, is_active, updated_at: db.fn.now() })
            .returning(['id', 'email', 'first_name', 'last_name', 'role', 'is_active', 'last_login_at']);
        if (!user) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } }); return; }
        res.json({ user });
    } catch (err) { next(err); }
});

export default router;