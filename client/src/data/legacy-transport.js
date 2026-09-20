// Standalone ESM: served at /openbexi_timeline/transport.js without a bundler.
const SESSION_PATH = /^\/openbexi_timeline(?:_sse)?\/sessions\/?$/;
const AUTH_FAILURE = new Set([401, 403]);
const retryDelay = value => Math.max(100, Math.min(30000, value));

/** Incremental SSE parser. Never retain more than one bounded frame. */
export function createLegacySseDecoder({ onEvent, onRetry = () => {}, onId = () => {}, maxEventCharacters = 8 * 1024 * 1024 }) {
  if (!Number.isSafeInteger(maxEventCharacters) || maxEventCharacters < 1 || maxEventCharacters > 16 * 1024 * 1024) throw new RangeError('SSE frame limit must be from 1 to 16 Mi characters.');
  let pending = '', data = [], type = '', lastId = '', frameSize = 0, frameLines = 0, first = true;
  function line(value) {
    if (value === '') {
      if (data.length) onEvent({ type: type || 'message', data: data.join('\n'), lastEventId: lastId });
      data = []; type = ''; frameSize = 0; frameLines = 0; return;
    }
    frameSize += value.length;
    if (frameSize > maxEventCharacters || ++frameLines > 65536) throw new RangeError('Legacy stream frame exceeds its configured bound.');
    if (value[0] === ':') return;
    const colon = value.indexOf(':'), field = colon < 0 ? value : value.slice(0, colon);
    let content = colon < 0 ? '' : value.slice(colon + 1); if (content[0] === ' ') content = content.slice(1);
    if (field === 'data') data.push(content);
    else if (field === 'event') type = content;
    else if (field === 'id' && !content.includes('\0')) { if (content.length > 1024) throw new RangeError('Legacy stream event ID exceeds 1024 characters.'); lastId = content; onId(content); }
    else if (field === 'retry' && /^\d+$/.test(content) && Number.isSafeInteger(Number(content))) onRetry(retryDelay(Number(content)));
  }
  return {
    push(text, final = false) {
      if (first && text) { text = text.replace(/^\uFEFF/, ''); first = false; }
      pending += text;
      let start = 0;
      for (let i = 0; i < pending.length; i++) {
        const ch = pending[i]; if (ch !== '\n' && ch !== '\r') continue;
        if (ch === '\r' && i === pending.length - 1 && !final) break;
        line(pending.slice(start, i)); if (ch === '\r' && pending[i + 1] === '\n') i++; start = i + 1;
      }
      pending = pending.slice(start);
      if (pending.length + frameSize > maxEventCharacters) throw new RangeError('Legacy stream frame exceeds its configured bound.');
      // EOF does not dispatch an unterminated event, as with native EventSource.
      if (final) pending = '';
    },
  };
}

