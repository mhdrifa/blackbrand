/* BLACK BRAND — front-end configuration. Contains NO secrets (never put API secrets here). */
window.BB_CONFIG = {
  // Deployed Google Apps Script Web App (Code.gs)
  API_URL: "https://script.google.com/macros/s/AKfycbwApeG0HlQBDfcmqAbfdla_l3Ahm244Auv78k0wcfA4pfF85gHIz9xqvhpn5_jMwYQ-/exec",

  WHATSAPP_URL: "https://wa.me/94750789338",
  PHONE_DISPLAY: "+94 75 078 9338",
  PHONE_TEL: "+94750789338",

  // Customer sign-in uses Firebase Authentication (passwords never reach Google Sheets or Apps Script).
  // Paste your Firebase Web App config here to enable customer login/registration:
  // { apiKey: "...", authDomain: "...", projectId: "...", appId: "..." }
  FIREBASE: null
};
