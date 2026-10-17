// Assembles workflow.json from the readable code/*.js files.  Run: node scripts/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = (name) => readFileSync(join(root, 'code', name + '.js'), 'utf8');

export function buildWorkflow() {
  const codeNode = (name, file, position) => ({
    id: `node-${file}`,
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: code(file) },
  });
  return {
    name: 'Claude triage with fallback and run log',
    nodes: [
      {
        id: 'node-webhook',
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [0, 200],
        webhookId: 'claude-flow-demo',
        parameters: { httpMethod: 'POST', path: 'claude-flow', responseMode: 'responseNode', options: {} },
      },
      codeNode('Prepare', 'prepare', [220, 200]),
      {
        id: 'node-claude',
        name: 'Claude',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [440, 200],
        onError: 'continueErrorOutput',
        retryOnFail: true,
        maxTries: 2,
        waitBetweenTries: 2000,
        parameters: {
          method: 'POST',
          url: 'https://api.anthropic.com/v1/messages',
          sendHeaders: true,
          headerParameters: {
            parameters: [
              { name: 'x-api-key', value: '={{ $env.ANTHROPIC_API_KEY }}' },
              { name: 'anthropic-version', value: '2023-06-01' },
              { name: 'content-type', value: 'application/json' },
            ],
          },
          sendBody: true,
          specifyBody: 'json',
          jsonBody: '={{ JSON.stringify($json.claudeRequest) }}',
          options: { timeout: 30000 },
        },
      },
      codeNode('Parse', 'parse', [660, 120]),
      {
        id: 'node-valid',
        name: 'Valid answer?',
        type: 'n8n-nodes-base.if',
        typeVersion: 2,
        position: [880, 120],
        parameters: {
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
            conditions: [
              {
                id: 'cond-valid',
                leftValue: '={{ $json.valid }}',
                rightValue: '',
                operator: { type: 'boolean', operation: 'true', singleValue: true },
              },
            ],
            combinator: 'and',
          },
          options: {},
        },
      },
      codeNode('Fallback', 'fallback', [880, 320]),
      codeNode('Log run', 'log', [1100, 200]),
      {
        id: 'node-respond',
        name: 'Respond',
        type: 'n8n-nodes-base.respondToWebhook',
        typeVersion: 1.1,
        position: [1320, 200],
        parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify($json) }}', options: {} },
      },
    ],
    connections: {
      Webhook: { main: [[{ node: 'Prepare', type: 'main', index: 0 }]] },
      Prepare: { main: [[{ node: 'Claude', type: 'main', index: 0 }]] },
      Claude: {
        main: [
          [{ node: 'Parse', type: 'main', index: 0 }],
          [{ node: 'Fallback', type: 'main', index: 0 }],
        ],
      },
      Parse: { main: [[{ node: 'Valid answer?', type: 'main', index: 0 }]] },
      'Valid answer?': {
        main: [
          [{ node: 'Log run', type: 'main', index: 0 }],
          [{ node: 'Fallback', type: 'main', index: 0 }],
        ],
      },
      Fallback: { main: [[{ node: 'Log run', type: 'main', index: 0 }]] },
      'Log run': { main: [[{ node: 'Respond', type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1' },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(root, 'workflow.json'), JSON.stringify(buildWorkflow(), null, 2) + '\n');
  console.log('wrote workflow.json');
}
