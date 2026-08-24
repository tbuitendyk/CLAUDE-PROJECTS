/* ============================================================
   Union Trading Academy — CONFIGURACIÓN CENTRAL
   Todos los valores por conectar viven AQUÍ (ver CONFIG.md en
   el repositorio). Con un valor vacío ("") el sitio muestra el
   comportamiento de reserva correspondiente (sin errores).
   ============================================================ */
window.UTA_CONFIG = {
  // Número de WhatsApp de la academia, con código de país y sin "+".
  // Si WhatsApp reporta "número inválido" al abrir el chat, probar el
  // formato antiguo mexicano con "1" tras el 52: "5214772592167".
  WHATSAPP_NUMBER: "524772592167",

  // Texto pre-llenado del chat (general y de confirmación de cita).
  WHATSAPP_TEXT: "Hola, quiero más información sobre la mentoría de Union Trading Academy.",
  WHATSAPP_TEXT_GRACIAS: "Hola, acabo de reservar mi sesión estratégica con Union Trading Academy y confirmo mi asistencia.",

  // URL del evento de Calendly (cuenta del cliente), p. ej.:
  // "https://calendly.com/uniontradingacademy/sesion-estrategica"
  CALENDLY_URL: "",

  // Video principal (auto-alojado). Se muestra en la portada Y en /agenda/,
  // así que la ruta DEBE empezar con "/" para funcionar en ambas páginas:
  // "/assets/media/presentacion.mp4"
  VIDEO_SRC: "",

  // Link de pago de Mercado Pago (checkout alojado), cuando exista.
  MERCADOPAGO_LINK: ""
};
