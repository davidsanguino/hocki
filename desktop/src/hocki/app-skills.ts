// Lo que Hocki sabe hacer dentro de cada programa: los atajos de teclado oficiales,
// dichos en español. Se envían con el formato de SendKeys de Windows:
//   ^ = Ctrl, + = Shift, % = Alt, {F12}, {ENTER}, {DELETE}, {TAB}, {ADD} (+ del teclado numérico)…
// Los caracteres + ^ % ~ ( ) { } [ ] van entre llaves cuando son literales: {]}.
//
// Fuentes (atajos por defecto; si cambiaste los tuyos, Hocki usa los de fábrica):
//   Premiere Pro: helpx.adobe.com/premiere-pro/using/default-keyboard-shortcuts
//   SketchUp: help.sketchup.com/default-keyboard-shortcuts
//   AutoCAD: autodesk.com/shortcuts/autocad
//   Word: support.microsoft.com "Keyboard shortcuts in Word"
//   Photoshop / Illustrator: guías de atajos de Adobe (CC) y Noble Desktop
//   Blender: manual oficial, "Default Keymap"
// "delicate": borra, envía o publica algo → Hocki pregunta antes, aunque tenga permiso.

export interface Skill {
  id: string;
  /** Cómo se dice (minúsculas, sin tildes). Gana la frase más larga. */
  say: string[];
  keys: string;
  label: string;
  delicate?: boolean;
}

const s = (id: string, label: string, keys: string, say: string[], delicate = false): Skill =>
  ({ id, label, keys, say, ...(delicate ? { delicate } : {}) });

/** Lo que casi todos los programas de Windows entienden. */
export const COMMON: Skill[] = [
  s("save", "Guardar", "^s", ["guarda", "guardar", "guardalo", "guarda el archivo", "guarda los cambios"]),
  s("saveas", "Guardar como", "^+s", ["guardar como", "guarda como"]),
  s("undo", "Deshacer", "^z", ["deshaz", "deshacer", "deshazlo", "atras", "vuelve atras"]),
  s("redo", "Rehacer", "^y", ["rehaz", "rehacer", "rehazlo"]),
  s("copy", "Copiar", "^c", ["copia", "copiar", "copialo"]),
  s("paste", "Pegar", "^v", ["pega", "pegar", "pegalo"]),
  s("cut", "Cortar", "^x", ["corta", "cortar", "cortalo"]),
  s("all", "Seleccionar todo", "^a", ["selecciona todo", "seleccionar todo"]),
  s("new", "Nuevo", "^n", ["nuevo", "nuevo archivo", "nuevo documento", "archivo nuevo", "documento nuevo"]),
  s("open", "Abrir archivo", "^o", ["abre un archivo", "abrir archivo", "abre archivo"]),
  s("print", "Imprimir (abre el cuadro)", "^p", ["imprime", "imprimir"]),
  s("find", "Buscar", "^f", ["busca", "buscar"]),
  s("closedoc", "Cerrar el documento", "^w", ["cierra el documento", "cierra el archivo", "cerrar documento"]),
  s("zoomin", "Acercar", "^{ADD}", ["acerca", "acercar", "zoom mas", "mas zoom", "amplia"]),
  s("zoomout", "Alejar", "^{SUBTRACT}", ["aleja", "alejar", "zoom menos", "menos zoom", "reduce"]),
  s("enter", "Aceptar (Enter)", "{ENTER}", ["enter", "acepta", "aceptar", "dale enter"]),
  s("escape", "Cancelar (Esc)", "{ESC}", ["escape", "cancela eso", "sal de ahi"]),
  s("delete", "Borrar lo seleccionado", "{DELETE}", ["borra", "borrar", "elimina", "eliminar", "suprime", "borra eso"], true),
];

