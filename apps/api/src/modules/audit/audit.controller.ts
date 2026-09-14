// apps/api/src/modules/audit/audit.controller.ts

import { Request, Response, NextFunction } from 'express';
import { db } from '../../config/database';

const AUDIT_LOG_COLUMNS = [
  'audit_logs.*',
  'users.email as actor_email',
  'users.first_name as actor_first_name',
  'users.last_name as actor_last_name',
];

// ─────────────────────────────────────────
// Build base query with all filters applied
// Shared between list and export endpoints
// ─────────────────────────────────────────
function buildQuery(query: Record<string, any>) {
  let q = db('audit_logs')
    .leftJoin('users', 'audit_logs.actor_id', 'users.id');


  // Search: event_type, target_type, target_id, actor name/email, or payload
  if (query.search) {
    const term = `%${query.search}%`;
    q = q.where(function () {
      this.where('audit_logs.event_type', 'ilike', term)
        .orWhere('audit_logs.target_type', 'ilike', term)
        .orWhereRaw('audit_logs.target_id::text ilike ?', [term])
        .orWhere('users.email', 'ilike', term)
        .orWhere('users.first_name', 'ilike', term)
        .orWhere('users.last_name', 'ilike', term)
        .orWhereRaw('audit_logs.payload::text ilike ?', [term]);
    });
  }

  // Event type filter
  if (query.event_type) {
    q = q.where('audit_logs.event_type', query.event_type);
  }

  // Category filter (e.g. 'alert', 'transaction', 'rule', 'user')
  if (query.category) {
    q = q.where('audit_logs.event_type', 'ilike', `${query.category}.%`);
  }

  // Actor filter
  if (query.actor_id) {
    if (query.actor_id === 'system') {
      q = q.whereNull('audit_logs.actor_id');
    } else {
      q = q.where('audit_logs.actor_id', query.actor_id);
    }
  }

  // Date range
  if (query.from) {
    q = q.where('audit_logs.created_at', '>=', new Date(query.from));
  }
  if (query.to) {
    q = q.where('audit_logs.created_at', '<=', new Date(query.to));
  }

  return q;
}

// GET /api/v1/audit-logs
export async function getAuditLogs(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const page  = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
    const offset = (page - 1) * limit;

    const baseQuery = buildQuery(req.query as Record<string, any>);

    // Count total matching rows
    const [{ count }] = await baseQuery.clone().count('audit_logs.id as count');
    const total = parseInt(count as string, 10);

    // Paginated results
    const rows = await baseQuery
      .select(AUDIT_LOG_COLUMNS)
      .orderBy('audit_logs.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    const data = rows.map((row: any) => ({
      id:          row.id,
      event_type:  row.event_type,
      actor_type:  row.actor_type,
      actor_id:    row.actor_id,
      actor: row.actor_email
        ? {
            id:         row.actor_id,
            email:      row.actor_email,
            first_name: row.actor_first_name,
            last_name:  row.actor_last_name,
          }
        : null,
      target_type: row.target_type,
      target_id:   row.target_id,
      payload: typeof row.payload === 'string'
        ? JSON.parse(row.payload)
        : row.payload,
      ip_address:  row.ip_address,
      source:      row.source,
      created_at:  row.created_at,
    }));

    res.status(200).json({
      data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/audit-logs/export
// Returns CSV file download
export async function exportAuditLogs(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const rows = await buildQuery(req.query as Record<string, any>)
      .select(AUDIT_LOG_COLUMNS)
      .orderBy('audit_logs.created_at', 'desc')
      .limit(10000);

    // Build CSV
    const headers = ['timestamp', 'event_type', 'actor', 'target_type', 'target_id', 'source', 'ip_address', 'details'];
    const csvRows = rows.map((row: any) => {
      const actor = row.actor_email || (row.actor_type === 'system' ? 'System/Engine' : row.actor_id || 'Unknown');
      const details = typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload);

      return [
        new Date(row.created_at).toISOString(),
        row.event_type,
        actor,
        row.target_type || '',
        row.target_id || '',
        row.source || '',
        row.ip_address || '',
        `"${details.replace(/"/g, '""')}"`,  // escape quotes in JSON
      ].join(',');
    });

    const csv = [headers.join(','), ...csvRows].join('\n');
    const filename = `fraudscope-audit-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csv);
  } catch (error) {
    next(error);
  }
}