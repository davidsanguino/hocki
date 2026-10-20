// Hocki como ayudante de herramientas de diseño, modelado, audio/video y Office.
//
// Qué es y qué NO es: Hocki conoce cada herramienta (qué lenguaje de scripts usa, dónde
// se ejecuta, atajos y flujos típicos) y, con la IA conectada, escribe scripts, macros y
// guías paso a paso. Los scripts los pega y ejecuta la persona (o se los entrega a Hocki
// con permiso); nada se ejecuta solo ni se modifica un archivo sin que la persona lo pida.

export type ToolGroup = "adobe" | "3d" | "cad" | "av" | "design" | "office";

export interface Tool {
  /** Mismo id que en el catálogo de apps (apps.ts) cuando existe. */
  id: string;
  name: string;
  group: ToolGroup;
  /** Cómo se automatiza. */
  scripting: string;
  /** Dónde se pega o ejecuta lo que Hocki escribe. */
  where: string;
  /** Ideas concretas de ayuda, para mostrar a la persona. */
  ideas: string[];
  aliases?: string[];
}

export const TOOLS: Tool[] = [
  // Adobe
  { id: "photoshop", name: "Photoshop", group: "adobe", scripting: "ExtendScript (.jsx) o UXP (JavaScript)",
    where: "Archivo → Scripts → Examinar… (o la consola de UXP)",
    ideas: ["Procesar por lotes: redimensionar, exportar y renombrar", "Acciones y scripts para retoque repetitivo", "Plantillas de redes sociales con texto variable", "Guía de máscaras, capas de ajuste y flujo no destructivo"] },
  { id: "illustrator", name: "Illustrator", group: "adobe", scripting: "ExtendScript (.jsx)",
    where: "Archivo → Scripts → Otra secuencia de comandos…",
    ideas: ["Exportar mesas de trabajo en lote", "Generar patrones y cuadrículas", "Ordenar y nombrar capas", "Vectorizar y limpiar trazados"] },
  { id: "premiere", name: "Premiere Pro", group: "adobe", scripting: "ExtendScript / CEP / UXP y atajos de teclado",
    where: "Archivo → Scripts, o el panel de extensiones",
    ideas: ["Plan de montaje y organización de bins", "Atajos y flujo de edición rápida", "Exportar con ajustes para YouTube, Instagram, TV", "Corrección de color y audio básico"] },
  { id: "aftereffects", name: "After Effects", group: "adobe", scripting: "ExtendScript (.jsx) y expresiones",
    where: "Archivo → Scripts → Ejecutar archivo de script…; las expresiones van en las propiedades",
    ideas: ["Expresiones (wiggle, loopOut, enlaces entre propiedades)", "Automatizar composiciones y renders", "Títulos animados reutilizables", "Rigs de personajes y parallax"] },
  { id: "audition", name: "Audition", group: "adobe", scripting: "Macros y mezclas multipista",
    where: "Panel Favoritos / Efectos", ideas: ["Limpieza de ruido y voz", "Cadena de efectos para podcast", "Normalizar y exportar por lotes"] },
  { id: "indesign", name: "InDesign", group: "adobe", scripting: "ExtendScript (.jsx)",
    where: "Ventana → Utilidades → Secuencias de comandos", ideas: ["Maquetar catálogos con datos", "Estilos de párrafo y carácter", "Exportar PDF para imprenta"] },
  { id: "lightroom", name: "Lightroom", group: "adobe", scripting: "Ajustes preestablecidos y sincronización",
    where: "Módulo Revelar", ideas: ["Flujo de edición de lotes", "Presets coherentes", "Exportación por destino"] },
  { id: "acrobat", name: "Acrobat", group: "adobe", scripting: "JavaScript de Acrobat y acciones",
    where: "Herramientas → Acciones, o consola de JavaScript", ideas: ["Combinar, dividir y comprimir PDF", "Formularios", "Reconocimiento de texto (OCR)"] },
  // 3D
  { id: "blender", name: "Blender", group: "3d", scripting: "Python (bpy)",
    where: "Espacio de trabajo Scripting → Text Editor → Run Script; por lotes: blender -b archivo.blend -P script.py",
    ideas: ["Scripts para crear y modificar objetos, materiales y cámaras", "Render por lotes y turntables", "Geometry Nodes paso a paso", "Importar/exportar formatos (FBX, glTF, OBJ)", "Optimizar mallas para juegos"] },
  { id: "maya", name: "Maya", group: "3d", scripting: "Python (maya.cmds) o MEL",
    where: "Script Editor (Windows → General Editors)",
    ideas: ["Automatizar rigs y nombres", "Herramientas de animación a medida", "Exportar a motores de juego", "Renombrar y ordenar la escena"] },
  { id: "3dsmax", name: "3ds Max", group: "3d", scripting: "MAXScript o Python",
    where: "Scripting → MAXScript Listener", ideas: ["Modelado arquitectónico paramétrico", "Renders por lotes", "Limpieza de escenas"] },
  { id: "sketchup", name: "SketchUp", group: "3d", scripting: "Ruby (API de SketchUp)",
    where: "Extensiones → Developer → Ruby Console",
    ideas: ["Componentes y etiquetas ordenados", "Generar mobiliario y cuadros de áreas", "Exportar vistas y escenas", "Flujos con LayOut"] },
  { id: "zbrush", name: "ZBrush", group: "3d", scripting: "ZScript y Subtools", where: "ZScript → Cargar", ideas: ["Flujo de escultura", "Retopología", "Exportar mapas"] },
  { id: "cinema4d", name: "Cinema 4D", group: "3d", scripting: "Python", where: "Extensiones → Consola / Script Manager", ideas: ["MoGraph", "Renders por lotes", "Scripts de escena"] },
  { id: "rhino", name: "Rhino", group: "3d", scripting: "Python (RhinoScript/rhinoscriptsyntax) y Grasshopper", where: "Comando RunPythonScript / Grasshopper", ideas: ["Superficies paramétricas", "Grasshopper para diseño generativo"] },
  { id: "unreal", name: "Unreal Engine", group: "3d", scripting: "Blueprints y Python", where: "Editor → Herramientas → Python", ideas: ["Blueprints paso a paso", "Importar activos en lote"] },
  // CAD
  { id: "autocad", name: "AutoCAD", group: "cad", scripting: "Scripts (.scr), AutoLISP y comandos",
    where: "Comando SCRIPT para .scr, APPLOAD para .lsp; por lotes: accoreconsole /s",
    ideas: ["Capas, bloques y estilos normalizados", "Rotulación y cuadros de áreas automáticos", "Exportar planos a PDF por lotes", "Atajos de comandos"] },
  { id: "revit", name: "Revit", group: "cad", scripting: "Dynamo y API de Revit (Python/C#)", where: "Pestaña Administrar → Dynamo", ideas: ["Parámetros compartidos y tablas", "Dynamo para tareas repetitivas"] },
  { id: "fusion360", name: "Fusion 360", group: "cad", scripting: "Python (API de Fusion)", where: "Utilidades → Scripts y complementos", ideas: ["Modelos paramétricos", "Exportar STL / planos"] },
  // Audio y video
  { id: "davinci", name: "DaVinci Resolve", group: "av", scripting: "Python/Lua (API de scripting)", where: "Espacio de trabajo → Consola, o scripts externos",
    ideas: ["Flujo de corte, color y audio (Fairlight)", "Exportar por lotes", "Organizar proyectos y marcadores"] },
  { id: "audacity", name: "Audacity", group: "av", scripting: "Macros y Nyquist", where: "Herramientas → Macros", ideas: ["Limpiar ruido", "Normalizar y exportar por lotes", "Cadena para podcast"] },
  { id: "obs", name: "OBS Studio", group: "av", scripting: "Escenas, fuentes y scripts (Lua/Python)", where: "Herramientas → Scripts", ideas: ["Escenas para clases, directos y grabación", "Audio y filtros"] },
  { id: "flstudio", name: "FL Studio", group: "av", scripting: "Piano roll y mezcla", where: "Piano roll", ideas: ["Estructura de canciones", "Mezcla y masterización básica"] },
  { id: "ableton", name: "Ableton Live", group: "av", scripting: "Max for Live y plantillas", where: "Dispositivos", ideas: ["Plantillas de sesión", "Mezcla"] },
  { id: "capcut", name: "CapCut", group: "av", scripting: "Plantillas y ajustes", where: "Editor", ideas: ["Cortes y subtítulos", "Formatos verticales"] },
  // Diseño
  { id: "figma", name: "Figma", group: "design", scripting: "Plugins (JavaScript/TypeScript) y variables", where: "Plugins → Desarrollo", ideas: ["Sistemas de diseño y componentes", "Plugins para renombrar y exportar", "Prototipos"] },
  { id: "gimp", name: "GIMP", group: "design", scripting: "Python-Fu / Script-Fu", where: "Filtros → Python-Fu → Consola", ideas: ["Edición por lotes"] },
  { id: "inkscape", name: "Inkscape", group: "design", scripting: "Extensiones en Python y línea de comandos", where: "Extensiones", ideas: ["Exportar en lote", "Limpieza de SVG"] },
  { id: "krita", name: "Krita", group: "design", scripting: "Python", where: "Herramientas → Scripts", ideas: ["Pinceles y flujo de ilustración"] },
  { id: "coreldraw", name: "CorelDRAW", group: "design", scripting: "VBA / macros", where: "Herramientas → Macros", ideas: ["Exportación por lotes"] },
  // Office
  { id: "word", name: "Word", group: "office", scripting: "Macros VBA, PowerShell (COM) o python-docx",
    where: "Alt+F11 (VBA); .ps1 con PowerShell; Python en la terminal",
    ideas: ["Plantillas de cartas, oficios y contratos con campos", "Estilos, índice y numeración automáticos", "Combinar correspondencia", "Revisar y resumir documentos"] },
  { id: "excel", name: "Excel", group: "office", scripting: "Fórmulas, Power Query, macros VBA, Office Scripts o openpyxl",
    where: "Alt+F11 (VBA), pestaña Automatizar (Office Scripts)",
    ideas: ["Fórmulas (BUSCARX, FILTRAR, SI.ERROR, tablas dinámicas)", "Limpiar y unir datos con Power Query", "Informes y gráficos automáticos", "Macros para tareas repetitivas"] },
  { id: "powerpoint", name: "PowerPoint", group: "office", scripting: "VBA o python-pptx",
    where: "Alt+F11 (VBA)", ideas: ["Estructura y guion de presentación", "Patrones de diapositiva coherentes", "Generar diapositivas desde datos"] },
  { id: "outlook", name: "Outlook", group: "office", scripting: "VBA o reglas", where: "Alt+F11 / Reglas", ideas: ["Reglas y plantillas de respuesta", "Resúmenes de correos y agenda"] },
  { id: "onenote", name: "OneNote", group: "office", scripting: "Plantillas y etiquetas", where: "Insertar → Plantillas", ideas: ["Orden de cuadernos", "Notas de reuniones"] },
  { id: "access", name: "Access", group: "office", scripting: "Consultas SQL, macros y VBA", where: "Crear → Consulta / Macro", ideas: ["Diseño de tablas y relaciones", "Consultas e informes"] },
  { id: "publisher", name: "Publisher", group: "office", scripting: "VBA", where: "Alt+F11", ideas: ["Folletos y volantes"] },
  { id: "visio", name: "Visio", group: "office", scripting: "VBA y plantillas", where: "Alt+F11", ideas: ["Diagramas de flujo", "Organigramas"] },
];

