import { randomUUID } from 'node:crypto';
import type { WorkflowDocument } from '@workflow/shared-types';

interface TemplateNode {
  key: string;
  type: string;
  name: string;
  config?: Record<string, unknown>;
}

interface TemplateEdge {
  source: string;
  target: string;
  sourceHandle?: 'true' | 'false';
}

export interface WorkflowTemplateInputField {
  name: string;
  type: 'string' | 'number';
  required: boolean;
  description: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  summary: string;
  description: string;
  inputFields: WorkflowTemplateInputField[];
  inputExample: Record<string, unknown>;
  expectedOutputs: string[];
  requiresAi: boolean;
  nodes: TemplateNode[];
  edges: TemplateEdge[];
}

const templates: WorkflowTemplate[] = [
  {
    id: 'support-ticket-triage',
    name: 'Customer Support Triage',
    summary: 'Classify a customer issue and draft a careful first reply.',
    description: 'Accepts a support ticket, identifies its category and urgency, drafts a grounded response, and flags cases that need a person.',
    inputFields: [
      { name: 'customerMessage', type: 'string', required: true, description: 'The customer’s message or problem.' },
      { name: 'ticketId', type: 'string', required: false, description: 'An identifier from the support system.' },
      { name: 'orderStatus', type: 'string', required: false, description: 'Known order status, if available.' },
    ],
    inputExample: {
      ticketId: 'ticket-1042',
      customerMessage: 'My parcel arrived damaged. Please help me replace it.',
      orderStatus: 'delivered',
    },
    expectedOutputs: ['category', 'urgency', 'summary', 'suggestedReply', 'needsHumanReview', 'evidence'],
    requiresAi: true,
    nodes: [
      { key: 'trigger', type: 'webhookTrigger', name: 'Support Ticket Received' },
      {
        key: 'triage',
        type: 'groqChat',
        name: 'Triage Ticket',
        config: {
          instructions: 'You triage customer-support tickets. Use only facts in the supplied input. Return JSON with category (delivery|damaged_item|billing|account|other), urgency (low|normal|high), summary, suggestedReply, needsHumanReview (boolean), and evidence (array of facts from the input). Never promise a refund, replacement, or policy exception. Set needsHumanReview true when the case needs a policy decision or information is missing.',
        },
      },
      { key: 'result', type: 'logger', name: 'Support Triage Result', config: { message: 'Ticket triage complete; review the suggested reply before sending.' } },
    ],
    edges: [{ source: 'trigger', target: 'triage' }, { source: 'triage', target: 'result' }],
  },
  {
    id: 'lead-qualification',
    name: 'Lead Qualification',
    summary: 'Score an enquiry and route priority leads separately.',
    description: 'Reviews a sales enquiry, scores its fit from 0–100 using only submitted facts, and routes high-fit leads to priority follow-up.',
    inputFields: [
      { name: 'need', type: 'string', required: true, description: 'What the prospective customer is trying to accomplish.' },
      { name: 'contactName', type: 'string', required: false, description: 'Contact name, if provided.' },
      { name: 'company', type: 'string', required: false, description: 'Company name, if provided.' },
      { name: 'timeline', type: 'string', required: false, description: 'Their stated purchase or project timeline.' },
      { name: 'budget', type: 'string', required: false, description: 'Their stated budget or budget status.' },
    ],
    inputExample: {
      contactName: 'Jordan Lee',
      company: 'Northstar Bikes',
      need: 'We need a workflow platform for a 25-person customer success team.',
      timeline: 'This quarter',
      budget: 'Approved',
    },
    expectedOutputs: ['qualificationScore', 'fitSummary', 'keyNeeds', 'recommendedNextStep'],
    requiresAi: true,
    nodes: [
      { key: 'trigger', type: 'webhookTrigger', name: 'Sales Enquiry Received' },
      {
        key: 'qualify',
        type: 'groqChat',
        name: 'Qualify Lead',
        config: {
          instructions: 'Assess this sales enquiry only from the supplied facts; do not invent company details. Return JSON with qualificationScore (integer 0–100), fitSummary, keyNeeds (array), and recommendedNextStep. Score explicit needs, fit, and timeline; missing budget or timeline must not be treated as approved or urgent.',
        },
      },
      { key: 'route', type: 'condition', name: 'Priority Fit?', config: { field: 'qualificationScore', operator: 'greaterThan', value: 69 } },
      { key: 'priority', type: 'logger', name: 'Priority Follow-up', config: { message: 'High-fit lead: prioritize a human follow-up.' } },
      { key: 'nurture', type: 'logger', name: 'Standard Follow-up', config: { message: 'Route this lead to the standard follow-up queue.' } },
    ],
    edges: [
      { source: 'trigger', target: 'qualify' },
      { source: 'qualify', target: 'route' },
      { source: 'route', target: 'priority', sourceHandle: 'true' },
      { source: 'route', target: 'nurture', sourceHandle: 'false' },
    ],
  },
  {
    id: 'feedback-insights',
    name: 'Customer Feedback Insights',
    summary: 'Turn a review into structured, searchable feedback.',
    description: 'Analyzes a review or survey response, extracts its main theme and sentiment, and flags feedback that warrants follow-up.',
    inputFields: [
      { name: 'comment', type: 'string', required: true, description: 'The customer review or survey response.' },
      { name: 'product', type: 'string', required: false, description: 'Product or service the feedback is about.' },
      { name: 'rating', type: 'number', required: false, description: 'Numeric rating, when collected.' },
      { name: 'responseId', type: 'string', required: false, description: 'An identifier from the survey system.' },
    ],
    inputExample: {
      responseId: 'survey-207',
      product: 'Trail Backpack',
      rating: 2,
      comment: 'The bag is comfortable, but the zipper broke after a week.',
    },
    expectedOutputs: ['sentiment', 'theme', 'summary', 'improvementSuggestion', 'needsFollowUp'],
    requiresAi: true,
    nodes: [
      { key: 'trigger', type: 'webhookTrigger', name: 'Feedback Received' },
      {
        key: 'analyze',
        type: 'groqChat',
        name: 'Analyze Feedback',
        config: {
          instructions: 'Analyze the supplied customer feedback without adding facts. Return JSON with sentiment (positive|mixed|negative), theme, summary, improvementSuggestion, and needsFollowUp (boolean). Keep the suggestion grounded in the feedback; set needsFollowUp true for explicit unresolved problems or requests for help.',
        },
      },
      { key: 'result', type: 'logger', name: 'Feedback Insight', config: { message: 'Feedback categorized and ready for product review.' } },
    ],
    edges: [{ source: 'trigger', target: 'analyze' }, { source: 'analyze', target: 'result' }],
  },
  {
    id: 'order-intake-validation',
    name: 'Order Intake Validation',
    summary: 'Validate an incoming order and route incomplete or unpaid orders.',
    description: 'Checks that an order has an ID, positive total, and paid status; valid orders and each review reason follow distinct paths.',
    inputFields: [
      { name: 'orderId', type: 'string', required: true, description: 'The order identifier.' },
      { name: 'total', type: 'number', required: true, description: 'Order total; must be greater than zero.' },
      { name: 'paymentStatus', type: 'string', required: true, description: 'Must be "paid" to pass intake.' },
      { name: 'customerEmail', type: 'string', required: false, description: 'Customer email, if available.' },
      { name: 'currency', type: 'string', required: false, description: 'Currency code, if available.' },
    ],
    inputExample: {
      orderId: 'order-5008',
      customerEmail: 'customer@example.com',
      total: 84.5,
      currency: 'USD',
      paymentStatus: 'paid',
    },
    expectedOutputs: ['orderId', 'total', 'paymentStatus', 'result', 'review route'],
    requiresAi: false,
    nodes: [
      { key: 'trigger', type: 'webhookTrigger', name: 'Order Submitted' },
      { key: 'hasId', type: 'condition', name: 'Order ID Present?', config: { field: 'orderId', operator: 'exists' } },
      { key: 'positiveTotal', type: 'condition', name: 'Total Above Zero?', config: { field: 'total', operator: 'greaterThan', value: 0 } },
      { key: 'paid', type: 'condition', name: 'Payment Complete?', config: { field: 'paymentStatus', operator: 'equals', value: 'paid' } },
      { key: 'accepted', type: 'logger', name: 'Order Ready', config: { message: 'Order passed intake checks and is ready for fulfillment.' } },
      { key: 'missingId', type: 'logger', name: 'Review Missing Order ID', config: { message: 'Order needs review: orderId is missing.' } },
      { key: 'invalidTotal', type: 'logger', name: 'Review Invalid Total', config: { message: 'Order needs review: total must be greater than zero.' } },
      { key: 'unpaid', type: 'logger', name: 'Review Payment Status', config: { message: 'Order needs review: payment status is not paid.' } },
    ],
    edges: [
      { source: 'trigger', target: 'hasId' },
      { source: 'hasId', target: 'positiveTotal', sourceHandle: 'true' },
      { source: 'hasId', target: 'missingId', sourceHandle: 'false' },
      { source: 'positiveTotal', target: 'paid', sourceHandle: 'true' },
      { source: 'positiveTotal', target: 'invalidTotal', sourceHandle: 'false' },
      { source: 'paid', target: 'accepted', sourceHandle: 'true' },
      { source: 'paid', target: 'unpaid', sourceHandle: 'false' },
    ],
  },
  {
    id: 'it-incident-prioritization',
    name: 'IT Incident Prioritization',
    summary: 'Classify an incident and separate critical reports for immediate review.',
    description: 'Summarizes a reported service incident, recommends an initial response, and routes critical incidents to an urgent review path.',
    inputFields: [
      { name: 'service', type: 'string', required: true, description: 'Affected service or component.' },
      { name: 'description', type: 'string', required: true, description: 'What is failing or behaving unexpectedly.' },
      { name: 'impact', type: 'string', required: true, description: 'Known user or business impact.' },
      { name: 'incidentId', type: 'string', required: false, description: 'An identifier from the incident system.' },
    ],
    inputExample: {
      incidentId: 'incident-318',
      service: 'Checkout',
      description: 'Customers cannot complete purchases; checkout returns an error.',
      impact: 'Sales blocked for multiple customers',
    },
    expectedOutputs: ['category', 'urgency', 'summary', 'recommendedAction', 'needsHumanReview'],
    requiresAi: true,
    nodes: [
      { key: 'trigger', type: 'webhookTrigger', name: 'Incident Reported' },
      {
        key: 'classify',
        type: 'groqChat',
        name: 'Classify Incident',
        config: {
          instructions: 'Triage the incident from the supplied report only; do not claim to have checked systems or confirmed a root cause. Return JSON with category, urgency (critical|high|normal|low), summary, recommendedAction, and needsHumanReview (boolean). Use critical only for explicit widespread or business-blocking impact; set needsHumanReview true when impact or scope is unclear.',
        },
      },
      { key: 'route', type: 'condition', name: 'Critical Impact?', config: { field: 'urgency', operator: 'equals', value: 'critical' } },
      { key: 'urgent', type: 'logger', name: 'Urgent Human Review', config: { message: 'Critical incident: urgent human review is required.' } },
      { key: 'standard', type: 'logger', name: 'Standard Incident Review', config: { message: 'Incident classified; add it to the standard review queue.' } },
    ],
    edges: [
      { source: 'trigger', target: 'classify' },
      { source: 'classify', target: 'route' },
      { source: 'route', target: 'urgent', sourceHandle: 'true' },
      { source: 'route', target: 'standard', sourceHandle: 'false' },
    ],
  },
];

