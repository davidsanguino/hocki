// Reconocimiento de voz de Windows (sin internet), visto como un reconocedor más.
// El trabajo lo hace Rust (voice_native.rs); aquí solo se traducen sus líneas:
//   HEARD:<texto> → frase reconocida, ERR:<motivo> → fallo, END → el proceso terminó.

import type { RecognizerFactory, RecognizerLike } from "./voice-service";

export interface NativeIO {
  start(): Promise<boolean>;
  stop(): Promise<void>;
  /** Escucha las líneas del reconocedor; devuelve cómo dejar de escuchar. */
  listen(handler: (line: string) => void): Promise<() => void>;
}

/** Interpreta una línea del reconocedor. */
export function parseNativeLine(line: string): { kind: "heard"; text: string } | { kind: "error"; reason: string } | { kind: "ready" } | { kind: "end" } | null {
  if (line.startsWith("HEARD:")) {
    const text = line.slice(6).trim();
    return text ? { kind: "heard", text } : null;
  }
  if (line.startsWith("ERR:")) return { kind: "error", reason: line.slice(4).trim() || "other" };
  if (line === "READY") return { kind: "ready" };
  if (line === "END") return { kind: "end" };
  return null;
}

export function nativeRecognizerFactory(io: NativeIO): RecognizerFactory {
  return () => {
    let unlisten: (() => void) | null = null;
    let active = false;
    const rec: RecognizerLike = {
      lang: "es-CO",
      continuous: true,
      interimResults: false,
      onresult: null,
      onend: null,
      onerror: null,
      start() {
        active = true;
        void (async () => {
          unlisten = await io.listen((line) => {
            const m = parseNativeLine(line);
            if (!m || !active) return;
            if (m.kind === "heard") rec.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: m.text } }] });
            else if (m.kind === "error") { active = false; rec.onerror?.({ error: m.reason }); }
            else if (m.kind === "end") { active = false; rec.onerror?.({ error: "unsupported" }); }
          });
          const ok = await io.start();
          if (!ok && active) { active = false; rec.onerror?.({ error: "unsupported" }); }
        })();
      },
      stop() {
        active = false;
        unlisten?.();
        unlisten = null;
        void io.stop();
      },
    };
    return rec;
  };
}
