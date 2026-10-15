import { Body, Controller, Delete, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { WorkflowDocument } from '@workflow/shared-types';
import { NodeService } from './nodes';
import { WorkflowsService } from './workflows.service';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard';

@Controller()
export class AppController {
  constructor(@Inject(WorkflowsService) private readonly workflows: WorkflowsService, @Inject(NodeService) private readonly nodes: NodeService) {}
  @Get('health') health(): { status: string } { return { status: 'ok' }; }
  @Get('capabilities') @UseGuards(AuthGuard) capabilities(): unknown { return { aiConfigured: Boolean(process.env.GROQ_API_KEY) }; }
  @Get('nodes') listNodes(): unknown { return this.nodes.list(); }
  @Get('workflow-templates') @UseGuards(AuthGuard) templates(): unknown { return this.workflows.listTemplates(); }
  @Post('workflow-templates/:templateId/instantiate') @UseGuards(AuthGuard) instantiateTemplate(@Param('templateId') templateId: string, @Req() request: AuthenticatedRequest): Promise<WorkflowDocument> { return this.workflows.instantiateTemplate(templateId, request.user.id); }
  @Get('workflows') @UseGuards(AuthGuard) list(@Req() request: AuthenticatedRequest): Promise<WorkflowDocument[]> { return this.workflows.list(request.user.id); }
  @Get('workflows/:id') @UseGuards(AuthGuard) get(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<WorkflowDocument> { return this.workflows.get(id, request.user.id); }
  @Post('workflows') @UseGuards(AuthGuard) save(@Body() workflow: WorkflowDocument, @Req() request: AuthenticatedRequest): Promise<WorkflowDocument> { return this.workflows.save(workflow, request.user.id); }
  @Post('workflows/validate') validate(@Body() workflow: WorkflowDocument): { valid: boolean; errors: string[] } { const errors = this.workflows.validate(workflow); return { valid: errors.length === 0, errors }; }
  @Post('workflows/:id/execute') @UseGuards(AuthGuard) execute(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<{ executionId: string; status: string }> { return this.workflows.execute(id, request.user.id); }
  @Post('webhooks/:workflowId/:triggerId') webhook(@Param('workflowId') workflowId: string, @Param('triggerId') triggerId: string, @Body() body: unknown): Promise<{ executionId: string; status: string }> { return this.workflows.triggerWebhook(workflowId, triggerId, body); }
  @Delete('workflows/:id') @UseGuards(AuthGuard) remove(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<void> { return this.workflows.remove(id, request.user.id); }
  @Post('workflows/:id/duplicate') @UseGuards(AuthGuard) duplicate(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<WorkflowDocument> { return this.workflows.duplicate(id, request.user.id); }
  @Post('workflows/:id/activate') @UseGuards(AuthGuard) activate(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<WorkflowDocument> { return this.workflows.setActive(id, true, request.user.id); }
  @Post('workflows/:id/deactivate') @UseGuards(AuthGuard) deactivate(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<WorkflowDocument> { return this.workflows.setActive(id, false, request.user.id); }
  @Get('executions') @UseGuards(AuthGuard) executions(@Req() request: AuthenticatedRequest): Promise<unknown> { return this.workflows.listExecutions(request.user.id); }
  @Get('executions/:id') @UseGuards(AuthGuard) execution(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.workflows.getExecution(id, request.user.id); }
  @Post('executions/:id/cancel') @UseGuards(AuthGuard) cancel(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.workflows.cancel(id, request.user.id); }
}