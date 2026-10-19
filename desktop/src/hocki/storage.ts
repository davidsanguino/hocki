// Dónde se guardan las cosas de Hocki: solo en este dispositivo.
// El almacenamiento es intercambiable: el webview usa localStorage; las pruebas, memoria.

export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export class MemoryKV implements KV {
  private m = new Map<string, string>();
  get(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  set(k: string, v: string) { this.m.set(k, v); }
  remove(k: string) { this.m.delete(k); }
}

/** localStorage con red de seguridad: si no existe o falla, Hocki sigue funcionando sin guardar. */
export function browserKV(): KV {
  const ls = (): Storage | null => {
    try { return globalThis.localStorage ?? null; } catch { return null; }
  };
  return {
    get: (k) => { try { return ls()?.getItem(k) ?? null; } catch { return null; } },
    set: (k, v) => { try { ls()?.setItem(k, v); } catch { /* sin espacio o bloqueado */ } },
    remove: (k) => { try { ls()?.removeItem(k); } catch { /* nada */ } },
  };
}