/** Authenticated fetch and EventSource-compatible streaming for these two routes. */
export function createLegacyTransport({ baseUrl = globalThis.location?.origin, token = null, local = true,
  fetch: fetchImpl = globalThis.fetch.bind(globalThis), reconnectDelay = 1000, maxEventCharacters = 8 * 1024 * 1024 } = {}) {
  const base = new URL(baseUrl), streams = new Set();
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new TypeError('A credential-free HTTP(S) origin is required.');
  let bearer = token;
  const resolve = input => new URL(typeof input === 'string' || input instanceof URL ? input : input.url, base);
  const matches = input => { try { const url = resolve(input); return url.origin === base.origin && SESSION_PATH.test(url.pathname); } catch { return false; } };
  function request(input, init = {}) {
    const url = resolve(input);
    if (!matches(url)) throw new TypeError('Legacy authentication is restricted to the configured origin and session routes.');
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    if (bearer) headers.set('Authorization', `Bearer ${bearer}`);
    if (local) headers.set('x-openbexi-local', '1');
    return fetchImpl(input instanceof Request ? input : url.href, { ...init, headers, credentials: 'same-origin', redirect: 'error' });
  }
  class LegacyEventSource extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
    CONNECTING = 0; OPEN = 1; CLOSED = 2;
    onopen = null; onmessage = null; onerror = null;
    constructor(url) {
      super(); if (!matches(url)) throw new TypeError('Legacy streams require a configured session route.');
      this.url = resolve(url).href; this.withCredentials = false; this.readyState = 0;
      this.delay = retryDelay(reconnectDelay); this.lastEventId = ''; this.closed = false; this.authPaused = false; this.running = false;
      for (const name of ['open', 'message', 'error']) this.addEventListener(name, event => { const handler = this[`on${name}`]; if (typeof handler === 'function') handler.call(this, event); });
      streams.add(this); queueMicrotask(() => this.resume());
    }
    emit(event) { this.dispatchEvent(event); }
    fail(status = 0, message = 'Legacy stream disconnected') {
      const event = new Event('error'); Object.defineProperties(event, { status: { value: status }, message: { value: message } }); this.emit(event);
    }
    pauseAuthorization(status) { this.authPaused = true; this.readyState = 2; this.controller?.abort(); this.fail(status, 'Legacy stream authorization requires updated credentials.'); }
    async resume() {
      if (this.running || this.closed || this.authPaused) return;
      this.running = true;
      try {
        while (!this.closed && !this.authPaused) {
          this.readyState = 0; this.controller = new AbortController();
          let reader;
          try {
            const headers = new Headers({ Accept: 'text/event-stream' }); if (this.lastEventId) headers.set('Last-Event-ID', this.lastEventId);
            const response = await request(this.url, { headers, signal: this.controller.signal, cache: 'no-store' });
            if (this.closed) { await response.body?.cancel(); break; }
            if (AUTH_FAILURE.has(response.status)) { await response.body?.cancel(); this.pauseAuthorization(response.status); break; }
            if (response.status === 204) { await response.body?.cancel(); this.close(); break; }
            if (response.status >= 400 && response.status < 500 && response.status !== 429) { await response.body?.cancel(); this.fail(response.status, 'Legacy stream request was rejected.'); this.close(); break; }
            if (!response.ok || !/^text\/event-stream(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) { await response.body?.cancel(); throw new Error(`Invalid legacy stream response (${response.status}).`); }
            if (!response.body) throw new Error('Legacy stream body is unavailable.');
            this.readyState = 1; this.emit(new Event('open')); reader = response.body.getReader();
            const decoder = new TextDecoder(), parser = createLegacySseDecoder({ maxEventCharacters,
              onRetry: value => { this.delay = value; }, onId: value => { this.lastEventId = value; },
              onEvent: value => {
                if (this.closed || this.authPaused) return;
                if (value.type === 'error') { let status; try { status = JSON.parse(value.data).status; } catch { /* An application error can carry plain text. */ } if (AUTH_FAILURE.has(status)) { this.pauseAuthorization(status); return; } }
                this.emit(new MessageEvent(value.type, { data: value.data, lastEventId: value.lastEventId, origin: base.origin }));
              },
            });
            while (!this.closed && !this.authPaused) {
              const chunk = await reader.read(); if (chunk.done) { parser.push(decoder.decode(), true); break; }
              parser.push(decoder.decode(chunk.value, { stream: true }));
            }
            if (!this.closed && !this.authPaused) this.fail();
          } catch (error) {
            if (!this.closed && !this.authPaused && error.name !== 'AbortError') this.fail(0, error.message);
            if (error instanceof RangeError) this.close();
          }
          finally { if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); } }
          if (this.closed || this.authPaused) break;
          this.readyState = 0;
          await new Promise(resolveWait => {
            if (this.controller.signal.aborted) { resolveWait(); return; }
            const finish = () => { clearTimeout(timer); this.controller.signal.removeEventListener('abort', finish); resolveWait(); };
            const timer = setTimeout(finish, this.delay); this.controller.signal.addEventListener('abort', finish, { once: true });
          });
        }
      } finally {
        this.running = false;
        if (this.restartRequested && !this.closed) { this.restartRequested = false; this.authPaused = false; queueMicrotask(() => this.resume()); }
      }
    }
    close() { this.closed = true; this.readyState = 2; this.controller?.abort(); streams.delete(this); }
  }
  return {
    request, matches, EventSource: LegacyEventSource,
    updateCredentials(nextToken) {
      bearer = nextToken || null;
      for (const stream of streams) {
        // Release the old reader before opening a replacement with the new token.
        if (stream.running) { stream.restartRequested = true; stream.authPaused = true; stream.controller?.abort(); }
        else { stream.authPaused = false; void stream.resume(); }
      }
    },
    dispose() { for (const stream of [...streams]) stream.close(); },
  };
}

/** Install before the legacy client starts; unrelated fetch/EventSource calls pass through. */
export function installLegacyTransport({ target = globalThis, ...options } = {}) {
  const originalFetch = target.fetch, OriginalEventSource = target.EventSource;
  const transport = createLegacyTransport({ ...options, fetch: originalFetch.bind(target) });
  const wrappedFetch = (input, init) => transport.matches(input) ? transport.request(input, init) : originalFetch.call(target, input, init);
  class ScopedEventSource {
    static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
    constructor(url, configuration) {
      if (transport.matches(url)) return new transport.EventSource(url, configuration);
      if (!OriginalEventSource) throw new TypeError('Native EventSource is unavailable for this URL.');
      return new OriginalEventSource(url, configuration);
    }
  }
  target.fetch = wrappedFetch; target.EventSource = ScopedEventSource;
  return { ...transport, uninstall() { transport.dispose(); if (target.fetch === wrappedFetch) target.fetch = originalFetch; if (target.EventSource === ScopedEventSource) target.EventSource = OriginalEventSource; } };
}