const GROUP_STYLE: Record<ToolGroup, string> = {
  adobe: "suite de Adobe", "3d": "modelado y animación 3D", cad: "diseño asistido (CAD/BIM)",
  av: "edición de audio y video", design: "diseño gráfico", office: "ofimática (Microsoft Office)",
};

export function toolById(id: string): Tool | undefined { return TOOLS.find((t) => t.id === id); }

/** Instrucciones para la IA mientras la persona trabaja con esta herramienta. */
export function toolPrompt(t: Tool): string {
  return [
    `Ahora ayudas a la persona con ${t.name} (${GROUP_STYLE[t.group]}).`,
    `Se automatiza con: ${t.scripting}. Se ejecuta en: ${t.where}.`,
    "Cuando pida automatizar o crear algo, entrégale el script o la macro COMPLETA en un bloque de código, lista para pegar, y dile en una línea dónde ejecutarla.",
    "Explica los pasos en orden y corto. Si una función no existe en esa versión, dilo en vez de inventarla; nunca inventes nombres de comandos.",
    "Avísale que pruebe primero en una copia del archivo antes de aplicar cambios masivos.",
    "Tú no ejecutas nada ni tocas sus archivos: los scripts los corre la persona. Para lo demás, guíala con claridad.",
  ].join(" ");
}

/** Texto de ayuda para mostrar en el chat. */
export function toolHelp(t: Tool): string {
  return `Con ${t.name} puedo ayudarte así:\n${t.ideas.map((i) => `• ${i}`).join("\n")}\nSe automatiza con ${t.scripting}. Pídeme lo que necesites, por ejemplo: «hazme un script para …». Cuando termines, escribe «salir de ${t.name}».`;
}
