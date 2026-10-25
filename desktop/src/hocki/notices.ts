// Aviso de privacidad y aviso legal del control de programas. Se muestran la primera vez que
// le das permiso a Hocki para manejar una app, y siempre en Ajustes o diciendo «aviso de privacidad».

export const PRIVACY_NOTICE = [
  "Aviso de privacidad — control de programas",
  "• Hocki maneja tus programas desde tu propio equipo: le manda atajos de teclado, escribe lo que le dictes y pulsa botones o menús por su nombre usando la accesibilidad de Windows.",
  "• «Estudia mi equipo»: con tu permiso, Hocki lee la lista de programas y apps del menú Inicio (solo nombres) y la refresca cada semana. No abre nada ni mira tus archivos; se guarda solo en este equipo.",
  "• Para «aprender» un programa lee solo los NOMBRES de sus botones y menús, y los guarda en este equipo. Eso no sale a internet.",
  "• Tareas completas («hazlo tú: …»): solo si lo aceptas, Hocki toma una captura de tu pantalla en cada paso y la envía a la IA que elegiste en Ajustes para decidir qué hacer; después la borra. Con un modelo local (Ollama, LM Studio) no sale de tu equipo; con uno en la nube (Anthropic, OpenAI, Google, OpenRouter) viaja a ese servicio, según sus condiciones, y puede costar créditos.",
  "• Al conversar con una IA en la nube, tu pregunta viaja a ese servicio; con un modelo local no sale nada.",
  "• Micrófono: solo con tu permiso y mientras la escucha está encendida. El oído de Hocki (Whisper) transcribe en tu equipo; el audio no se guarda ni sale a internet. Solo obedece cuando dices «¡Hey Hocki!».",
  "• Voz: el oído (Whisper, MIT) y la voz natural (Piper, MIT; voz es_MX «ald», con su propia licencia) se descargan una sola vez de Hugging Face y GitHub, con tu permiso.",
  "• Tu huella de voz (si la registras) son números, no audio, y se quedan en este equipo.",
  "• Puedes quitar el permiso de cualquier programa («quita el permiso de Word»), borrar tu voz («borra mi voz») y su memoria («olvida todo») cuando quieras.",
].join("\n");

export const LEGAL_NOTICE = [
  "Aviso legal",
  "• Hocki actúa solo en los programas que tú autorizas y por orden tuya, con un máximo de 15 pasos por tarea. Antes de borrar, enviar, publicar, comprar o sobrescribir algo, te pregunta. Nunca hace pagos ni escribe contraseñas.",
  "• Tú eres responsable de lo que le pidas hacer y de revisar el resultado: los atajos y botones pueden variar según la versión o si los personalizaste, y Hocki puede equivocarse.",
  "• Respeta las licencias y términos de cada programa: Hocki no salta protecciones, licencias ni restricciones de ningún software.",
  "• Di «Hocki fuera» para detenerlo todo al instante.",
].join("\n");
