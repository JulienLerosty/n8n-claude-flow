import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildWorkflow } from '../scripts/build.mjs';
import { validateWorkflow } from '../scripts/validate.mjs';
import { simulate } from '../scripts/simulate.mjs';

const root = new URL('..', import.meta.url);
const wf = JSON.parse(readFileSync(new URL('workflow.json', root), 'utf8'));
const msgs = JSON.parse(readFileSync(new URL('fixtures/messages.json', root), 'utf8'));
const clone = () => structuredClone(wf);

test('committed workflow.json matches the build output', () => {
  assert.deepEqual(wf, buildWorkflow());
});

test('validator accepts the workflow with no warnings', () => {
  const r = validateWorkflow(wf);
  assert.deepEqual(r, { errors: [], warnings: [] });
});

test('validator rejects broken workflows', () => {
  const dup = clone(); dup.nodes[1].name = 'Webhook';
  assert.ok(validateWorkflow(dup).errors.some((e) => e.includes('Duplicate node name')));

  const dangling = clone(); dangling.connections.Prepare.main[0][0].node = 'Nope';
  assert.ok(validateWorkflow(dangling).errors.some((e) => e.includes('unknown node "Nope"')));

  const noErr = clone(); noErr.connections.Claude.main.pop();
  assert.ok(validateWorkflow(noErr).errors.some((e) => e.includes('error output')));

  const badCode = clone(); badCode.nodes.find((n) => n.name === 'Parse').parameters.jsCode = 'return [{ json: ';
  assert.ok(validateWorkflow(badCode).errors.some((e) => e.includes('does not compile')));

  const key = clone(); key.nodes.find((n) => n.name === 'Claude').parameters.headerParameters.parameters[0].value = ['sk', 'ant', 'api03', 'abcdefghijklmnop'].join('-');
  assert.ok(validateWorkflow(key).errors.some((e) => e.includes('hard-coded API key')));

  const orphan = clone(); orphan.nodes.push({ id: 'x', name: 'Orphan', type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0], parameters: { jsCode: 'return [];' } });
  assert.ok(validateWorkflow(orphan).errors.some((e) => e.includes('Orphan')));

  assert.ok(validateWorkflow({}).errors.length > 0);
  assert.ok(validateWorkflow(null).errors.length > 0);
});

test('happy path: Claude answer goes straight to the log', () => {
  const { response, trail } = simulate(wf, { text: msgs[0].text }, 'ok');
  assert.equal(response.source, 'claude');
  assert.equal(response.category, 'billing');
  assert.ok(!trail.includes('Fallback'));
  assert.equal(response.valid, undefined);
});

test('invalid Claude output falls back', () => {
  const { response, trail } = simulate(wf, { text: msgs[0].text }, 'badjson');
  assert.equal(response.source, 'fallback');
  assert.ok(trail.includes('Parse') && trail.includes('Fallback'));
  assert.match(response.fallbackReason, /not valid JSON/);
});

test('HTTP error falls back through the error output', () => {
  const { response, trail } = simulate(wf, { text: msgs[1].text }, 'http-error');
  assert.equal(response.source, 'fallback');
  assert.ok(!trail.includes('Parse'));
  assert.equal(response.category, 'bug');
  assert.equal(response.urgency, 'high');
  assert.match(response.fallbackReason, /429/);
});

test('fallback never echoes an invented reply', () => {
  const { response } = simulate(wf, { text: msgs[3].text }, 'http-error');
  assert.match(response.reply_draft, /person will review/);
});

test('log keeps metadata only and caps at 100 runs', () => {
  const store = {};
  for (let i = 0; i < 105; i++) simulate(wf, { text: 'Hello? ' + i + ' secret-token-xyz' }, 'ok', store);
  assert.equal(store.runs.length, 100);
  assert.ok(!JSON.stringify(store).includes('secret-token-xyz'));
  assert.deepEqual(Object.keys(store.runs[0]).sort(), ['at', 'category', 'fallbackReason', 'ms', 'runId', 'source', 'urgency']);
});

test('empty body is rejected and the API key comes from the environment', () => {
  assert.throws(() => simulate(wf, { text: '   ' }, 'ok'), /non-empty text/);
  assert.throws(() => simulate(wf, {}, 'ok'));
  const prepared = simulate(wf, { text: 'x'.repeat(9000) }, 'ok', {}, {});
  assert.ok(prepared.response);
  const http = wf.nodes.find((n) => n.name === 'Claude');
  assert.equal(http.parameters.headerParameters.parameters[0].value, '={{ $env.ANTHROPIC_API_KEY }}');
});

test('the prompt is bounded and treats the message as untrusted', () => {
  const store = {};
  const sim = simulate(wf, { text: 'y'.repeat(9000) }, 'ok', store);
  assert.ok(sim.response);
  const prep = wf.nodes.find((n) => n.name === 'Prepare').parameters.jsCode;
  assert.match(prep, /slice\(0, 4000\)/);
  assert.match(prep, /untrusted data/);
});
