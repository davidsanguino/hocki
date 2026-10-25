// Lo que Hocki sabe de los campos digitales: cuando una pregunta es de uno de ellos, le da a la
// IA el enfoque de un experto (y si no hay IA, Hocki responde con sus consejos básicos).

export interface Domain {
  id: string;
  name: string;
  /** Palabras que delatan el campo (minúsculas, sin tildes). */
  keys: RegExp;
  /** Cómo debe pensar la IA al responder. */
  expert: string;
  /** Consejos rápidos que Hocki da sin IA. */
  tips: string[];
}

export const DOMAINS: Domain[] = [
  {
    id: "diseno", name: "Diseño gráfico",
    keys: /\b(diseno|disenar|logo|logotipo|afiche|poster|flyer|volante|tipografia|fuente|paleta|colores|composicion|maqueta|mockup|vector|cmyk|rgb|pantone|impresion|imprenta|sangrado|tarjeta de presentacion)\b/,
    expert: "Responde como director de arte: jerarquía visual, retícula, contraste, tipografía (máximo 2 familias), paleta con códigos HEX/CMYK, formato de entrega (vector, sangrado 3 mm, 300 ppp para impresión, RGB para pantalla) y pasos concretos en Illustrator/Photoshop/Figma.",
    tips: [
      "Para impresión: CMYK, 300 ppp y 3 mm de sangrado; para pantalla: RGB y 72–150 ppp.",
      "Un logo debe funcionar en una sola tinta y a 16 px: pruébalo en blanco y negro antes de ponerle color.",
      "Máximo dos familias tipográficas por pieza; juega con peso y tamaño para la jerarquía.",
      "Regla 60-30-10 para la paleta: color dominante, secundario y de acento.",
      "Convierte el texto a contornos antes de enviar a imprenta (en Illustrator: Ctrl+Shift+O).",
    ],
  },
  {
    id: "marca", name: "Branding e identidad",
    keys: /\b(marca|branding|identidad|manual de marca|naming|eslogan|slogan|posicionamiento|tono de voz|arquetipo)\b/,
    expert: "Responde como estratega de marca: propósito, público objetivo, propuesta de valor, personalidad y tono, sistema visual (logo, colores, tipografías, iconografía) y un manual de uso con ejemplos de aplicación.",
    tips: [
      "Antes del logo, define en una frase a quién sirves, qué problema resuelves y por qué tú.",
      "Un manual de marca mínimo: versiones del logo, área de respeto, colores (HEX/CMYK/RGB), tipografías y usos incorrectos.",
      "Revisa en la SIC (Colombia) que el nombre no esté registrado antes de invertir en él.",
    ],
  },
  {
    id: "marketing", name: "Marketing digital y redes",
    keys: /\b(marketing|redes sociales|instagram|tiktok|facebook|linkedin|youtube|seo|sem|anuncios|ads|campana|contenido|engagement|alcance|seguidores|community|copy|embudo|leads|email marketing|hashtag)\b/,
    expert: "Responde como estratega de marketing digital: objetivo medible (KPI), público, embudo (atracción, consideración, conversión), calendario de contenidos por red, formatos recomendados, copy con llamada a la acción y cómo medir resultados.",
    tips: [
      "Define un objetivo medible por campaña (ej.: 50 mensajes de WhatsApp al mes), no 'más seguidores'.",
      "Regla 80/20: 80 % contenido que aporta valor, 20 % venta directa.",
      "En Reels/TikTok los primeros 3 segundos deciden: abre con el resultado o una pregunta.",
      "Publica con constancia (3–4 veces por semana) y revisa las métricas cada 15 días.",
      "Cada publicación necesita una llamada a la acción clara: escribe, guarda, comparte o compra.",
    ],
  },
  {
    id: "video", name: "Edición de video",
    keys: /\b(video|edicion de video|editar video|premiere|davinci|capcut|after effects|render|exportar video|clip|transicion|color grading|subtitulos|reel|corte|timeline|fps|bitrate)\b/,
    expert: "Responde como editor de video: estructura (gancho, desarrollo, cierre), ritmo de cortes, audio (voz a -6 dB, música a -18 dB aprox.), corrección de color, subtítulos y ajustes de exportación por plataforma (resolución, fps, códec H.264/H.265, bitrate).",
    tips: [
      "Reels/TikTok: 1080×1920, 30 fps, H.264. YouTube: 1920×1080 o 4K.",
      "Corta en el movimiento y quita silencios: el ritmo mantiene la atención.",
      "Primero el audio limpio, luego el color: un mal audio se nota más que una mala imagen.",
      "Subtítulos siempre: la mayoría ve los videos sin sonido.",
    ],
  },
  {
    id: "foto", name: "Fotografía y retoque",
    keys: /\b(foto|fotografia|retoque|retocar|lightroom|photoshop|exposicion|iso|apertura|obturacion|raw|balance de blancos|recortar foto|quitar fondo|piel)\b/,
    expert: "Responde como fotógrafo y retocador: triángulo de exposición, composición, flujo en RAW, ajustes en Lightroom (exposición, blancos/negros, HSL) y retoque no destructivo en Photoshop con capas de ajuste y máscaras.",
    tips: [
      "Retoca siempre en capas y con máscaras: nunca sobre la foto original.",
      "Dispara en RAW si vas a retocar: recuperas mucho más de luces y sombras.",
      "Regla de tercios y deja aire en la dirección de la mirada.",
    ],
  },
  {
    id: "web", name: "Diseño web y UX/UI",
    keys: /\b(pagina web|sitio web|landing|ux|ui|usabilidad|wireframe|prototipo|figma|wordpress|responsive|accesibilidad|botones|interfaz)\b/,
    expert: "Responde como diseñador UX/UI: objetivo del usuario, arquitectura de información, wireframe, componentes, accesibilidad (contraste AA, tamaños táctiles de 44 px), diseño responsive y una llamada a la acción por pantalla.",
    tips: [
      "Una pantalla, una acción principal: el botón importante debe ser el más visible.",
      "Contraste mínimo 4.5:1 en texto normal (WCAG AA).",
      "Diseña primero para móvil: la mayoría de visitas llegan desde el celular.",
    ],
  },
  {
    id: "codigo", name: "Programación",
    keys: /\b(programar|codigo|programacion|javascript|typescript|python|react|node|api|base de datos|sql|bug|error de codigo|git|github|flutter|kotlin|swift|html|css)\b/,
    expert: "Responde como desarrollador senior: entiende el objetivo, propone la solución más simple, da código completo y probado mentalmente, explica cómo ejecutarlo y cómo probarlo, y avisa de riesgos de seguridad.",
    tips: [
      "Lee el mensaje de error completo y la primera línea del stack: casi siempre dice el archivo y la línea.",
      "Haz commits pequeños con mensajes claros: deshacer un error es fácil.",
      "Nunca subas claves o contraseñas al repositorio: usa variables de entorno.",
    ],
  },
  {
    id: "datos", name: "Ofimática y datos",
    keys: /\b(excel|hoja de calculo|formula|tabla dinamica|grafico|buscarv|buscarx|word|powerpoint|presentacion|informe|macro|vba|dashboard|datos)\b/,
    expert: "Responde como experto en ofimática: fórmulas exactas (en español y con ';' como separador si aplica), pasos de menú, tablas dinámicas, formato condicional, macros VBA completas cuando ayuden, y buenas prácticas de presentación.",
    tips: [
      "BUSCARX reemplaza a BUSCARV: =BUSCARX(valor; rango_busqueda; rango_resultado).",
      "Convierte tus datos en Tabla (Ctrl+T): las fórmulas y gráficos se actualizan solos.",
      "En presentaciones: una idea por diapositiva y máximo 6 líneas de texto.",
    ],
  },
  {
    id: "3d", name: "3D, CAD y arquitectura",
    keys: /\b(3d|modelado|blender|sketchup|autocad|revit|render|planos|cad|maya|textura|malla|cotas|escala)\b/,
    expert: "Responde como modelador 3D/CAD: unidades y escala correctas, flujo de modelado, capas/colecciones, materiales y render, y scripts (Python en Blender, Ruby en SketchUp, LISP/comandos en AutoCAD) cuando automaticen.",
    tips: [
      "Define las unidades antes de empezar (metros o milímetros) y no las cambies a mitad.",
      "En AutoCAD trabaja en espacio modelo a escala 1:1 y escala solo en el espacio papel.",
      "En Blender aplica la escala (Ctrl+A) antes de modificadores y físicas.",
    ],
  },
  {
    id: "audio", name: "Audio y podcast",
    keys: /\b(audio|podcast|grabar voz|microfono|mezcla|master|audacity|ruido|ecualizacion|compresor|musica)\b/,
    expert: "Responde como ingeniero de audio: captación (distancia al micrófono, sala), limpieza de ruido, ecualización, compresión, normalización (-16 LUFS para podcast, -14 LUFS para streaming) y exportación.",
    tips: [
      "Graba a un palmo del micrófono y en un lugar con cortinas o ropa: menos eco.",
      "Para podcast normaliza a unos -16 LUFS.",
    ],
  },
  {
    id: "ecommerce", name: "Comercio electrónico",
    keys: /\b(tienda online|ecommerce|vender por internet|catalogo|pasarela de pago|wompi|mercado pago|shopify|woocommerce|envios|precio|inventario)\b/,
    expert: "Responde como consultor de e-commerce: catálogo y fotos, precios con márgenes y costos de envío, pasarelas de pago locales, confianza (políticas, reseñas reales), y métricas (conversión, ticket promedio).",
    tips: [
      "Fotos sobre fondo claro y al menos 3 por producto: frente, detalle y en uso.",
      "Muestra el costo de envío antes del pago: es la causa número uno de carritos abandonados.",
    ],
  },
  {
    id: "seguridad", name: "Seguridad digital",
    keys: /\b(seguridad|contrasena|hackeo|virus|phishing|estafa|copia de seguridad|backup|dos pasos|2fa|privacidad)\b/,
    expert: "Responde como experto en seguridad para personas y pymes: pasos prácticos y legales para proteger cuentas y datos, nunca técnicas de ataque.",
    tips: [
      "Activa la verificación en dos pasos en correo, redes y banco.",
      "Usa un gestor de contraseñas y una contraseña distinta por cuenta.",
      "Regla 3-2-1 de copias: 3 copias, 2 soportes, 1 fuera de casa.",
    ],
  },
  {
    id: "ia", name: "Inteligencia artificial y prompts",
    keys: /\b(ia|inteligencia artificial|prompt|chatgpt|claude|gemini|midjourney|generar imagen|automatizar con ia|agente)\b/,
    expert: "Responde como experto en IA aplicada: cómo escribir prompts (rol, contexto, tarea, formato, ejemplos), qué herramienta usar para cada caso, límites y verificación de resultados.",
    tips: [
      "Un buen prompt: rol + contexto + tarea concreta + formato de salida + un ejemplo.",
      "Pide a la IA que te haga preguntas antes de responder si el tema es complejo.",
      "Verifica datos, cifras y citas: la IA puede equivocarse con seguridad.",
    ],
  },
];

const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Los campos de los que habla una frase (los dos más claros). */
export function domainsOf(text: string): Domain[] {
  const t = plain(text);
  return DOMAINS.filter((d) => d.keys.test(t)).slice(0, 2);
}

/** El campo nombrado en "qué sabes de marketing", "consejos de video"… */
export function domainNamed(text: string): Domain | null {
  const t = plain(text);
  return DOMAINS.find((d) => plain(d.name).split(/[ ,y]+/).some((w) => w.length > 3 && t.includes(w)) || d.keys.test(t)) ?? null;
}

export function expertContext(text: string): string {
  const ds = domainsOf(text);
  return ds.length ? `Enfoque experto: ${ds.map((d) => `[${d.name}] ${d.expert}`).join(" ")}` : "";
}

export function tipsText(d: Domain): string {
  return `Lo esencial de ${d.name.toLowerCase()}:\n${d.tips.map((t) => `• ${t}`).join("\n")}\nPregúntame algo concreto y te ayudo paso a paso.`;
}