export function listWorkflowTemplates(): Omit<WorkflowTemplate, 'nodes' | 'edges'>[] {
  return templates.map(({ nodes: _nodes, edges: _edges, ...template }) => structuredClone(template));
}

export function createWorkflowFromTemplate(templateId: string): WorkflowDocument | undefined {
  const template = templates.find((candidate) => candidate.id === templateId);
  if (!template) return undefined;

  const ids = new Map(template.nodes.map((node) => [node.key, randomUUID()]));
  const depth = new Map<string, number>();
  const rank = (key: string): number => {
    if (depth.has(key)) return depth.get(key)!;
    const parents = template.edges.filter((edge) => edge.target === key);
    const value = parents.length ? Math.max(...parents.map((edge) => rank(edge.source))) + 1 : 0;
    depth.set(key, value);
    return value;
  };
  const rows = new Map<number, number>();
  const positions = new Map(template.nodes.map((node) => {
    const column = rank(node.key);
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return [node.key, { x: 100 + column * 280, y: 100 + row * 180 }];
  }));
  return {
    name: template.name,
    description: template.description,
    active: false,
    nodes: template.nodes.map((node) => ({
      id: ids.get(node.key)!,
      type: node.type,
      name: node.name,
      position: positions.get(node.key)!,
      config: structuredClone(node.config ?? {}),
    })),
    edges: template.edges.map((edge) => ({
      id: randomUUID(),
      source: ids.get(edge.source)!,
      target: ids.get(edge.target)!,
      sourceHandle: edge.sourceHandle,
    })),
  };
}
