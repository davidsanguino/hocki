// `npm run pack`: compila Hocki con los ajustes del oído (whisper.cpp) para que el instalador
// funcione en cualquier PC, no solo en el servidor que compila. Luego llama a `tauri build`.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Los enlaces de whisper.cpp se generan en cada sistema (los que trae el paquete son de Linux y
// en Windows no encajan). Para eso hace falta libclang: los servidores de GitHub lo traen con LLVM.
const llvm = ["C:\\Program Files\\LLVM\\bin", "C:\\Program Files (x86)\\LLVM\\bin"].find((d) => existsSync(`${d}\\libclang.dll`));

const env = {
  ...(process.platform === "win32" && llvm ? { LIBCLANG_PATH: llvm } : {}),
  // Instrucciones de CPU comunes (AVX2) en vez de las del servidor que compila.
  GGML_NATIVE: "OFF",
  GGML_AVX: "ON",
  GGML_AVX2: "ON",
  GGML_FMA: "ON",
  GGML_F16C: "ON",
  ...process.env, // lo que ya venga definido manda
};

const cli = require.resolve("@tauri-apps/cli/tauri.js");
const r = spawnSync(process.execPath, [cli, "build", ...process.argv.slice(2)], { stdio: "inherit", env });
process.exit(r.status ?? 1);