const OFFICE: Skill[] = [
  s("saveas", "Guardar como", "{F12}", ["guardar como", "guarda como"]),
  s("bold", "Negrita", "^b", ["negrita", "pon negrita", "en negrita"]),
  s("italic", "Cursiva", "^i", ["cursiva", "pon cursiva", "en cursiva"]),
  s("underline", "Subrayado", "^u", ["subraya", "subrayado", "subrayar"]),
  s("center", "Centrar", "^e", ["centra", "centrar", "centralo"]),
  s("left", "Alinear a la izquierda", "^l", ["alinea a la izquierda", "a la izquierda"]),
  s("right", "Alinear a la derecha", "^r", ["alinea a la derecha", "a la derecha"]),
  s("justify", "Justificar", "^j", ["justifica", "justificar"]),
  s("replace", "Reemplazar", "^h", ["reemplaza", "reemplazar"]),
  s("link", "Insertar enlace", "^k", ["inserta un enlace", "insertar enlace", "hipervinculo", "pon un enlace"]),
];

const ADOBE: Skill[] = [
  s("redo", "Rehacer", "^+z", ["rehaz", "rehacer", "rehazlo"]),
];

export const APP_SKILLS: Record<string, Skill[]> = {
  word: [...OFFICE, s("pagebreak", "Salto de página", "^{ENTER}", ["salto de pagina", "nueva pagina"])],
  excel: [...OFFICE, s("newsheet", "Hoja nueva", "+{F11}", ["hoja nueva", "nueva hoja"]),
    s("today", "Fecha de hoy", "^;", ["fecha de hoy", "pon la fecha"]), s("autosum", "Autosuma", "%=", ["autosuma", "suma automatica"])],
  powerpoint: [...OFFICE, s("newslide", "Diapositiva nueva", "^m", ["diapositiva nueva", "nueva diapositiva"]),
    s("present", "Presentar desde el inicio", "{F5}", ["presenta", "presentar", "empieza la presentacion"])],
  outlook: [s("newmail", "Correo nuevo", "^n", ["correo nuevo", "nuevo correo", "redacta un correo"]),
    s("reply", "Responder", "^r", ["responde", "responder"]), s("send", "Enviar", "%s", ["envia", "enviar", "envialo", "manda el correo"], true)],
  photoshop: [...ADOBE,
    s("saveas", "Guardar como", "^%s", ["guardar como", "guarda como"]),
    s("exportas", "Exportar como", "^%+w", ["exporta", "exportar", "exportar como"]),
    s("move", "Herramienta mover", "v", ["herramienta mover", "mover"]),
    s("marquee", "Marco", "m", ["marco", "herramienta marco", "seleccion rectangular"]),
    s("lasso", "Lazo", "l", ["lazo", "herramienta lazo"]),
    s("wand", "Varita / selección rápida", "w", ["varita", "varita magica", "seleccion rapida"]),
    s("crop", "Recortar", "c", ["recorta", "recortar", "herramienta recortar"]),
    s("eyedropper", "Cuentagotas", "i", ["cuentagotas"]),
    s("brush", "Pincel", "b", ["pincel", "herramienta pincel"]),
    s("eraser", "Borrador", "e", ["borrador", "herramienta borrador"]),
    s("gradient", "Degradado / bote", "g", ["degradado", "bote de pintura"]),
    s("text", "Texto", "t", ["texto", "herramienta texto"]),
    s("pen", "Pluma", "p", ["pluma", "herramienta pluma"]),
    s("hand", "Mano", "h", ["mano", "herramienta mano"]),
    s("zoomtool", "Zoom", "z", ["herramienta zoom"]),
    s("transform", "Transformación libre", "^t", ["transforma", "transformacion libre", "transformar"]),
    s("deselect", "Deseleccionar", "^d", ["deselecciona", "deseleccionar", "quita la seleccion"]),
    s("newlayer", "Capa nueva", "^+n", ["capa nueva", "nueva capa"]),
    s("merge", "Combinar visibles", "^+e", ["combina visibles", "combinar visibles", "une las capas"]),
    s("fit", "Ajustar a pantalla", "^0", ["ajusta a pantalla", "ajustar a pantalla", "ver todo"]),
    s("invert", "Invertir", "^i", ["invierte", "invertir colores"]),
    s("levels", "Niveles", "^l", ["niveles"]),
    s("curves", "Curvas", "^m", ["curvas"]),
  ],
  illustrator: [...ADOBE,
    s("export", "Exportar para pantallas", "^%e", ["exporta", "exportar", "exportar para pantallas"]),
    s("select", "Selección", "v", ["seleccion", "herramienta seleccion"]),
    s("direct", "Selección directa", "a", ["seleccion directa"]),
    s("pen", "Pluma", "p", ["pluma", "herramienta pluma"]),
    s("text", "Texto", "t", ["texto", "herramienta texto"]),
    s("rect", "Rectángulo", "m", ["rectangulo", "herramienta rectangulo"]),
    s("ellipse", "Elipse", "l", ["elipse", "circulo", "herramienta elipse"]),
    s("brush", "Pincel", "b", ["pincel"]),
    s("pencil", "Lápiz", "n", ["lapiz"]),
    s("eraser", "Borrador", "+e", ["borrador"]),
    s("artboard", "Mesa de trabajo", "+o", ["mesa de trabajo", "herramienta mesa de trabajo"]),
    s("rotate", "Rotar", "r", ["rotar", "girar"]),
    s("scale", "Escalar", "s", ["escalar", "escala"]),
    s("eyedropper", "Cuentagotas", "i", ["cuentagotas"]),
    s("hand", "Mano", "h", ["mano"]),
    s("group", "Agrupar", "^g", ["agrupa", "agrupar"]),
    s("ungroup", "Desagrupar", "^+g", ["desagrupa", "desagrupar"]),
    s("outlines", "Crear contornos", "^+o", ["crea contornos", "crear contornos", "contornear", "convierte a contornos"]),
    s("front", "Traer al frente", "^+{]}", ["trae al frente", "traer al frente", "al frente"]),
    s("back", "Enviar al fondo", "^+{[}", ["envia al fondo", "enviar al fondo", "al fondo"]),
    s("deselect", "Deseleccionar", "^+a", ["deselecciona", "deseleccionar"]),
    s("actual", "Tamaño real", "^1", ["tamano real", "al 100"]),
    s("fitall", "Ver todas las mesas", "^%0", ["ver todo", "ajusta a pantalla", "todas las mesas"]),
  ],
  premiere: [...ADOBE,
    s("import", "Importar", "^i", ["importa", "importar"]),
    s("export", "Exportar", "^m", ["exporta", "exportar", "exportar video", "renderiza"]),
    s("newproject", "Proyecto nuevo", "^%n", ["proyecto nuevo", "nuevo proyecto"]),
    s("razor", "Cuchilla", "c", ["cuchilla", "herramienta cuchilla", "tijera"]),
    s("select", "Selección", "v", ["seleccion", "herramienta seleccion"]),
    s("cutclip", "Agregar edición (cortar aquí)", "^k", ["corta aqui", "cortar aqui", "agrega un corte"]),
    s("play", "Reproducir / pausar", " ", ["reproduce", "reproducir", "pausa", "play"]),
    s("ripple", "Eliminar con cierre de huecos", "+{DELETE}", ["borra el hueco", "eliminar y cerrar", "ripple delete"], true),
  ],
  aftereffects: [...ADOBE, s("play", "Reproducir / pausar", " ", ["reproduce", "reproducir", "pausa", "play"])],
  indesign: [...ADOBE],
  blender: [
    s("save", "Guardar", "^s", ["guarda", "guardar"]),
    s("saveas", "Guardar como", "^+s", ["guardar como", "guarda como"]),
    s("undo", "Deshacer", "^z", ["deshaz", "deshacer"]),
    s("redo", "Rehacer", "^+z", ["rehaz", "rehacer"]),
    s("grab", "Mover", "g", ["mueve", "mover", "agarra"]),
    s("rotate", "Rotar", "r", ["rota", "rotar", "gira"]),
    s("scale", "Escalar", "s", ["escala", "escalar"]),
    s("extrude", "Extruir", "e", ["extruye", "extruir"]),
    s("edit", "Modo edición / objeto", "{TAB}", ["modo edicion", "modo objeto", "cambia de modo"]),
    s("render", "Renderizar imagen", "{F12}", ["renderiza", "renderizar", "render"]),
    s("search", "Buscar comando", "{F3}", ["busca un comando", "buscar comando", "busca"]),
    s("add", "Añadir objeto", "+a", ["anade", "agrega un objeto", "anadir objeto", "agregar objeto"]),
    s("all", "Seleccionar todo", "a", ["selecciona todo", "seleccionar todo"]),
    s("delete", "Borrar", "x", ["borra", "borrar", "elimina"], true),
  ],
  autocad: [
    s("redo", "Rehacer", "^y", ["rehaz", "rehacer"]),
    ...([
      ["line", "Línea", "l", ["linea", "dibuja una linea"]], ["circle", "Círculo", "c", ["circulo", "dibuja un circulo"]],
      ["arc", "Arco", "a", ["arco"]], ["pline", "Polilínea", "pl", ["polilinea"]], ["rect", "Rectángulo", "rec", ["rectangulo"]],
      ["move", "Desplazar", "m", ["mueve", "mover", "desplaza"]], ["copy", "Copiar objetos", "co", ["copia", "copiar"]],
      ["rotate", "Girar", "ro", ["rota", "gira", "girar"]], ["scale", "Escalar", "sc", ["escala", "escalar"]],
      ["trim", "Recortar", "tr", ["recorta", "recortar"]], ["extend", "Alargar", "ex", ["alarga", "alargar", "extiende"]],
      ["offset", "Desfase", "o", ["desfase", "equidistancia", "offset"]], ["mirror", "Simetría", "mi", ["simetria", "espejo"]],
      ["fillet", "Empalme", "f", ["empalme", "redondea"]], ["hatch", "Sombreado", "h", ["sombreado", "achurado", "rellena"]],
    ] as const).map(([id, label, cmd, say]) => s(id, label, `${cmd}{ENTER}`, [...say])),
    s("erase", "Borrar objetos", "e{ENTER}", ["borra", "borrar", "elimina"], true),
  ],
  sketchup: [
    s("select", "Seleccionar", " ", ["seleccionar", "herramienta seleccionar"]),
    s("paint", "Cubo de pintura", "b", ["pinta", "pintar", "cubo de pintura"]),
    s("eraser", "Borrador", "e", ["borrador"]),
    s("line", "Línea", "l", ["linea"]),
    s("rect", "Rectángulo", "r", ["rectangulo"]),
    s("circle", "Círculo", "c", ["circulo"]),
    s("arc", "Arco", "a", ["arco"]),
    s("move", "Mover", "m", ["mueve", "mover"]),
    s("push", "Empujar/tirar", "p", ["empuja", "empujar", "extruye", "empujar tirar"]),
    s("rotate", "Rotar", "q", ["rota", "rotar", "gira"]),
    s("scale", "Escala", "s", ["escala", "escalar"]),
    s("offset", "Equidistancia", "f", ["equidistancia", "offset"]),
    s("tape", "Cinta métrica", "t", ["cinta metrica", "mide", "medir"]),
    s("orbit", "Orbitar", "o", ["orbita", "orbitar"]),
    s("pan", "Desplazar vista", "h", ["desplaza la vista", "mano"]),
    s("zoomext", "Ver todo el modelo", "+z", ["ver todo", "zoom extension", "todo el modelo"]),
    s("component", "Crear componente", "g", ["crea un componente", "componente"]),
  ],
};
APP_SKILLS.correo = APP_SKILLS.outlook;

