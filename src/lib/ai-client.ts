/**
 * Shared AI client instances.
 *
 * Chat / completions  → DeepSeek (deepseek-chat, OpenAI-compatible API)
 * Embeddings          → OpenAI  (text-embedding-3-small, kept for help search)
 *
 * Both use the `openai` npm package — DeepSeek just needs a different baseURL.
 */

import OpenAI from 'openai';

/** DeepSeek chat model — used for all completion routes. */
export const DEEPSEEK_MODEL = 'deepseek-chat';

/**
 * DeepSeek client (OpenAI-compatible).
 * Requires DEEPSEEK_API_KEY in env.
 */
export function getDeepSeekClient(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not set.');
  return new OpenAI({
    apiKey,
    baseURL: 'https://api.deepseek.com/v1',
  });
}

/**
 * OpenAI client — used ONLY for embeddings (help search / seed-embeddings).
 * Requires OPENAI_API_KEY in env.
 */
export function getOpenAIEmbeddingsClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set.');
  return new OpenAI({ apiKey });
}
