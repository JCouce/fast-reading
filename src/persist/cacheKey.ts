export const PARSER_VERSION = '1';

export async function cacheKey(bytes: Uint8Array, parserVersion: string = PARSER_VERSION): Promise<string> {
  // slice() copia solo la vista: un subarray comparte buffer con más bytes alrededor
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice());
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex}:${parserVersion}`;
}
