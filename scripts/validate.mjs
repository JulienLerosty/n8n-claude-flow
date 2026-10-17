// Checks an n8n workflow export for structural problems before you import it.
// Usage: node scripts/validate.mjs workflow.json   (exit 1 when errors are found)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const KNOWN = {
  'n8n-nodes-base.webhook': 2,
  'n8n-nodes-base.code': 2,
  'n8n-nodes-base.httpRequest': 4.2,
  'n8n-nodes-base.if': 2,
  'n8n-nodes-base.respondToWebhook': 1.1,
};

export function validateWorkflow(wf) {
  const errors = [];
  const warnings = [];
  if (!wf || typeof wf !== 'object') return { errors: ['Workflow is not a JSON object'], warnings };
  if (!Array.isArray(wf.nodes) || wf.nodes.length === 0) return { errors: ['"nodes" must be a non-empty array'], warnings };
  if (!wf.connections || typeof wf.connections !== 'object') errors.push('"connections" must be an object');

  const names = new Set();
  const ids = new Set();
  for (const n of wf.nodes) {
    const label = n && n.name ? `node "${n.name}"` : 'a node without a name';
    if (!n || typeof n.name !== 'string' || !n.name) errors.push('A node has no name');
    else if (names.has(n.name)) errors.push(`Duplicate node name "${n.name}"`);
    else names.add(n.name);
    if (!n.id) errors.push(`${label} has no id`);
    else if (ids.has(n.id)) errors.push(`Duplicate node id "${n.id}"`);
    else ids.add(n.id);
    if (typeof n.type !== 'string') errors.push(`${label} has no type`);
    if (typeof n.typeVersion !== 'number') errors.push(`${label} has no numeric typeVersion`);
    if (!Array.isArray(n.position) || n.position.length !== 2 || n.position.some((x) => typeof x !== 'number')) {
      errors.push(`${label} needs position [x, y]`);
    }
    if (!n.parameters || typeof n.parameters !== 'object') errors.push(`${label} has no parameters object`);
    if (KNOWN[n.type] && n.typeVersion > KNOWN[n.type]) warnings.push(`${label}: typeVersion ${n.typeVersion} is newer than ${KNOWN[n.type]} this validator knows`);
    if (n.type === 'n8n-nodes-base.code') {
      const src = n.parameters?.jsCode;
      if (typeof src !== 'string' || !src.trim()) errors.push(`${label} has empty jsCode`);
      else {
        try { new vm.Script(`(function(){${src}\n})`); } catch (e) { errors.push(`${label} jsCode does not compile: ${e.message}`); }
        if (!/\breturn\b/.test(src)) errors.push(`${label} jsCode never returns items`);
      }
    }
    if (n.type === 'n8n-nodes-base.httpRequest') {
      const u = n.parameters?.url;
      if (typeof u !== 'string' || !/^(=|https:\/\/)/.test(u)) errors.push(`${label} url must be https or an expression`);
      const raw = JSON.stringify(n.parameters || {});
      if (/sk-ant-[A-Za-z0-9_-]{10,}/.test(raw)) errors.push(`${label} contains what looks like a hard-coded API key`);
    }
    if (n.type === 'n8n-nodes-base.webhook') {
      if (!n.parameters?.path) errors.push(`${label} has no path`);
      if (n.parameters?.responseMode === 'responseNode' && !wf.nodes.some((x) => x.type === 'n8n-nodes-base.respondToWebhook')) {
        errors.push(`${label} waits for a Respond to Webhook node, but there is none`);
      }
    }
  }

  const triggers = wf.nodes.filter((n) => /webhook|trigger/i.test(n.type));
  if (triggers.length === 0) errors.push('No trigger node (webhook or trigger)');

  const incoming = new Map([...names].map((n) => [n, 0]));
  const edges = new Map([...names].map((n) => [n, []]));
  for (const [from, conn] of Object.entries(wf.connections || {})) {
    if (!names.has(from)) { errors.push(`Connection from unknown node "${from}"`); continue; }
    for (const [kind, outputs] of Object.entries(conn)) {
      if (kind !== 'main') continue;
      if (!Array.isArray(outputs)) { errors.push(`Connections of "${from}" must be arrays`); continue; }
      outputs.forEach((targets) => {
        for (const t of targets || []) {
          if (!names.has(t.node)) errors.push(`"${from}" connects to unknown node "${t.node}"`);
          else { incoming.set(t.node, incoming.get(t.node) + 1); edges.get(from).push(t.node); }
        }
      });
    }
  }
  for (const n of wf.nodes) {
    const isTrigger = triggers.includes(n);
    if (!isTrigger && incoming.get(n.name) === 0) errors.push(`Node "${n.name}" has no incoming connection (unreachable)`);
  }
  // reachability from the trigger(s)
  const seen = new Set();
  const stack = triggers.map((t) => t.name);
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(edges.get(cur) || []));
  }
  for (const n of names) if (!seen.has(n) && incoming.get(n) > 0) errors.push(`Node "${n}" is not reachable from the trigger`);
  // error output wiring
  for (const n of wf.nodes) {
    if (n.onError === 'continueErrorOutput') {
      const outs = wf.connections?.[n.name]?.main || [];
      if (!outs[1] || outs[1].length === 0) errors.push(`Node "${n.name}" uses continueErrorOutput but its error output (second) is not connected`);
    }
    if (n.type === 'n8n-nodes-base.if') {
      const outs = wf.connections?.[n.name]?.main || [];
      if (!outs[0]?.length || !outs[1]?.length) warnings.push(`IF node "${n.name}" has an unconnected branch`);
    }
  }
  if (!wf.nodes.some((n) => n.onError === 'continueErrorOutput' || n.onError === 'continueRegularOutput')) {
    warnings.push('No node handles errors (onError); a failed step will stop the run');
  }
  return { errors, warnings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node scripts/validate.mjs workflow.json'); process.exit(2); }
  let wf;
  try { wf = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error(`Cannot read ${file}: ${e.message}`); process.exit(2); }
  const { errors, warnings } = validateWorkflow(wf);
  warnings.forEach((w) => console.log('warning: ' + w));
  errors.forEach((e) => console.log('error:   ' + e));
  console.log(errors.length ? `FAIL: ${errors.length} error(s)` : `OK: ${wf.nodes.length} nodes, ${warnings.length} warning(s)`);
  process.exit(errors.length ? 1 : 0);
}