/** Las habilidades de una app: las suyas primero, luego las comunes que no choquen. */
export function skillsFor(appId: string): Skill[] {
  const own = APP_SKILLS[appId] ?? [];
  const ids = new Set(own.map((k) => k.id));
  const common = appId === "autocad" || appId === "sketchup"
    ? COMMON.filter((c) => !["delete", "zoomin", "zoomout"].includes(c.id))
    : COMMON;
  return [...own, ...common.filter((c) => !ids.has(c.id))];
}

/**
 * La habilidad que nombra una orden corta ("guarda", "herramienta pluma", "crea contornos").
 * Solo vale si la frase es casi toda la orden: así una charla normal no dispara atajos.
 */
export function matchSkill(text: string, skills: readonly Skill[]): Skill | null {
  let best: { k: Skill; len: number } | null = null;
  for (const k of skills) {
    for (const p of k.say) {
      const ok = text === p || (text.startsWith(p + " ") && text.length - p.length <= 14);
      if (ok && (!best || p.length > best.len)) best = { k, len: p.length };
    }
  }
  return best?.k ?? null;
}

/** Escapa un texto para escribirlo tal cual con SendKeys. */
export function sendKeysText(text: string): string {
  return text.replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`).replace(/\r?\n/g, "{ENTER}");
}
