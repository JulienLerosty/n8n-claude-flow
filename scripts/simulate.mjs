// Runs workflow.json's Code nodes in order, with Claude mocked, so the flow is tested without n8n or a key.
// Usage: node scripts/simulate.mjs fixtures/messages.json [ok|badjson|http-error]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const CLAUDE_OK = (msg) => {
  const lower = msg.toLowerCase();
  const category = /charged|refund/.test(lower) ? 'billing' : /crash/.test(lower) ? 'bug' : 'question';
  return { content: [{ type: 'text', text: JSON.stringify({ category, urgency: /urgent/.test(lower) ? 'high' : 'normal', summary: 'Mock summary of: ' + msg.slice(0, 40), reply_draft: 'Mock draft reply.' }) }] };
};

export function runCode(node, ctx) {
  const fn = vm.runInNewContext(`(function($input,$,$env,$getWorkflowStaticData){${node.parameters.jsCode}\n})`, { Date, Math, JSON, Error, String });
  const out = fn(ctx.$input, ctx.$, ctx.$env, ctx.$getWorkflowStaticData);
  return out.map((i) => i.json);
}

// scenario: 'ok' | 'badjson' | 'http-error'
export function simulate(wf, body, scenario = 'ok', store = {}, env = {}) {
  const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
  const results = {};
  const trail = [];
  const ctxFor = (json) => ({
    $input: { first: () => ({ json }) },
    $: (name) => ({ first: () => ({ json: results[name] }) }),
    $env: env,
    $getWorkflowStaticData: () => store,
  });
  const next = (name, port = 0) => (wf.connections[name]?.main?.[port] || [])[0]?.node;
  let current = next('Webhook');
  let json = { body };
  let response = null;
  let guard = 0;
  while (current && guard++ < 20) {
    const node = byName[current];
    trail.push(current);
    let port = 0;
    if (node.type === 'n8n-nodes-base.code') {
      json = runCode(node, ctxFor(json))[0];
    } else if (node.type === 'n8n-nodes-base.httpRequest') {
      const req = json.claudeRequest;
      if (scenario === 'http-error') { json = { error: { message: 'The service is receiving too many requests (429)' } }; port = 1; }
      else if (scenario === 'badjson') json = { content: [{ type: 'text', text: 'Sorry, I cannot help with that.' }] };
      else json = CLAUDE_OK(req.messages[0].content);
    } else if (node.type === 'n8n-nodes-base.if') {
      port = json.valid === true ? 0 : 1;
    } else if (node.type === 'n8n-nodes-base.respondToWebhook') {
      response = json;
      break;
    }
    results[current] = json;
    current = next(current, port);
  }
  return { response, trail, store };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL('..', import.meta.url);
  const wf = JSON.parse(readFileSync(new URL('workflow.json', root), 'utf8'));
  const msgs = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const scenario = process.argv[3] || 'ok';
  const store = {};
  for (const m of msgs) {
    const { response, trail } = simulate(wf, { text: m.text }, scenario, store);
    console.log(`${m.id}: ${response.source} | ${response.category} | ${response.urgency} | ${trail.join(' > ')}`);
  }
  console.log(`logged runs: ${store.runs.length}`);
}
