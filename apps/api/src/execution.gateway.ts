import { Inject } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, OnGatewayConnection } from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { Server, WebSocket } from 'ws';
import type { ExecutionEvent } from '@workflow/shared-types';
import { ExecutionEventsService } from './execution-events.service';
import { AuthService } from './auth.service';
import { WorkflowsService } from './workflows.service';

@WebSocketGateway({ cors: true })
export class ExecutionGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  private readonly owners = new WeakMap<WebSocket, string>();
  constructor(@Inject(ExecutionEventsService) events: ExecutionEventsService, @Inject(AuthService) private readonly auth: AuthService, @Inject(WorkflowsService) private readonly workflows: WorkflowsService) {
    events.subscribe((event) => { void this.broadcast(event); });
  }
  handleConnection(client: WebSocket, request: IncomingMessage): void {
    try {
      const token = new URL(request.url ?? '/', 'http://localhost').searchParams.get('token');
      if (!token) throw new Error('Authentication required');
      this.owners.set(client, this.auth.verify(token).id);
    } catch { client.close(1008, 'Authentication required'); }
  }
  private async broadcast(event: ExecutionEvent): Promise<void> {
    if (!this.server) return;
    for (const client of this.server.clients) {
      const ownerId = this.owners.get(client);
      if (client.readyState !== 1 || !ownerId) continue;
      try { await this.workflows.getExecution(event.executionId, ownerId); if (client.readyState === 1) client.send(JSON.stringify(event)); }
      catch { /* A different account owns this execution. */ }
    }
  }
}
