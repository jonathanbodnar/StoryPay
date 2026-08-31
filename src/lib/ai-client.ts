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
    timeout: 30_000,
  });
}

/**
 * OpenAI client — used for embeddings (help search) and, for the ad generator,
 * high-quality copy + vision photo selection. Requires OPENAI_API_KEY.
 */
export function getOpenAIEmbeddingsClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set.');
  return new OpenAI({ apiKey, timeout: 30_000 });
}

/** Same OpenAI client, longer timeout — used for ad copy chat completions. */
export function getOpenAIChatClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set.');
  return new OpenAI({ apiKey, timeout: 60_000 });
}

/**
 * OpenAI client with a long timeout for image generation/edits (gpt-image-*),
 * which can take 20–60s per creative. Requires OPENAI_API_KEY.
 */
export function getOpenAIImageClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set.');
  return new OpenAI({ apiKey, timeout: 180_000 });
}
