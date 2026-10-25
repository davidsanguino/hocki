// El ayudante de pantalla: entiende las respuestas de cualquier IA, convierte coordenadas,
// frena en lo delicado, se detiene a tiempo y nunca escribe secretos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAction, toSendKeys, runAgent, AgentController, buildPrompt } from "../src/hocki/screen-agent.ts";

test("lee la acción venga como venga: bloque de código, comas de más, point:[x,y]", () => {
  assert.deepEqual(parseAction('```json\n{"thought":"Veo Archivo","action":"click","x":20,"y":10,}\n```'),
    { action: "click", x: 20, y: 10, thought: "Veo Archivo" });
  assert.deepEqual(parseAction('Claro: {"action":"double-click","point":[5,6]}'), { action: "double_click", x: 5, y: 6 });
  assert.equal(parseAction('{"action":"click"}'), null, "un clic sin coordenadas no vale");
  assert.equal(parseAction("no sé"), null);
  assert.equal(parseAction('{"action":"format_disk"}'), null);
  assert.equal(parseAction('{"action":"done","text":"Listo"}').text, "Listo");
});

test("teclas de la IA a SendKeys; la tecla Windows no se manda", () => {
  assert.equal(toSendKeys("ctrl+s"), "^s");
  assert.equal(toSendKeys("Ctrl + Shift + S"), "^+s");
  assert.equal(toSendKeys("enter"), "{ENTER}");
  assert.equal(toSendKeys("alt+f4"), "%{F4}");
  assert.equal(toSendKeys("win+r"), null);
  assert.equal(toSendKeys("ctrl+ñ"), null);
});

function fakeIO(replies, extra = {}) {
  const log = [];
  let i = 0;
  const io = {
    snapshot: async () => ({ width: 1280, height: 720, scale: 0.5, left: 0, top: 0 }),
    think: async () => replies[Math.min(i++, replies.length - 1)],
    input: async (kind, x, y, text) => { log.push([kind, x, y, text]); return true; },
    focus: async () => true,
    say: (t) => log.push(["say", t]),
    confirm: async () => true,
    wait: async () => {},
    forget: () => log.push(["forget"]),
    ...extra,
  };
  return { io, log };
}

test("de la imagen a la pantalla: escala, escribe y termina", async () => {
  const { io, log } = fakeIO([
    '{"action":"click","x":100,"y":50,"thought":"Abro Archivo"}',
    '{"action":"type","text":"Hola (1)"}',
    '{"action":"keys","keys":"ctrl+s"}',
    '{"action":"done","text":"Guardé el archivo"}',
  ]);
  const r = await runAgent("guarda", "Word", io, { stopped: () => false });
  assert.equal(r.status, "done");
  assert.equal(r.message, "Guardé el archivo");
  const inputs = log.filter((l) => l[0] !== "say" && l[0] !== "forget");
  assert.deepEqual(inputs, [["click", 200, 100, ""], ["keys", 0, 0, "Hola {(}1{)}"], ["keys", 0, 0, "^s"]]);
  assert.deepEqual(log.at(-1), ["forget"], "la captura se borra al final");
});

test("lo delicado se pregunta; si dices que no, no lo hace", async () => {
  const asked = [];
  const { io, log } = fakeIO(['{"action":"click","x":10,"y":10,"thought":"Pulso Enviar"}'], {
    confirm: async (q) => { asked.push(q); return false; },
  });
  const r = await runAgent("manda el correo", "Outlook", io, { stopped: () => false });
  assert.equal(r.status, "stopped");
  assert.equal(asked.length, 1);
  assert.equal(log.filter((l) => l[0] === "click").length, 0);
});

test("contraseñas: se las deja a la persona; y se detiene con «para» o por pasos", async () => {
  const { io } = fakeIO(['{"action":"type","text":"1234","thought":"Escribo la contraseña"}']);
  assert.equal((await runAgent("entra", "App", io, { stopped: () => false })).status, "asked");
  let stop = false;
  const { io: io2, log } = fakeIO(['{"action":"click","x":1,"y":1}'], { input: async (...a) => { log.push(a); stop = true; return true; } });
  assert.equal((await runAgent("x", "App", io2, { stopped: () => stop })).status, "stopped");
  const { io: io3 } = fakeIO(['{"action":"wait"}']);
  const lim = await runAgent("x", "App", io3, { stopped: () => false, maxSteps: 3 });
  assert.equal(lim.status, "limit");
});

test("si la IA no ve imágenes o el programa está cerrado, lo dice claro", async () => {
  const { io } = fakeIO(["Lo siento, no puedo ver imágenes."]);
  const r = await runAgent("x", "App", io, { stopped: () => false });
  assert.equal(r.status, "error");
  assert.ok(r.message.includes("visión"));
  const { io: closed } = fakeIO(['{"action":"done"}'], { focus: async () => false });
  assert.ok((await runAgent("x", "Blender", closed, { stopped: () => false })).message.includes("abre Blender"));
  assert.ok(buildPrompt("exporta", "Illustrator", { width: 10, height: 20, scale: 1, left: 0, top: 0 }, [], []).includes("10x20"));
});

test("el controlador: una tarea a la vez, el «¿lo hago?» y el freno", async () => {
  const said = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const ctl = new AgentController(() => ({
    ...fakeIO(['{"action":"click","x":1,"y":1,"thought":"Borro la capa"}', '{"action":"done","text":"ok"}']).io,
    say: (t) => said.push(t),
    wait: () => gate,
  }));
  let result;
  assert.equal(ctl.start({ id: "photoshop", name: "Photoshop" }, "borra la capa", [], (r) => { result = r; }), true);
  assert.equal(ctl.start({ id: "photoshop", name: "Photoshop" }, "otra", [], () => {}), false, "una a la vez");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(ctl.waiting(), true);
  assert.ok(said.some((s) => s.includes("¿Lo hago?")));
  assert.equal(ctl.answer(true), true);
  release();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(result.status, "done");
  assert.equal(ctl.busy(), false);
});

test("una tarjeta de presentación no es un dato secreto; la contraseña sí", async () => {
  const { io, log } = fakeIO(['{"action":"type","text":"Ana Gómez","thought":"Escribo el nombre en la tarjeta de presentación"}', '{"action":"done","text":"ok"}']);
  assert.equal((await runAgent("x", "Illustrator", io, { stopped: () => false })).status, "done");
  assert.ok(log.some((l) => l[0] === "keys" && l[3] === "Ana Gómez"));
});
