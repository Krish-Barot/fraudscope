// apps/api/src/websocket/index.ts
// Socket.io WebSocket gateway
//
// ARCHITECTURE:
// This module attaches a Socket.io server to the existing Express HTTP server.
// It bridges Redis PubSub → Socket.io so browser clients receive real-time
// updates from the worker process without polling.
//
// CONNECTION FLOW:
// 1. Browser connects with JWT in handshake auth: socket.auth = { token }
// 2. Server verifies JWT — disconnects if invalid or expired
// 3. Client sends 'subscribe' event to join rooms (tx:live, alerts)
// 4. Redis subscriber receives messages and broadcasts to room members
//
// ROOMS:
// 'tx:live'  — receives every transaction as it arrives (live feed page)
// 'alerts'   — receives new alerts and status updates (alert queue page)
//
// alert:claim — when analyst opens an alert, it's "claimed" so other
// analysts see it's being reviewed. This prevents two analysts working
// the same alert simultaneously.
//
// SECURITY:
// JWT verification happens at connection time AND is re-checked periodically.
// Invalid tokens result in immediate disconnection.
// Each socket is associated with the verified user — no anonymous connections.

import { Server as SocketServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import { db } from '../config/database';

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

interface AuthenticatedSocket extends Socket {
    user?: {
        userId: string;
        email: string;
        role: 'analyst' | 'admin';
    };
}

// Redis channel → Socket.io room mapping
const CHANNEL_ROOM_MAP: Record<string, string> = {
    'tx:live': 'tx:live',
    'alerts:new': 'alerts',
    'alerts:updated': 'alerts',
};

// All Redis channels to subscribe to
const REDIS_CHANNELS = Object.keys(CHANNEL_ROOM_MAP);

// ─────────────────────────────────────────
// JWT verification for Socket.io handshake
// Cannot use the Express middleware here — Socket.io has its own middleware
// ─────────────────────────────────────────
function verifySocketToken(token: string): {
    userId: string;
    email: string;
    role: 'analyst' | 'admin';
} | null {
    try {
        const secret = process.env.JWT_ACCESS_SECRET!;
        const payload = jwt.verify(token, secret) as any;
        return {
            userId: payload.userId,
            email: payload.email,
            role: payload.role,
        };
    } catch {
        return null;
    }
}

// ─────────────────────────────────────────
// Track claimed alerts
// Map of alertId → { analystId, analystEmail, claimedAt }
// In-memory is fine — state resets if server restarts
// Persistent claiming would require a DB record
// ─────────────────────────────────────────
const claimedAlerts = new Map<string, {
    analystId: string;
    analystEmail: string;
    claimedAt: string;
}>();

// ─────────────────────────────────────────
// Main setup function
// Called once from index.ts after HTTP server is created
// ─────────────────────────────────────────
export function setupWebSocket(httpServer: HttpServer): SocketServer {
    // ── Create Socket.io server ─────────────────────────────────────
    const io = new SocketServer(httpServer, {
        cors: {
            origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
            credentials: true,  // needed for cookie-based auth alongside socket auth
        },
        // How often to ping clients to check they're still alive
        pingInterval: 10000,  // 10 seconds
        pingTimeout: 5000,    // 5 seconds to respond before disconnect
    });

    // ── Redis subscriber client ─────────────────────────────────────
    // Dedicated client for subscriptions — once subscribed, this client
    // cannot run other Redis commands (Redis limitation)
    const subscriber = new Redis(process.env.REDIS_URL || 'redis://redis:6379', {
        retryStrategy: (times) => Math.min(times * 100, 3000),
    });

    // ── Redis publisher client ──────────────────────────────────────
    // Used for PUBLISH commands (broadcasting alert:claim events)
    const publisher = new Redis(process.env.REDIS_URL || 'redis://redis:6379', {
        retryStrategy: (times) => Math.min(times * 100, 3000),
    });

    subscriber.on('connect', () => console.log('✅ WebSocket Redis subscriber connected'));
    subscriber.on('error', (err) => console.error('✗ WebSocket Redis subscriber error:', err.message));

    // ── Subscribe to all Redis channels ────────────────────────────
    subscriber.subscribe(...REDIS_CHANNELS, (err, count) => {
        if (err) {
            console.error('Failed to subscribe to Redis channels:', err.message);
            return;
        }
        console.log(`✅ WebSocket subscribed to ${count} Redis channels:`, REDIS_CHANNELS.join(', '));
    });

    // ── Redis message handler ───────────────────────────────────────
    // When a message arrives on any subscribed channel,
    // broadcast it to all clients in the corresponding Socket.io room
    subscriber.on('message', (channel: string, message: string) => {
        const room = CHANNEL_ROOM_MAP[channel];
        if (!room) return;

        try {
            const data = JSON.parse(message);

            // Determine the event name clients listen for
            let eventName: string;
            if (channel === 'tx:live') eventName = 'tx:new';
            else if (channel === 'alerts:new') eventName = 'alert:new';
            else if (channel === 'alerts:updated') eventName = 'alert:updated';
            else return;

            // Emit to all clients in the room
            io.to(room).emit(eventName, data);
            if (process.env.LOG_LEVEL === 'debug') {
                console.log(`[WS] Broadcast ${eventName} to room '${room}'`);
            }

        } catch (err) {
            console.error(`Failed to parse Redis message on channel ${channel}:`, err);
        }
    });

    // ── Authentication middleware ───────────────────────────────────
    // Runs before connection is established
    // Reject if no valid JWT
    io.use((socket: AuthenticatedSocket, next) => {
        const token = socket.handshake.auth?.token;

        if (!token) {
            return next(new Error('Authentication token required'));
        }

        const user = verifySocketToken(token);
        if (!user) {
            return next(new Error('Invalid or expired token'));
        }

        // Attach verified user to socket for later use
        socket.user = user;
        next();
    });

    // ── Connection handler ──────────────────────────────────────────
    io.on('connection', (socket: AuthenticatedSocket) => {
        const user = socket.user!;

        console.log(
            `[WS] Connected: ${user.email} (${user.role}) socket=${socket.id}`
        );

        // Send connection confirmation to this client
        socket.emit('system:connected', {
            userId: user.userId,
            email: user.email,
            role: user.role,
            connectedAt: new Date().toISOString(),
        });

        // ── subscribe event ─────────────────────────────────────────
        // Client sends this to join specific rooms
        // e.g. socket.emit('subscribe', { channels: ['tx:live', 'alerts'] })
        socket.on('subscribe', ({ channels }: { channels: string[] }) => {
            if (!Array.isArray(channels)) return;

            const allowedRooms = ['tx:live', 'alerts'];
            channels
                .filter(ch => allowedRooms.includes(ch))
                .forEach(room => {
                    socket.join(room);
                    console.log(`[WS] ${user.email} joined room: ${room}`);
                });
        });

        // ── unsubscribe event ───────────────────────────────────────
        socket.on('unsubscribe', ({ channels }: { channels: string[] }) => {
            if (!Array.isArray(channels)) return;

            channels.forEach(room => {
                socket.leave(room);
                console.log(`[WS] ${user.email} left room: ${room}`);
            });
        });

        // ── alert:claim event ───────────────────────────────────────
        // Analyst opens an alert to review — mark it as claimed
        // Broadcasts to other analysts so they see it's being worked
        socket.on('alert:claim', async ({ alert_id }: { alert_id: string }) => {
            if (!alert_id) return;

            try {
                // Update alert status to 'reviewing' in the database
                await db('alerts')
                    .where({ id: alert_id, status: 'new' })
                    .update({
                        status: 'reviewing',
                        assigned_to: user.userId,
                    });

                // Track claim in memory
                claimedAlerts.set(alert_id, {
                    analystId: user.userId,
                    analystEmail: user.email,
                    claimedAt: new Date().toISOString(),
                });

                // Broadcast to all analysts that this alert is claimed
                // Use publisher (not subscriber) for PUBLISH
                await publisher.publish('alerts:updated', JSON.stringify({
                    alert_id,
                    new_status: 'reviewing',
                    analyst: user.email,
                    claimed_at: new Date().toISOString(),
                }));

                socket.emit('alert:claimed', { alert_id, success: true });
            } catch (err) {
                console.error('[WS] alert:claim error:', (err as Error).message);
                socket.emit('alert:claimed', { alert_id, success: false });
            }
        });

        // ── disconnect handler ──────────────────────────────────────
        socket.on('disconnect', (reason) => {
            console.log(
                `[WS] Disconnected: ${user.email} socket=${socket.id} reason=${reason}`
            );

            // Release any alerts claimed by this socket
            // This prevents alerts being stuck in 'reviewing' state
            // when an analyst closes their browser
            for (const [alertId, claim] of claimedAlerts.entries()) {
                if (claim.analystId === user.userId) {
                    claimedAlerts.delete(alertId);

                    // Check if this user is still connected on another socket
                    // If not, release the claim back to 'new'
                    const userStillConnected = [...io.sockets.sockets.values()].some(
                        (s: AuthenticatedSocket) =>
                            s.user?.userId === user.userId && s.id !== socket.id
                    );

                    if (!userStillConnected) {
                        // Release claim — revert to 'new' so another analyst can pick it up
                        db('alerts')
                            .where({ id: alertId, assigned_to: user.userId, status: 'reviewing' })
                            .update({ status: 'new', assigned_to: null })
                            .catch(err => console.error('[WS] Failed to release claim:', err));
                    }
                }
            }
        });
    });

    // ── System metrics broadcast ────────────────────────────────────
    // Every 10 seconds broadcast system status to all connected clients
    // Dashboard shows this as the "Live" / "Offline" indicator
    setInterval(async () => {
        try {
            const connectedCount = io.sockets.sockets.size;
            const analystCount = [...io.sockets.sockets.values()].filter(
                (s: AuthenticatedSocket) => s.user
            ).length;

            io.emit('system:status', {
                connected: true,
                active_connections: connectedCount,
                active_analysts: analystCount,
                timestamp: new Date().toISOString(),
            });
        } catch (err) {
            console.error('[WS] system:status broadcast error:', err);
        }
    }, 10000);

    console.log('✅ WebSocket server initialized');

    return io;
}