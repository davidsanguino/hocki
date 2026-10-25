// Aprender rápido: atajos que le enseñas, consejos por campo digital y tareas que repite mejor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { HockiBrain, similarity } from "../src/hocki/brain.ts";
import { PermissionEngine } from "../src/hocki/permissions.ts";
import { AppAutomation } from "../src/hocki/apps.ts";
import { MemoryKV } from "../src/hocki/storage.ts";
import { domainsOf, expertContext, DOMAINS } from "../src/hocki/domains.ts";

function mk(extra = {}) {
  const engine = new PermissionEngine();
  const apps = new AppAutomation(engine, "windows");
  const launched = [];
  const kv = new MemoryKV();
  const b = HockiBrain.load({ engine, kv, apps, launch: (a) => { launched.push(a.id); }, ...extra });
  b.onboard = "done";
  return { b, launched, kv, engine, apps };
}

test("le enseñas un atajo y lo usa; lo recuerda y lo olvida cuando se lo pides", () => {
  const { b, launched, kv } = mk();
  assert.ok(b.handle("cuando diga modo diseño, abre Illustrator").text.includes("Aprendido"));
  assert.ok(b.handle("modo diseño").text.includes("necesito tu permiso"));
  b.handle("sí");
  assert.deepEqual(launched, ["illustrator"]);
  assert.ok(b.handle("Hocki modo diseño").text.includes("Abriendo"));
  assert.ok(b.handle("qué atajos te enseñé").text.includes("modo diseno"));
  const again = HockiBrain.load({ engine: new PermissionEngine(), kv, apps: new AppAutomation(new PermissionEngine(), "windows") });
  assert.equal(again.aliases["modo diseno"], "abre Illustrator");
  assert.ok(b.handle("olvida el atajo modo diseño").text.includes("Olvidé"));
});

test("sabe de campos digitales: consejos sin IA y enfoque experto para la IA", () => {
  const { b } = mk();
  assert.ok(b.handle("consejos de marketing").text.includes("objetivo medible"));
  assert.ok(b.handle("qué sabes de edición de video").text.includes("1080×1920"));
  assert.deepEqual(domainsOf("necesito un logo para imprimir en CMYK").map((d) => d.id), ["diseno"]);
  assert.ok(expertContext("hazme una fórmula de excel con buscarx").includes("Ofimática"));
  assert.ok(b.wrap("cómo hago un reel para instagram").includes("Enfoque experto"));
  assert.ok(DOMAINS.length >= 12);
});

test("una tarea que salió bien se reutiliza la próxima vez que pides algo parecido", () => {
  const starts = [];
  let finish;
  const agent = { start: (a, goal, learned, done, recipe) => { starts.push({ goal, recipe }); finish = done; return true; }, answer: () => false, waiting: () => false, busy: () => false, halt: () => {} };
  const { b } = mk({ agent, act: () => {} });
  b.handle("en Illustrator, hazlo tú: exporta el logo en PNG"); b.handle("sí"); b.handle("sí");
  assert.equal(starts[0].recipe, undefined);
  finish({ status: "done", message: "Listo", steps: 3, history: ["click (10,10) — Archivo", "click (20,40) — Exportar"] });
  assert.equal(b.recipes.length, 1);
  b.handle("en Illustrator, hazlo tú: exporta el logo en PNG grande");
  assert.equal(starts[1].recipe.goal, "exporta el logo en PNG");
  assert.ok(similarity("exporta el logo en PNG", "exporta el logo en PNG grande") >= 0.5);
  assert.ok(similarity("abre word", "cambia el color del fondo") < 0.5);
});
