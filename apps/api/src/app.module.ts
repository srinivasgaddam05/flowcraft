import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { NodeService } from './nodes';
import { PrismaService } from './prisma.service';
import { WorkflowsService } from './workflows.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { ExecutionEventsService } from './execution-events.service';
import { QueueService } from './queue.service';
import { ExecutionGateway } from './execution.gateway';
@Module({ controllers: [AppController, AuthController], providers: [PrismaService, NodeService, WorkflowsService, AuthService, AuthGuard, ExecutionEventsService, QueueService, ExecutionGateway] })
export class AppModule {}