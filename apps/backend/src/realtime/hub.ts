import type { Role } from '../types/domain.js';
import type { RealtimeHub, SocketLike } from '../types/deps.js';
import type { RealtimeMessage } from '../types/realtime.js';

interface Connection {
  uid: string;
  role: Role;
  socket: SocketLike;
}

const OPEN = 1;

/**
 * Authenticated realtime fan-out. Messages carry only data the recipient is
 * allowed to see; admin messages are only delivered to sockets whose role was
 * resolved from verified claims at connection time.
 */
export class Hub implements RealtimeHub {
  private readonly connections = new Set<Connection>();

  register(uid: string, role: Role, socket: SocketLike): void {
    this.connections.add({ uid, role, socket });
    this.send(socket, {
      type: 'ready',
      serverTime: new Date().toISOString(),
    });
  }

  unregister(socket: SocketLike): void {
    for (const connection of this.connections) {
      if (connection.socket === socket) this.connections.delete(connection);
    }
  }

  publishToUser(uid: string, message: RealtimeMessage): void {
    for (const connection of this.connections) {
      if (connection.uid === uid) this.send(connection.socket, message);
    }
  }

  publishToAdmins(message: RealtimeMessage): void {
    for (const connection of this.connections) {
      if (connection.role === 'admin') this.send(connection.socket, message);
    }
  }

  connectionCount(): number {
    return this.connections.size;
  }

  private send(socket: SocketLike, message: RealtimeMessage): void {
    if (socket.readyState !== OPEN) return;
    try {
      socket.send(JSON.stringify(message));
    } catch {
      this.unregister(socket);
    }
  }
}
