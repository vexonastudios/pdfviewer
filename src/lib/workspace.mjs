const encoder = new TextEncoder(), decoder = new TextDecoder();
export function toBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}
const fromBase64 = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));
export class WorkspacePasswordError extends Error {}
async function key(password, salt, usage) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, [usage]);
}
export async function encodeWorkspace(draft, password = '') {
  const bytes = encoder.encode(JSON.stringify(draft));
  if (!password) return bytes;
  if (password.length < 8) throw new Error('Use at least 8 characters for a workspace password.');
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(password, salt, 'encrypt'), bytes);
  return encoder.encode(JSON.stringify({ format: 'paperdesk-encrypted-v1', salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) }));
}
export async function decodeWorkspace(bytes, password = '') {
  let draft = JSON.parse(decoder.decode(bytes));
  const encrypted = draft.format === 'paperdesk-encrypted-v1';
  if (encrypted) {
    if (!password) throw new WorkspacePasswordError('Enter the workspace password.');
    try {
      const salt = fromBase64(draft.salt), iv = fromBase64(draft.iv);
      if (salt.length !== 16 || iv.length !== 12 || typeof draft.ciphertext !== 'string') throw new Error();
      draft = JSON.parse(decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await key(password, salt, 'decrypt'), fromBase64(draft.ciphertext))));
    } catch { throw new WorkspacePasswordError('The password is incorrect, or this workspace is damaged.'); }
  }
  if (draft.format !== 'paperdesk-workspace-v1' || typeof draft.pdf !== 'string' || typeof draft.name !== 'string' ||
      !draft.state?.values || typeof draft.state.values !== 'object' || !Array.isArray(draft.state.additions)) throw new Error('This is not a Paperdesk workspace. Paste bulk-fill JSON into Bulk fill.');
  return { bytes: fromBase64(draft.pdf), name: draft.name, restored: draft.state, encrypted };
}
export function createWorkspace(document, state) {
  return { format: 'paperdesk-workspace-v1', name: document.name, pdf: toBase64(document.bytes), state };
}
