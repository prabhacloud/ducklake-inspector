import type { Finding } from './analyzers';

const CACHE = new Map<string, string>();

const SYSTEM_PROMPT = `You are a lakehouse hygiene analyst. Given a set of DuckLake table audit findings, produce:

**Summary** — 2 sentences on the overall state of the catalog.

**Priorities** — a numbered list of the top 3 actions, most impactful first. For each, one line of rationale referencing the specific table/finding.

Rules: Be direct, no filler. Don't restate every finding — synthesize. Skip anything below MEDIUM severity unless it dominates the numbers. Use Markdown. Never exceed ~180 words total.`;

type Provider = 'anthropic' | 'openai';

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

export type SummaryResult =
  | { kind: 'ok'; text: string; model: string }
  | { kind: 'disabled'; reason: string }
  | { kind: 'error'; reason: string; model?: string };

export async function summarizeAudit(findings: Finding[], tablesScanned: number): Promise<SummaryResult> {
  if (findings.length === 0) {
    return { kind: 'disabled', reason: 'No findings to summarize.' };
  }

  const provider = pickProvider();
  if (!provider) {
    return {
      kind: 'disabled',
      reason: 'Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env.local to enable AI summary.',
    };
  }

  const model = modelId(provider);
  const cacheKey = `${provider}:${model}|${hashFindings(findings, tablesScanned)}`;
  const cached = CACHE.get(cacheKey);
  if (cached) return { kind: 'ok', text: cached, model };

  const compact = findings.map(f => ({
    analyzer: f.analyzer,
    severity: f.severity,
    title: f.title,
    evidence: f.evidence,
    est_monthly_savings_usd: f.estimated_monthly_savings_usd,
  }));
  const userMsg = `Tables scanned: ${tablesScanned}\nFindings:\n${JSON.stringify(compact, null, 2)}`;

  try {
    const text = provider === 'anthropic'
      ? await callAnthropic(userMsg)
      : await callOpenAI(userMsg);
    if (!text) return { kind: 'error', reason: 'Empty response from LLM.', model };
    CACHE.set(cacheKey, text);
    return { kind: 'ok', text, model };
  } catch (e) {
    return { kind: 'error', reason: (e as Error).message, model };
  }
}

function pickProvider(): Provider | null {
  const forced = process.env.LLM_PROVIDER?.toLowerCase();
  if (forced === 'openai' && process.env.OPENAI_API_KEY) return 'openai';
  if (forced === 'anthropic' && process.env.ANTHROPIC_API_KEY) return 'anthropic';
  // Auto: prefer Anthropic when both are set (org default).
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

function modelId(p: Provider): string {
  return p === 'anthropic' ? ANTHROPIC_MODEL : OPENAI_MODEL;
}

async function callAnthropic(userMsg: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 600,
      // Cache the system prompt across repeated audit runs — it never changes.
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMsg }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '<no body>');
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json() as { content?: Array<{ type: string; text?: string }> };
  return data.content?.find(c => c.type === 'text')?.text ?? '';
}

async function callOpenAI(userMsg: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY!}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_tokens: 600,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '<no body>');
    throw new Error(`OpenAI API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

function hashFindings(findings: Finding[], tables: number): string {
  return `${tables}|` + findings
    .map(f => `${f.analyzer}:${f.severity}:${f.title}`)
    .sort()
    .join('|');
}
