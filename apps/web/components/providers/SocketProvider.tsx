// apps/web/components/providers/SocketProvider.tsx
// Initializes the WebSocket connection for the dashboard
// Wraps dashboard pages so socket is available everywhere
'use client';

import { useEffect } from 'react';
import { useSocket, ServerToClientEvents } from '../../hooks/useSocket';
import { useAuth } from '../../lib/authContext';

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { connected, emit, on, off } = useSocket();
  const { user } = useAuth();

  // Subscribe to rooms and listen for real-time events when connected
  useEffect(() => {
    if (!connected || !user) return;

    // Join both rooms — all dashboard pages benefit from these
    emit('subscribe', { channels: ['tx:live', 'alerts'] });

    console.log('[SocketProvider] Subscribed to rooms: tx:live, alerts');

    const handleTxNew: ServerToClientEvents['tx:new'] = (data) => {
      console.log('[Socket.io] New transaction (tx:new):', data);
    };

    const handleAlertNew: ServerToClientEvents['alert:new'] = (data) => {
      console.log('[Socket.io] New alert (alert:new):', data);
    };

    on('tx:new', handleTxNew);
    on('alert:new', handleAlertNew);

    return () => {
      off('tx:new', handleTxNew);
      off('alert:new', handleAlertNew);
    };
  }, [connected, user, emit, on, off]);

  return <>{children}</>;
}