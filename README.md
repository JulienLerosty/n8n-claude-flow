# n8n-claude-flow

An importable **n8n workflow** that sends a customer message to Claude, **falls back to a rule-based answer when Claude fails**, and **logs every run**. Plus a validator and an offline simulator, so you can check the flow without n8n or an API key.

> Built by Julien Lerosty. AI tools, mainly Claude, are used under his supervision; he reviews and tests every delivery. MIT licensed. All sample messages are invented.

## The flow

```
Webhook -> Prepare -> Claude (HTTP) --ok----> Parse -> Valid answer? --yes--> Log run -> Respond
                          |                                  |no                ^
                          +--error/timeout--> Fallback <-----+------------------+
```

- **Prepare** rejects an empty body, clips the text to 4000 characters, and builds the request. The message goes inside `<message>` tags and the system prompt says it is untrusted.
- **Claude** is an HTTP Request node (2 tries, 30 s timeout) using the key from the `ANTHROPIC_API_KEY` environment variable. Its error output is wired to Fallback.
- **Parse** accepts only JSON with `category`, `urgency`, `summary`, `reply_draft` in the allowed values. Anything else goes to Fallback.
- **Fallback** classifies with keywords and writes a neutral "a person will review" draft. It never makes up a reply.
- **Log run** keeps the last 100 runs in workflow static data: id, time, source (`claude` or `fallback`), category, urgency, failure reason, duration. **Not the message text.**

## Use it

1. In n8n: Workflows > Import from File > `workflow.json`.
2. Set `ANTHROPIC_API_KEY` in n8n's environment (optional `CLAUDE_MODEL`, default `claude-sonnet-5-5`). If your n8n blocks `$env` in expressions (`N8N_BLOCK_ENV_ACCESS_IN_NODE`), switch the header to an n8n credential instead.
3. Activate and call it:
   ```
   curl -X POST https://YOUR-N8N/webhook/claude-flow -H 'content-type: application/json' -d '{"text":"I was charged twice, please refund one."}'
   ```

Static-data logging only persists for active (production) executions. For a real client I'd swap Log run for a Google Sheets, Airtable or database node.

## Check it offline (no n8n, no key, no network)

```
npm test                      # 10 tests
node scripts/validate.mjs workflow.json
node scripts/simulate.mjs fixtures/messages.json ok          # Claude answers
node scripts/simulate.mjs fixtures/messages.json badjson     # Claude returns junk
node scripts/simulate.mjs fixtures/messages.json http-error  # Claude call fails
```

Sample output (Claude mocked; the third form shows the fallback path):

```
billing: claude | billing | normal | Prepare > Claude > Parse > Valid answer? > Log run > Respond
bug: claude | bug | high | Prepare > Claude > Parse > Valid answer? > Log run > Respond
...
-- http-error
billing: fallback | billing | normal | Prepare > Claude > Fallback > Log run > Respond
bug: fallback | bug | high | Prepare > Claude > Fallback > Log run > Respond
```

`workflow.json` is generated from the readable files in `code/` by `node scripts/build.mjs`; a test fails if the two drift apart.

## What is and is not verified

- Verified: the JSON structure (validator, with negative tests), the JavaScript in every Code node (run in a Node VM with n8n's `$input`, `$()` and static-data helpers stubbed), and the three routes: success, invalid output, HTTP error.
- **Not verified:** import into a real n8n instance, the live Anthropic call, and exact node parameter names across n8n versions. Built against webhook v2, HTTP Request v4.2, IF v2, Respond to Webhook v1.1. On your instance I'd import it and run the three cases before handing over.
- The Make equivalent is in [make-claude-flow](../make-claude-flow) (blueprint, also not imported into a real account).

## What I'd build for you

The same pattern on your tools: your trigger (form, email, CRM, schedule), your Claude step with a prompt tested on your own examples, a fallback that matches how you want failures handled, and a run log in the place your team already looks.

## Hire me

I build small, tested automations like this one for clients.

- Upwork: https://www.upwork.com/freelancers/~011ec6fab9b610aea9

AI tools, mainly Claude, are used under my supervision; I review and test every delivery.
