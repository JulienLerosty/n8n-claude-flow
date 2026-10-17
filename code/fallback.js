// Rule-based answer used when Claude fails (HTTP error, timeout, bad output).
// It never invents a reply: the draft asks a human to look.
const prep = $('Prepare').first().json;
const incoming = $input.first().json;
const t = prep.text.toLowerCase();
let category = 'other';
if (/\b(invoice|refund|charge|payment|billing|subscription)\b/.test(t)) category = 'billing';
else if (/\b(error|crash(?:es|ed)?|bugs?|broken|not working|fails?|can't|cannot)\b/.test(t)) category = 'bug';
else if (t.includes('?')) category = 'question';
const urgency = /\b(urgent|asap|immediately|down|outage)\b/.test(t) ? 'high' : 'normal';
const reason = (incoming.error && (incoming.error.message || String(incoming.error))) || incoming.reason || 'Claude step failed';
return [{
  json: {
    valid: true,
    runId: prep.runId,
    source: 'fallback',
    category,
    urgency,
    summary: prep.text.slice(0, 120),
    reply_draft: 'Thanks for your message. A person will review it and reply soon.',
    fallbackReason: String(reason).slice(0, 200),
  },
}];
