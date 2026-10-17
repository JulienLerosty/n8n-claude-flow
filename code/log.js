// Keeps the last 100 runs in workflow static data and builds the response.
// Only metadata is logged, never the message text.
const prep = $('Prepare').first().json;
const r = $input.first().json;
const store = $getWorkflowStaticData('global');
store.runs = store.runs || [];
store.runs.push({
  runId: r.runId,
  at: prep.startedAt,
  source: r.source,
  category: r.category,
  urgency: r.urgency,
  fallbackReason: r.fallbackReason || null,
  ms: Date.now() - Date.parse(prep.startedAt),
});
if (store.runs.length > 100) store.runs.splice(0, store.runs.length - 100);
const { valid, ...response } = r;
return [{ json: response }];
