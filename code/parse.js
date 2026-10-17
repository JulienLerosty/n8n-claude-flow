// Checks Claude's answer against the schema. valid=false sends the item to the fallback.
const prep = $('Prepare').first().json;
const res = $input.first().json;
const CATEGORIES = ['billing', 'bug', 'question', 'other'];
const URGENCIES = ['low', 'normal', 'high'];
let out = null;
try {
  const raw = (res.content || []).map((p) => p.text || '').join('').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const obj = JSON.parse(raw.slice(start, end + 1));
  if (
    CATEGORIES.includes(obj.category) &&
    URGENCIES.includes(obj.urgency) &&
    typeof obj.summary === 'string' && obj.summary.trim() &&
    typeof obj.reply_draft === 'string' && obj.reply_draft.trim()
  ) {
    out = {
      category: obj.category,
      urgency: obj.urgency,
      summary: obj.summary.trim(),
      reply_draft: obj.reply_draft.trim(),
    };
  }
} catch (e) {
  out = null;
}
if (!out) {
  return [{ json: { valid: false, reason: 'Claude answer was not valid JSON for the schema', runId: prep.runId } }];
}
return [{ json: { valid: true, runId: prep.runId, source: 'claude', ...out } }];
