const axios = require('axios');

const userStates = {};
const messageHistory = new Set();

// Función para iniciar o cambiar de flujo manteniendo la información existente del usuario.
// Si se desea limpiar completamente el estado (por ejemplo al escribir "inicio"), se debe
// eliminar manualmente la entrada en userStates antes de llamar a esta función.
function iniciarFlujo(from, flujo) {
  if (!userStates[from]) {
    userStates[from] = {};
  }
  userStates[from].flujo = flujo;
}

// Utilidad: formatea valores como moneda con separadores de miles

// Normaliza enlaces de Google Drive a descarga directa (evita .bin en Android)
function normalizeDriveLink(url) {
  try {
    if (!url || typeof url !== 'string') return url;
    if (url.includes('drive.google.com/uc?')) return url; // ya válido
    const byPath = url.match(/\/file\/d\/([^/]+)\//);
    if (byPath && byPath[1]) return `https://drive.google.com/uc?id=${byPath[1]}&export=download`;
    const byQuery = url.match(/[?&]id=([^&]+)/);
    if (byQuery && byQuery[1]) return `https://drive.google.com/uc?id=${byQuery[1]}&export=download`;
    return url;
  } catch { return url; }
}
/**
 * Formatea un número como moneda en formato colombiano. Si falla, devuelve el valor original.
 * @param {number|string} num
 * @returns {string|number}
 */
function formatCurrency(num) {
  try {
    return Number(num).toLocaleString('es-CO');
  } catch {
    return num;
  }
}

// Precio de cabeceros por TAMAÑO del colchón (no por diseño).  Se define
// fuera de formatCurrency para evitar mezclas de bloques try/catch.
function getCabeceroPriceBySize(sizeCode) {
  const map = {
    '100x190': 400000,
    '120x190': 430000,
    '140x190': 460000,
    '160x190': 520000,
    '200x200': 650000,
  };
  return map[sizeCode] || 0;
}

// Funciones para enviar mensajes
async function sendMessage(to, text) {
  const url = `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`;
  try {
    await axios.post(url, {
      messaging_product: 'whatsapp',
      to,
      text: { body: text }
    }, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('❌ Error al enviar mensaje:', error.response?.data || error.message);
  }
}

async function sendMedia(to, mediaUrl) {
  // No enviar si la URL está vacía o no comienza con "http"/"https".  Esto evita errores (#100) del API
  if (!mediaUrl || typeof mediaUrl !== 'string' || !/^https?:\/\//i.test(mediaUrl)) {
    console.warn('⚠️ Imagen no enviada: URL inválida o no proporcionada.');
    return;
  }
  const url = `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`;
  try {
    await axios.post(url, {
      messaging_product: 'whatsapp',
      to,
      type: 'image',
      image: { link: mediaUrl }
    }, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('❌ Error al enviar imagen:', error.response?.data || error.message);
  }
}

// ✅ Versión corregida para enviar PDFs correctamente
async function sendDocument(to, fileUrl, fileName = "catalogo.pdf") {
  const url = `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`;
  try {
    await axios.post(url, {
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: {
        link: normalizeDriveLink(fileUrl),
        filename: fileName, // nombre visible en WhatsApp
        mime_type: "application/pdf", // 🔥 fuerza a WhatsApp a reconocer el PDF
        caption: "📘 Catálogo Slumber - Productos y precios actualizados" // opcional
      }
    }, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("❌ Error al enviar documento:", error.response?.data || error.message);
  }
}


// Enviar un video a través de la API de WhatsApp.  Se utiliza para compartir videos informativos
// de productos (por ejemplo, el colchón Cuarzo).  El parámetro `videoUrl` debe apuntar a un
// archivo MP4 accesible públicamente.
async function sendVideo(to, videoUrl) {
  const url = `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`;
  try {
    await axios.post(url, {
      messaging_product: "whatsapp",
      to,
      type: "video",
      video: { link: videoUrl }
    }, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("❌ Error al enviar video:", error.response?.data || error.message);
  }
}

exports.verifyWebhook = (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ WEBHOOK VERIFICADO');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
};

exports.handleMessage = (req, res) => {
  const body = req.body;
  if (!body.object) return res.sendStatus(404);

  const entry = body.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;
  if (!value?.messages || !Array.isArray(value.messages)) return res.sendStatus(200);

  const message = value.messages[0];
  if (!message?.id || message.type !== 'text') return res.sendStatus(200);

  const from = message.from;
  const text = message.text?.body?.toLowerCase().trim();
  if (!text) return res.sendStatus(200);

  console.log(`[${new Date().toISOString()}] ${from}: "${text}" (ID: ${message.id})`);

  if (messageHistory.has(message.id)) {
    console.log(`🔁 Mensaje duplicado ignorado: ${message.id}`);
    return res.sendStatus(200);
  }
  messageHistory.add(message.id);
  setTimeout(() => messageHistory.delete(message.id), 5 * 60 * 1000);

  res.sendStatus(200);
  handleTextMessageAsync(from, text);
};

// Precios actualizados de colchones por medida según la lista proporcionada por el cliente.  Cada
// entrada corresponde al "Precio oferta" de la tabla compartida (septiembre 2025).  Se agregó
// el nuevo colchón Citrino de firmeza suave.
const precios = {
  onix: {
    '100x190': 730000,
    '120x190': 790000,
    '140x190': 900000,
    '160x190': 990000,
    '200x200': 1240000
  },
  opalo: {
    '100x190': 890000,
    '120x190': 990000,
    '140x190': 1120000,
    '160x190': 1230000,
    '200x200': 1520000
  },
  cuarzo: {
    '100x190': 1120000,
    '120x190': 1210000,
    '140x190': 1310000,
    '160x190': 1440000,
    '200x200': 1860000
  },
  zafiro: {
    '100x190': 1170000,
    '120x190': 1300000,
    '140x190': 1460000,
    '160x190': 1650000,
    '200x200': 2020000
  },
  // Nuevo colchón Citrino con precios por medida
  citrino: {
    '100x190': 1660000,
    '120x190': 1710000,
    '140x190': 1830000,
    '160x190': 2170000,
    '200x200': 2720000
  },
  agata: {
    '100x190': 1900000,
    '120x190': 1970000,
    '140x190': 2120000,
    '160x190': 2470000,
    '200x200': 3040000
  },
  ambar: {
    '100x190': 2520000,
    '120x190': 2670000,
    '140x190': 2880000,
    '160x190': 3290000,
    '200x200': 4160000
  }
};

// Precios anteriores de colchones (antes de la oferta).  Esta estructura se utiliza
// únicamente para mostrar al cliente el valor original y el valor en promoción.
const preciosAntes = {
  onix: {
    '100x190': 1043000,
    '120x190': 1129000,
    '140x190': 1286000,
    '160x190': 1415000,
    '200x200': 1772000
  },
  opalo: {
    '100x190': 1272000,
    '120x190': 1415000,
    '140x190': 1600000,
    '160x190': 1756000,
    '200x200': 2172000
  },
  cuarzo: {
    '100x190': 1600000,
    '120x190': 1729000,
    '140x190': 1871000,
    '160x190': 2058000,
    '200x200': 2659000
  },
  zafiro: {
    '100x190': 1672000,
    '120x190': 1856000,
    '140x190': 2087000,
    '160x190': 2357000,
    '200x200': 2884000
  },
  citrino: {
    '100x190': 2370000,
    '120x190': 2444000,
    '140x190': 2613000,
    '160x190': 3099000,
    '200x200': 3888000
  },
  agata: {
    '100x190': 2713000,
    '120x190': 2815000,
    '140x190': 3029000,
    '160x190': 3442000,
    '200x200': 4342000
  },
  ambar: {
    '100x190': 3598000,
    '120x190': 3812000,
    '140x190': 4112000,
    '160x190': 4698000,
    '200x200': 5942000
  }
};

const imagenesColchones = {
  agata: 'https://drive.google.com/uc?export=view&id=1eW904GSkyXTf9fEJbnHmwxSGChqyMaqP',
  ambar: 'https://drive.google.com/uc?export=view&id=1ImhHCf47gFkdjHE_uuvacqfKvFSox0rp',
  cuarzo: 'https://drive.google.com/uc?export=view&id=1BIHXoXGVSvhMPg5CqmiPHlXG8_3Ot-N_',
  onix: 'https://drive.google.com/uc?export=view&id=1FIzC9TiPmfA8cBxAisLxmXJG1KguYSzj',
  opalo: 'https://drive.google.com/uc?export=view&id=1xpauEK6WFl9QQnX9I5eBPjLnCiFnU2Wh',
  zafiro: 'https://drive.google.com/uc?export=view&id=1GufBYJLKJIBt9btsb5olXv52VHC4TRTf',
  // Nuevo colchón Citrino: debes reemplazar la URL por la imagen real del producto cuando esté disponible
  citrino: 'URL_IMG_COLCHON_CITRINO'
};

// URLs de los catálogos en PDF.  Los enlaces de Google Drive se transforman a formato
// "uc?export=view" para que WhatsApp pueda previsualizarlos correctamente.  Si prefieres que
// se descarguen automáticamente, cambia `export=view` por `export=download`.
// Utilizamos enlaces de descarga directa de Google Drive.  Al usar `export=download` se fuerza
// la descarga del archivo y se garantiza que WhatsApp lo identifique como PDF.
// Para que Google Drive sirva el PDF directamente, usamos `https://drive.google.com/uc?export=download&id=ID`.
// Asegúrate de que el archivo tenga permisos de “Cualquier persona con el enlace” para que WhatsApp pueda descargarlo.
// Enlaces a los catálogos alojados en GitHub (raw.githubusercontent.com).  Estos enlaces
// apuntan directamente a los archivos PDF sin pasar por la vista previa de GitHub.
const CATALOGO_BASECAMAS_PDF =
  'https://raw.githubusercontent.com/edissonm18/slumber-catalogos/194498a8214260b161b82a0843069abc5e8084ce/CAT%C3%81LOGO_DE_BASE%20CAMAS.pdf';
const CATALOGO_CABECEROS_PDF =
  'https://raw.githubusercontent.com/edissonm18/slumber-catalogos/194498a8214260b161b82a0843069abc5e8084ce/CAT%C3%81LOGO_DE_CABECEROS_SLUMBER_2025.pdf';


// Enlaces directos (Drive) para que el cliente elija diseños/formatos
const LINK_BASECAMAS = 'https://drive.google.com/file/d/1Dh-kBicMlKznzUSJ6I--It7FVmS4YHah/view?usp=drive_link';
const LINK_CABECEROS = 'https://drive.google.com/file/d/1ovCWWDLc3TqTFPXRiWZzahPKqToY1B0h/view?usp=drive_link';
const LINK_SALAS = 'https://drive.google.com/file/d/1676lKKkeEfLoBtEUn8runlsU_DnPDqgh/view?usp=sharing';
const LINK_MUEBLES = 'https://drive.google.com/file/d/1N6Ts6INZMhWdb0-zv4oZqI-sAhlmytoC/view?usp=sharing';

// Catálogo de muebles (salas y sofá camas).  Si prefieres cargar el PDF a través del
// endpoint `/media` de WhatsApp, reemplaza esta URL con el ID retornado por la API.
const CATALOGO_MUEBLES_PDF =
  'https://raw.githubusercontent.com/edissonm18/slumber-catalogos/194498a8214260b161b82a0843069abc5e8084ce/CAT%C3%81LOGO_DE_MUEBLES_SLUMBER_2025.pdf';

// Imagen del único sofá cama disponible (Bianca).  Utiliza un enlace directo de Google Drive.
const SOFASCAMA_BIANCA_IMG =
  'https://drive.google.com/uc?export=view&id=1moTmQyuwylwSA3RH2PL9iF1RDxfPHLFt';

// Imagen del único juego de comedor disponible (Oliver).  Enlace directo de Google Drive.
const COMEDOR_IMAGE =
  'https://drive.google.com/uc?export=view&id=1N8oEWy5BhmiU8ex8CifDhPO4iHRs3viU';

// Definición del único producto de comedor.  Incluye una breve descripción y precio (null para "Consultar precio").
const COMEDOR_PRODUCT = {
  id: '1',
  nombre: 'Juego de Comedor Oliver',
  // Actualizado con el valor proporcionado por el cliente (1.690.000)
  precio: 1690000,
  descripcion: 'Juego de comedor para cinco puestos con mesa maciza en flor morado, tapa laminada personalizable y sillas tapizadas en tela antifluidos.'
};

// Imágenes de muebles disponibles para la opción "Comedores y muebles".  Convertimos las URLs de Google Drive a
// formato "uc?export=view" para que WhatsApp pueda previsualizarlas correctamente.
// Puff baúl: estructura Sajo, espuma de poliuretano de alta densidad, tela antifluidos; tapa en madera lacada.  Capacidad 1 puesto.
const MUEBLE_PUFF_IMG =
  'https://drive.google.com/uc?export=view&id=1J54mFwoVSimHtjB2C-86FE2FQCuJbZBL';
// Silla huevo mecedora: estructura Sajo, tela antifluidos, tapa en madera lacada, capacidad 1 puesto.
const MUEBLE_SILLA_HUEVO_IMG =
  'https://drive.google.com/uc?export=view&id=1AjJbV4AXfWLfr1ZupSwFzTsO05opwXPO';

// Imágenes de cada sala disponible.  Estas URLs apuntan a Google Drive en modo vista para permitir la previsualización en WhatsApp.
const SALA_L_MULTI_IMG =
  'https://drive.google.com/uc?export=view&id=1hmKHRNCtYTQ9RHFW09GeesB9bTBUPw9j';
const SALA_OSLO_IMG =
  'https://drive.google.com/uc?export=view&id=1NLRQ71ca44DfrDPFPt8cFN_wjqI1i2tF';
const SALA_TIPO_HUEVO_IMG =
  'https://drive.google.com/uc?export=view&id=1I5XApAvFfwaI00h-JdC6osMZJO-xnWAB';
const SALA_CLICK_FIJA_IMG =
  'https://drive.google.com/uc?export=view&id=1XPal74R6NL95KJY_gnB4W5zq7-WremUE';
const SALA_BIANCA_IMG =
  'https://drive.google.com/uc?export=view&id=1J5O42i_8USaJQoeS0xUI4thccHsp_rTE';

// Imágenes de cada tipo de base cama.  Estos valores son marcadores de posición; reemplázalos por las URLs
// de Google Drive o de tu servidor donde se alojen las fotos de cada base cama.
const BASE_DIVIDIDA_IMG = 'URL_IMAGEN_BASE_DIVIDIDA';
const BASE_CAJONES_IMG  = 'URL_IMAGEN_BASE_CAJONES';
const BASE_BAUL_IMG     = 'URL_IMAGEN_BASE_BAUL';
const BASE_NIDO_IMG     = 'URL_IMAGEN_BASE_NIDO';

// Imágenes de los cabeceros disponibles.  Estos valores son marcadores de posición; reemplázalos por
// las URLs de las imágenes de los cabeceros Roma, Torino, Florencia y Venecia.
const CABECERO_ROMA_IMG      = 'URL_IMAGEN_CABECERO_ROMA';
const CABECERO_TORINO_IMG    = 'URL_IMAGEN_CABECERO_TORINO';
const CABECERO_FLORENCIA_IMG = 'URL_IMAGEN_CABECERO_FLORENCIA';
const CABECERO_VENECIA_IMG   = 'URL_IMAGEN_CABECERO_VENECIA';

// Imágenes de almohadas y protectores.  Estos valores son marcadores de posición; reemplázalos por
// las URLs de las imágenes de cada tipo de almohada (tres modelos) y de los protectores (dos modelos).
const ALMOHADA1_IMG   = 'URL_IMAGEN_ALMOHADA1';
const ALMOHADA2_IMG   = 'URL_IMAGEN_ALMOHADA2';
const ALMOHADA3_IMG   = 'URL_IMAGEN_ALMOHADA3';
const PROTECTOR1_IMG  = 'URL_IMAGEN_PROTECTOR1';
const PROTECTOR2_IMG  = 'URL_IMAGEN_PROTECTOR2';

// Imagen de catálogo de almohadas y protectores (listado general)
// Se utilizan para ilustrar la lista de productos cuando el usuario selecciona la categoría
const ALMOHADAS_LIST_IMG  = 'https://drive.google.com/uc?export=download&id=1vbgjyjuhCLVxkRlRz1TIpLU8OrzjI5wx';
const PROTECTORES_LIST_IMG = 'https://drive.google.com/uc?export=download&id=1N7PBNEJp_B98GJLUBKUsxxjZZP27-m8K';
// ========= PAGO ANTICIPADO (transferencia) =========
const PAYMENT_ANTICIPADO_TEXT = [
  "🏦 *Pago anticipado (transferencia)*",
  "",
  "Empresa: *Slumber*",
  "Banco: *Bancolombia*",
  "Tipo de cuenta: *Ahorros*",
  "Número de cuenta: *231-000039-32*",
  "NIT: *901.770.087-1*",
  "",
  "📱 *Nequi o Daviplata:* 3102796080",
  "",
  "✳ *¿Qué deseas hacer ahora?*",
  // Sustituimos enumeraciones por emojis numéricos para compatibilidad
  '1️⃣ Finalizar pedido',
  '2️⃣ Ver opciones de pago',
  '↩ Escribe "inicio" para regresar al menú principal.'
].join("\n");

async function sendPagoAnticipado(from) {
  try {
    // Mensaje de pago anticipado con datos bancarios y opciones para continuar
    const mensaje =
      `🏦 *Pago anticipado (transferencia)*\n\n` +
      `Puedes pagar el 100% de tu compra por transferencia. Esta opción se utiliza para envíos fuera de las ciudades habilitadas para contraentrega o si prefieres anticipar el pago completo. Los datos bancarios son los siguientes:\n\n` +
      `• *Empresa:* Slumber\n` +
      `• *Banco:* Bancolombia\n` +
      `• *Cuenta:* 231-000039-32 (Ahorros)\n` +
      `• *NIT:* 901.770.087-1\n` +
      `• *Nequi / Daviplata:* 3102796080\n\n` +
      `✳ *¿Qué deseas hacer ahora?*\n` +
      // Utilizamos emojis numéricos en lugar de glifos que no se renderizan en algunos teléfonos.
      `${ENUM_ICONS[0]} *Finalizar pedido*\n` +
      `${ENUM_ICONS[1]} *Ver opciones de pago*\n` +
      `↩ *Escribe \"inicio\" para regresar al menú principal.`;
    await sendMessage(from, mensaje);
    // Actualizamos el estado para la siguiente interacción: menú del pago anticipado
    const state = (typeof getState === 'function') ? (getState(from) || {}) : (userStates[from] || {});
    if (typeof getState === 'function') {
      state.flujo = "pago_anticipado_info";
      state.pagoAnticipadoStep = 'menu';
      saveState(from, state);
    } else {
      if (!userStates[from]) userStates[from] = {};
      userStates[from].flujo = "pago_anticipado_info";
      userStates[from].pagoAnticipadoStep = 'menu';
    }
  } catch (e) {
    console.error("Error en sendPagoAnticipado:", e?.response?.data || e.message);
  }
}

// === Enumeración de opciones ===
// Algunas plataformas Android no renderizan correctamente los glifos «⿡», «⿢», etc. Para evitar
// cuadros con X, utilizamos emojis numéricos estándar.  Cada índice se corresponde con su
// posición en las listas de opciones.  Ejemplo: ENUM_ICONS[0] = '1️⃣', ENUM_ICONS[1] = '2️⃣', etc.
const ENUM_ICONS = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣'];

// === Precios de base cama por medida ===
// El precio de las bases varía según el tamaño del colchón.  Esta tabla refleja los valores
// suministrados por el usuario.  Si un valor es "no aplica", se omite la opción para esa medida.
const BASECAMAS_PRECIOS = {
  '100x190': { dividida: 400000, cajones: 800000, baul: 990000, nido: 650000 },
  '120x190': { dividida: 450000, cajones: 850000, baul: 1050000, nido: 700000 },
  '140x190': { dividida: 470000, cajones: 900000, baul: 1100000, nido: 780000 },
  '160x190': { dividida: 560000, cajones: 1010000 },
  '200x200': { dividida: 810000, cajones: 1510000 }
};

// === Precios de protectores por medida y diseño ===
// Los protectores tienen precios diferentes dependiendo del tamaño del colchón y del tipo de protector.
// Esta tabla mapea el nombre simplificado del protector (antifluido o termosellado) a los valores por medida.
const PROTECTORES_PRECIOS = {
  antifluido: {
    '100x190': 98000,
    '120x190': 117500,
    '140x190': 137500,
    '160x190': 157500,
    '200x200': 190000
  },
  termosellado: {
    '100x190': 45000,
    '120x190': 55000,
    '140x190': 65000,
    '160x190': 75000,
    '200x200': 90000
  }
};

/**
 * Genera las opciones disponibles de base cama según la medida seleccionada.
 * Siempre incluye una opción final para continuar sin base cama.
 * @param {string} sizeCode Medida del colchón (ej. "120x190")
 * @returns {Array<{id:string,nombre:string,precio:number|null}>}
 */
function getBasecamaOpcionesPorMedida(sizeCode) {
  const row = BASECAMAS_PRECIOS[sizeCode] || {};
  const opts = [];
  if (row.dividida) opts.push({ id: '1', nombre: 'Base cama dividida', precio: row.dividida });
  if (row.cajones)  opts.push({ id: '2', nombre: 'Base cama cajones',  precio: row.cajones  });
  if (row.baul)     opts.push({ id: '3', nombre: 'Base cama baúl',     precio: row.baul     });
  if (row.nido)     opts.push({ id: '4', nombre: 'Base cama nido',     precio: row.nido     });
  // Opción para no incluir base cama
  opts.push({ id: String(opts.length + 1), nombre: 'Continuar sin base cama', precio: null });
  return opts;
}

// === Mensaje para pago anticipado ===
// Detalla la información bancaria cuando el cliente decide pagar la totalidad anticipadamente.
const PAGO_ANTICIPADO_MSG = `
🏦 *Pago anticipado (transferencia)*

Puedes pagar el 100% de tu compra por transferencia. Esta opción se usa para envíos fuera de las
ciudades habilitadas para contraentrega o si prefieres anticipar el pago completo.  Los datos
bancarios son los siguientes:

🤝 *Slumber Muebles y Colchones agradece tu confianza*

• *Empresa:* Slumber
• *Banco:* Bancolombia
• *Cuenta:* 231-000039-32 (Ahorros)
• *NIT:* 901.770.087-1
• *Nequi / Daviplata:* 3102796080

✳ *¿Qué deseas hacer ahora?*
1️⃣ *Finalizar pedido*
2️⃣ *Ver opciones de pago*
↩ *Escribe \"inicio\" para regresar al menú principal.*
`;

// === Video promocional ===
// Enlace al video de promociones (formato descarga directa) que se mostrará en el nuevo flujo
const PROMOCION_VIDEO_URL = 'https://drive.google.com/uc?id=1K9YHyVyFJiSkBH0te607QnpxiinlfXuD&export=download';


// Video informativo del colchón Cuarzo.  Este enlace utiliza el formato de descarga directa de Google Drive
// para que WhatsApp Cloud API lo interprete correctamente como video.
const COLCHON_CUARZO_VIDEO =
  'https://drive.google.com/uc?export=download&id=1c6TJks_QdllFgtfgaywNaQEwqBBLcoBH';

// VIDEOS DE CADA COLCHÓN
// Al igual que con el colchón Cuarzo, cada vídeo debe estar alojado en un lugar accesible
// públicamente (por ejemplo, Google Drive con permisos “Cualquier persona con el enlace”) y
// usar la variante `uc?export=download` para que la Cloud API lo reconozca como MP4.
// Sustituye los valores de estas constantes por las URLs de los vídeos que compartirás.
const COLCHON_ONIX_VIDEO   = 'URL_VIDEO_COLCHON_ONIX';
// Videos proporcionados por el usuario para cada colchón (enlaces directos de Google Drive).
const COLCHON_OPALO_VIDEO  = 'https://drive.google.com/uc?export=download&id=1zJ2Vf2t_5r0qmgzOaqx8rxwmpm1oKLM4';
const COLCHON_ZAFIRO_VIDEO = 'https://drive.google.com/uc?export=download&id=1dSq7Pa9V3kl3lAgY0YPlYhtWCz6TbM0g';
const COLCHON_AGATA_VIDEO  = 'https://drive.google.com/uc?export=download&id=1qUzJMjfxVJ0OeebyFG45MRda9dNJGnKX';
const COLCHON_AMBAR_VIDEO  = 'https://drive.google.com/uc?export=download&id=1fJl-LTCJaX_Roo_aMqhX4p-kVIlQZfas';

// Video informativo del nuevo colchón Citrino.  Coloca aquí la URL de descarga directa cuando esté disponible.
const COLCHON_CITRINO_VIDEO = 'URL_VIDEO_COLCHON_CITRINO';

// Mapa de vídeos por tipo de colchón.  Esto permite enviar automáticamente el vídeo
// correspondiente según la selección del cliente sin añadir múltiples condiciones.
const VIDEOS_COLCHONES = {
  onix: COLCHON_ONIX_VIDEO,
  opalo: COLCHON_OPALO_VIDEO,
  cuarzo: COLCHON_CUARZO_VIDEO,
  zafiro: COLCHON_ZAFIRO_VIDEO,
  agata: COLCHON_AGATA_VIDEO,
  ambar: COLCHON_AMBAR_VIDEO,
  // Incluimos el vídeo del colchón Citrino, listo para usar cuando se disponga del enlace real
  citrino: COLCHON_CITRINO_VIDEO
};

function getOpcionesPagoMessage() {
  return [
    "💳 *Opciones de pago y financiación:*",
    "",
    `${ENUM_ICONS[0]} *Pago contraentrega*  `,
    `${ENUM_ICONS[1]} *Financiación con ADDI*  `,
    `${ENUM_ICONS[2]} *Crédito VANTI* `,
    `${ENUM_ICONS[3]} *Pago anticipado (transferencia)* `,
    `${ENUM_ICONS[4]} *Pago con tarjeta (crédito/débito) - Link Bold* `,
    "",
    "✳ Escribe el número de la opción que prefieras para más información."
  ].join("\n");
}

async function handleTextMessageAsync(from, text) {
  // Siempre obtenemos el estado del usuario al iniciar la función.  Esto evita errores
  // de referencia (Temporal Dead Zone) al acceder a `state` antes de declararlo.
  const state = userStates[from] || null;
  // Aseguramos que el texto recibido sea una cadena y removemos espacios innecesarios.
  const msg = (text || '').trim();
  // Atajos directos de catálogos
  try {
    const handled = await tryCatalogShortcuts(from, msg);
    if (handled) return;
  } catch(e) { console.error('shortcut error', e?.response?.data || e.message); }


  // ----- Modo manual: si el asesor está atendiendo la conversación, el bot no responde -----
  // Cuando state.flujo === 'manual', significa que el flujo automático ha finalizado y un asesor
  // humano se encargará del chat.  Permitimos únicamente volver al menú mediante "inicio".
  if (state && state.flujo === 'manual') {
    // Normalizamos el texto a minúsculas para comparar opciones de salida.
    const lower = msg.toLowerCase();
    if (['inicio', 'menú', 'menu', 'volver'].includes(lower)) {
      delete userStates[from];
      return sendMessage(from, getMenuMessage());
    }
    // No responder a otros mensajes mientras el asesor gestiona la conversación
    return;
  }

  // Nota: el manejo de flujo "manual" ya se realiza al inicio de esta función.  Si llegamos
  // hasta aquí, no estamos en modo manual y el bot puede continuar su flujo normal.

  // Saludos
  if (['hola', 'buenas', 'buenos días', 'buenos dias', 'buen día', 'buen dia', 'buenas tardes', 'buenas noches', 'saludos', 'qué tal', 'que tal', 'hey', 'hi', 'holi', 'holis'].some(k => text.includes(k))) {
    delete userStates[from];
    return sendMessage(from, getMenuMessage());
  }

  if (['inicio', 'menú', 'menu', 'volver'].includes(text)) {
    delete userStates[from];
    return sendMessage(from, getMenuMessage());
  }

  if (!state && ['1', 'colchon', 'colchones', 'combo', 'combos', 'cama', 'colchón', 'colchoncito', 
  'quiero colchon', 'quiero colchón', 'colchón doble', 'colchón queen', 'colchón king'].some(k => text.includes(k))) {
    iniciarFlujo(from, 'colchon');
    userStates[from].medida = null;
    userStates[from].dureza = null;
    userStates[from].tipo = null;
    return sendMessage(from, `
🛏️ *¿Qué medida de colchón estás buscando?*

1️⃣ *100x190* — Individual  
2️⃣ *120x190* — Semidoble  
3️⃣ *140x190* — Doble  
4️⃣ *160x190* — Queen  
5️⃣ *200x200* — King

✳ *Escribe el número de tu elección.*  
↩ *Escribe "inicio"* para regresar al menú principal.`);
  }

  // Menú principal: Salas y sofá camas (opción 2)
  if (!state && ['2', 'sala', 'salas', 'sofa', 'sofá', 'sofa cama', 'sofá cama', 'sofa camas', 'sofá camas'].some(k => text.includes(k))) {
    // Inicia el flujo de salas y sofá camas
    iniciarFlujo(from, 'salas');
    return sendMessage(from, `
🛋 *¿Qué producto te interesa?*

${ENUM_ICONS[0]} *Salas*  
${ENUM_ICONS[1]} *Sofá camas*

✳ *Escribe el número de tu elección.*
↩ *Escribe "inicio"* para regresar al menú principal.
    `);
  }

  // Menú principal: Comedores y muebles (opción 3)
  if (!state && ['3', 'comedor', 'comedores', 'mueble', 'muebles', 'sillas', 'silla', 'mesa', 'mesas'].some(k => text.includes(k))) {
    // Iniciamos el flujo de comedor y presentamos las opciones disponibles (comedores o muebles)
    iniciarFlujo(from, 'comedor');
    return sendMessage(from, `
🍽️ *¿Qué producto buscas?*

${ENUM_ICONS[0]} *Comedores*  
${ENUM_ICONS[1]} *Muebles*

✳ *Escribe el número de tu elección.*
↩ *Escribe "inicio"* para regresar al menú principal.`);
  }

  // Menú principal: Almohadas y protectores (opción 4)
  if (!state && ['4', 'almohada', 'almohadas', 'protector', 'protectores', 'almohada y protector', 'almohadas y protectores'].some(k => text.includes(k))) {
    // Inicia el flujo de almohadas y protectores
    iniciarFlujo(from, 'almohada');
    return sendMessage(from, `
😴 *¿Qué producto te interesa?*

${ENUM_ICONS[0]} *Almohadas*  
${ENUM_ICONS[1]} *Protectores*  

✳ *Escribe el número de tu elección.*
↩ *Escribe "inicio"* para regresar al menú principal.
    `);
  }

  // Menú principal: Promociones (opción 5)
  if (!state && ['5', 'promo', 'promoción', 'promocion', 'promociones', 'oferta', 'ofertas'].some(k => text.includes(k))) {
    iniciarFlujo(from, 'promociones');
    // Guardamos el producto en promoción para que al finalizar pedido NO aparezca "sin producto seleccionado"
    userStates[from] = userStates[from] || {};
    userStates[from].promoProducto = {
      categoria: 'colchon',
      tipo: 'onix',
      nombre: 'Colchón Ónix (Promoción)',
      medida: '140x190',
      precio: 790000,
      precioAntes: 1100000
    };
    // Preparamos el mensaje con la promoción actual y las opciones
    const promoMsg =
      `📢 ¡Gran Promoción Colchón Ónix! 🛏✨\n\n` +
      `Antes: ~$1.100.000~\n` +
      `👉 Hoy solo: $790,000\n` +
      `📏 Tamaño: 140 x 190 cm\n\n` +
      `🚚 Envío GRATIS en: Madrid, Facatativá, Mosquera, Funza, Bojacá, El Rosal y Bogotá.\n\n` +
      `🔥 ¡Aprovecha esta promoción limitada y lleva tu Colchón Ónix con la mejor calidad y al mejor precio!\n\n` +
      `✳ ¿Qué deseas hacer ahora?\n` +
      // Reemplazamos los glifos de enumeración por emojis numéricos para compatibilidad
      `${ENUM_ICONS[0]} Finalizar pedido\n` +
      `${ENUM_ICONS[1]} Ver opciones de pago\n` +
      `↩ Escribe "inicio" para regresar al menú principal.`;
    // Marcamos que la promoción ya fue mostrada para que el siguiente mensaje del usuario se interprete como acción
    userStates[from] = userStates[from] || {};
    userStates[from].promocionMostrada = true;
    // Enviamos el mensaje de la promoción y luego el video
    await sendMessage(from, promoMsg);
    await sendVideo(from, PROMOCION_VIDEO_URL);
    return;
  }

  // Menú principal: Pagos y financiación (opción 6)
  if (!state && ['6', 'pago', 'pagos', 'financiación', 'financiacion', 'finanzas', 'financiar', 'credito', 'crédito'].some(k => text.includes(k))) {
    // Redirigimos al flujo informativo de pagos y financiación, sin necesidad de seleccionar un producto
    iniciarFlujo(from, 'pago_info');
    return sendMessage(from, getOpcionesPagoMessage());
  }

  // Menú principal: Soporte al cliente (opción 7)
  if (!state && ['7', 'cliente', 'soporte', 'garantía', 'garantia', 'seguimiento', 'pedido', 'postventa', 'servicio'].some(k => text.includes(k))) {
    iniciarFlujo(from, 'soporte');
    // Reiniciamos cualquier solicitud o datos previos de soporte
    if (!userStates[from]) userStates[from] = {};
    userStates[from].soporteSolicitud = null;
    userStates[from].soporteDatos = null;
    return sendMessage(from, `
🛟 *Soporte al cliente*

¿En qué podemos ayudarte? Responde con tu solicitud y te pediremos los datos necesarios para atenderte.

↩ *Escribe "inicio"* para regresar al menú principal.
    `);
  }

  // Menú principal: Entregas (información general)
  if (!state && ['entrega', 'entregas', 'envío', 'envio', 'envíos', 'envios', 'domicilio', 'delivery'].some(k => text.includes(k))) {
    return sendMessage(from, `
🚚 *Entregas*

Realizamos entregas en varias ciudades del país.  
El tiempo de entrega y el costo del envío pueden variar según tu ubicación y el producto seleccionado.  
Para consultar tiempos y tarifas exactas, por favor proporciona tu ciudad y barrio o contacta a un asesor.

↩ *Escribe "inicio"* para regresar al menú principal.
    `);
  }

  // Menú principal: Ya soy cliente (garantía, seguimiento) y soporte (opción 7 o palabras clave relacionadas)
  if (!state && ['6', '7', 'cliente', 'soporte', 'garantía', 'garantia', 'seguimiento', 'pedido', 'postventa', 'servicio'].some(k => text.includes(k))) {
    // Redirigimos al flujo de soporte al cliente, unificando solicitudes de garantía y seguimiento.
    iniciarFlujo(from, 'soporte');
    // Reiniciamos cualquier solicitud o datos previos de soporte
    if (!userStates[from]) userStates[from] = {};
    userStates[from].soporteSolicitud = null;
    userStates[from].soporteDatos = null;
    return sendMessage(from, `
🛟 *Soporte al cliente*

¿En qué podemos ayudarte? Responde con tu solicitud y te pediremos los datos necesarios para atenderte.

↩ *Escribe "inicio"* para regresar al menú principal.
    `);
  }

  if (state?.flujo === 'colchon') {
    const medidasValidas = {
      '1': '100x190', '2': '120x190', '3': '140x190', '4': '160x190', '5': '200x200',
      'individual': '100x190', 'semidoble': '120x190', 'doble': '140x190', 'queen': '160x190', 'king': '200x200'
    };

    const firmezas = {
      '1': 'suave', '2': 'intermedia', '3': 'firme',
      'suave': 'suave', 'intermedia': 'intermedia', 'intermedio': 'intermedia', 'firme': 'firme'
    };

    const opcionesPorFirmeza = {
      // Se añadió el nuevo colchón Citrino a la categoría de firmeza suave
      suave: ['cuarzo', 'ambar', 'citrino'],
      intermedia: ['agata', 'opalo'],
      firme: ['zafiro', 'onix']
    };

    if (!state.medida) {
      const medida = medidasValidas[text];
      if (!medida) return sendMessage(from, `❗ No entendí la medida. Por favor selecciona una *opción válida*.`);
      userStates[from].medida = medida;
      return sendMessage(from, `
📏 *Medida seleccionada:* ${medida}

⚖️ *Elige la firmeza que prefieras:*  
1️⃣ *Suave*  
2️⃣ *Intermedia*  
3️⃣ *Firme*

✳ *Escribe el número de tu elección.*`);
    }

    if (!state.dureza) {
      const dureza = firmezas[text];
      if (!dureza) return sendMessage(from, `❗ No entendí la firmeza. Elige entre *suave*, *intermedia* o *firme*.`);
      const opciones = opcionesPorFirmeza[dureza];
      userStates[from].dureza = dureza;
      userStates[from].opcionesDisponibles = opciones;

      let mensajeOpciones = `
✅ *Medida seleccionada:* ${state.medida}  
✅ *Firmeza seleccionada:* ${dureza.toUpperCase()}

✨ *Colchones disponibles:*\n`;

      opciones.forEach((tipo, index) => {
        const emoji = ['1️⃣', '2️⃣', '3️⃣'][index] || '▪️';
        const precioOferta = precios[tipo]?.[state.medida] || 'No disponible';
        const precioAntesVal = preciosAntes[tipo]?.[state.medida] || null;
        const precioAntesTxt = (typeof precioAntesVal === 'number') ? `~$${formatCurrency(precioAntesVal)}~` : '';
        const precioOfertaTxt = (typeof precioOferta === 'number') ? `$${formatCurrency(precioOferta)}` : precioOferta;
        const descripciones = {
          onix: 'Ortopédico firme con soporte extra.',
          opalo: 'Equilibrado, ideal para uso diario.',
          cuarzo: 'Anatómico, ideal para personas con dolores de espalda.',
          zafiro: 'Alta firmeza con diseño elegante.',
          agata: 'Mayor soporte y doble pillow.',
          ambar: 'Gama premium, suave y con acabados de lujo.',
          // Descripción del nuevo colchón Citrino
          citrino: 'Suave anatómico con soporte confortable.'
        };
        // Mostramos tanto el precio original como el de oferta.  Si el valor original no está
        // disponible (nulo), solo mostramos el precio de oferta.
        let precioDetalle = '';
        if (precioAntesTxt) {
          precioDetalle += `💵 *Precio antes:* ${precioAntesTxt}\n`;
        }
        precioDetalle += `💰 *Precio oferta:* ${precioOfertaTxt}`;
        // Resaltamos el nombre del colchón, su descripción y los dos precios
        mensajeOpciones += `\n${emoji} *${tipo.toUpperCase()}*\n_${descripciones[tipo]}_\n${precioDetalle}\n`;
      });

      mensajeOpciones += `\n✳ *Escribe el número o nombre de tu colchón preferido.*  
↩ *Escribe "inicio"* para regresar al menú principal.`;

      return sendMessage(from, mensajeOpciones);
    }

    if (!state.tipo) {
      const tipoSeleccionado = state.opcionesDisponibles?.[parseInt(text) - 1] || text;
      if (!state.opcionesDisponibles.includes(tipoSeleccionado)) {
        return sendMessage(from, `⚠️ Esa opción no es válida. Escribe el *número* o el *nombre* de una opción mostrada.`);
      }

      userStates[from].tipo = tipoSeleccionado;
      const precio = precios[tipoSeleccionado]?.[state.medida] || 'No disponible';
      const imageUrl = imagenesColchones[tipoSeleccionado];

      if (imageUrl) await sendMedia(from, imageUrl);

      const precioOfertaVal = precio;
      const precioOfertaTxt = (typeof precioOfertaVal === 'number') ? `$${formatCurrency(precioOfertaVal)}` : precioOfertaVal;
      const precioAntesVal = preciosAntes[tipoSeleccionado]?.[state.medida] || null;
      const precioAntesTxt = (typeof precioAntesVal === 'number') ? `~$${formatCurrency(precioAntesVal)}~` : null;
      // Componemos las líneas de precio: primero el precio antes (si existe) y luego la oferta
      let detallePrecio = '';
      if (precioAntesTxt) {
        detallePrecio += `💵 *Precio antes:* ${precioAntesTxt}\n`;
      }
      detallePrecio += `💰 *Precio oferta:* ${precioOfertaTxt}`;
      // Enviamos el mensaje con los detalles del colchón seleccionado y resaltamos cada apartado
      await sendMessage(from, `
🛒 *Detalle de tu colchón seleccionado:*

📏 *Medida:* ${state.medida}  
💎 *Tipo:* ${tipoSeleccionado.toUpperCase()}  
${detallePrecio}

✳️ *¿Qué deseas hacer ahora?*

1️⃣ *Ver opciones de pago*  
2️⃣ *Añadir cabecero y base cama*  
3️⃣ *Modificar la selección de colchón* 

✳ *Escribe el número de tu elección.*  
↩ *Escribe "inicio"* para regresar al menú principal.`);
      // Si hay un video asociado al tipo de colchón seleccionado, lo enviamos.
      const videoUrl = VIDEOS_COLCHONES[tipoSeleccionado];
      if (videoUrl && typeof videoUrl === 'string' && videoUrl.startsWith('http')) {
        await sendVideo(from, videoUrl);
      }
      return;
    }

    if (text === '1') {
      iniciarFlujo(from, 'pago');
      return sendMessage(from, getOpcionesPagoMessage());
    }

    // Opción 2: incluir cabecero y base cama. Se inicia el flujo de base cama,
    // se envía el menú de bases y a continuación el PDF correspondiente.
    if (text === '2') {
      iniciarFlujo(from, 'basecama');
      // Reiniciamos cualquier selección previa de base cama antes de mostrar el menú
      if (!userStates[from]) userStates[from] = {};
      userStates[from].basecamaTipo = null;
      userStates[from].basecamaProducto = null;
      userStates[from].basecama = null;
      // Construimos el texto para la selección de base utilizando la medida elegida anteriormente.  
      // Evitamos repetir la medida en cada opción para un mensaje más limpio.  
      const medidaBase = state.medida || '';
      // Generamos las opciones de base cama en función del tamaño del colchón.  Si una
      // determinada base no aplica para la medida seleccionada, no se incluirá.  Cada
      // opción se enumerará utilizando los emojis numéricos definidos en ENUM_ICONS.
      const baseOpts = getBasecamaOpcionesPorMedida(medidaBase);
      let mensajeBase = `\n🛏️ *Base de cama para tu colchón de ${medidaBase}:*  \n\n`;
      baseOpts.forEach((opt, idx) => {
        const icon = ENUM_ICONS[idx] || `${idx + 1}️⃣`;
        // Para la opción "sin base" no mostramos precio ni asterisco de producto.
        if (opt.precio) {
          mensajeBase += `${icon} *${opt.nombre}* — $${formatCurrency(opt.precio)}  \n`;
        } else {
          mensajeBase += `${icon} *${opt.nombre}*  \n`;
        }
      });
      mensajeBase += '\n🔗 Mira opciones aquí: https://drive.google.com/file/d/1Dh-kBicMlKznzUSJ6I--It7FVmS4YHah/view?usp=drive_link  \n\n' +
        '✳ *Responde con el número de tu elección.*  \n' +
        '↩ *Escribe "inicio"* en cualquier momento para reiniciar tu pedido.';
      await sendMessage(from, mensajeBase);
      // Enviar el catálogo de bases de cama en PDF.  El nombre del archivo se incluye
      // para que el usuario lo identifique fácilmente.
      return;
    }

    if (text === '3' || text === 'modificar') {
      iniciarFlujo(from, 'colchon');
      userStates[from].medida = null;
      userStates[from].dureza = null;
      userStates[from].tipo = null;
      // Reiniciamos la conversación de colchones solicitando de nuevo la medida
      await sendMessage(from, `🔁 *Vamos a comenzar de nuevo.* Por favor selecciona la medida del colchón.`);
      await sendMessage(from, `
🛏️ *¿Qué medida de colchón estás buscando?*

1️⃣ *100x190* — Individual  
2️⃣ *120x190* — Semidoble  
3️⃣ *140x190* — Doble  
4️⃣ *160x190* — Queen  
5️⃣ *200x200* — King

✳ *Escribe el número de tu elección.*  
↩ *Escribe "inicio"* para regresar al menú principal.`);
      return;
    }
  }

  if (state?.flujo === 'basecama') {
  // Generamos dinámicamente las opciones de base cama según la medida seleccionada.
  const medidaSeleccionada = state.medida || '';
  // Obtenemos la lista base de opciones (id, nombre, precio) y asociamos cada una con su imagen.
  const imageMapBase = {
    'Base cama dividida': BASE_DIVIDIDA_IMG,
    'Base cama cajones':  BASE_CAJONES_IMG,
    'Base cama baúl':     BASE_BAUL_IMG,
    'Base cama nido':     BASE_NIDO_IMG
  };
  const baseOpciones = getBasecamaOpcionesPorMedida(medidaSeleccionada).map(opt => {
    return {
      ...opt,
      imagen: opt.precio ? imageMapBase[opt.nombre] || null : null
    };
  });

  // Paso A: el usuario elige una opción de base cama.  Verificamos que el texto coincida con una id válida.
  if (!state.basecamaTipo && baseOpciones.some(o => o.id === text)) {
    // Guardamos la selección en el estado
    userStates[from].basecamaTipo = text;
    const seleccionado = baseOpciones.find(o => o.id === text);
    // Guardamos el producto completo para referencia posterior
    userStates[from].basecamaProducto = seleccionado;
    // Preparamos el texto del precio (si el precio es nulo, se interpreta como sin costo adicional)
    const precioTxt = (seleccionado.precio != null) ? `$${formatCurrency(seleccionado.precio)}` : 'Sin costo adicional';
    // Mensaje de detalle y opciones para continuar o modificar
    await sendMessage(from, `\n🛏️ *Detalle de tu selección de base cama:*\n\n• *Producto:* ${seleccionado.nombre}\n• *Precio:* ${precioTxt}\n\n✳ *¿Qué deseas hacer ahora?*\n1️⃣ *Continuar con cabecero*\n2️⃣ *Modificar selección*\n3️⃣ *Continuar sin cabecero*\n↩ *Escribe "inicio"* para regresar al menú principal.`);
    // Adjuntamos la imagen de la base seleccionada, si existe
    if (seleccionado.imagen) {
      await sendMedia(from, seleccionado.imagen);
    }
    return;
  }

  // Paso B: después de seleccionar la base cama, el usuario decide si continuar o modificar
  if (state.basecamaTipo) {
    // Continuar con cabecero
    if (text === '1') {
      // Guardamos la selección final: si la opción elegida tiene precio nulo, no incluimos base.
      const prod = state.basecamaProducto;
      userStates[from].basecama = (prod && prod.precio != null) ? prod.id : null;
      iniciarFlujo(from, 'cabecero');
      // Mostramos el catálogo de cabeceros y solicitamos selección
      {
        // Preparamos la lista de cabeceros para la medida seleccionada.  Mencionamos la medida
        // una única vez en el encabezado para no repetirla en cada opción.
        const cabMedida = state.medida || '';
        // Construimos el listado de cabeceros incluyendo la nueva opción para la medida 1,00×1,90
        /*
         * Para cabeceros, el precio varía solo por tamaño y no por diseño.  Eliminamos la
         * repetición del mismo precio en cada opción y en su lugar mostramos una lista de
         * diseños seguida de un único valor que aplica para todos.  Si la medida no tiene
         * precio definido, se indica "Consultar precio".
         */
        const cabPriceVal = getCabeceroPriceBySize(cabMedida);
        const cabPriceTxt = cabPriceVal ? `$${formatCurrency(cabPriceVal)}` : 'Consultar precio';
        const msgCab =
          `\n🛋️ *Cabeceros para tu colchón de ${cabMedida}:*\n\n` +
          `${ENUM_ICONS[0]} *Belén*  \n` +
          `${ENUM_ICONS[1]} *Roma*  \n` +
          `${ENUM_ICONS[2]} *Torino*  \n` +
          `${ENUM_ICONS[3]} *Florencia*  \n` +
          `${ENUM_ICONS[4]} *Venecia*  \n` +
          `${ENUM_ICONS[5]} *Continuar sin cabecero*  \n\n` +
          `💰 *Precio de cualquier cabecero:* ${cabPriceTxt}\n\n` +
          '🔗 Mira opciones aquí: https://drive.google.com/file/d/1ovCWWDLc3TqTFPXRiWZzahPKqToY1B0h/view?usp=drive_link\n\n' +
          '✳ *Responde con el número de tu elección.*  \n' +
          '↩ *Escribe "inicio"* en cualquier momento para reiniciar tu pedido.';
        await sendMessage(from, msgCab);
      }
      return;
    }
    // Modificar la selección de base cama: reiniciamos y mostramos de nuevo las opciones de base
    if (text === '2') {
      // Reiniciamos la selección de base
      userStates[from].basecamaTipo = null;
      userStates[from].basecamaProducto = null;
      // Generamos el listado de base cama nuevamente para la medida seleccionada
      const medidaBase2 = state.medida || '';
      const opcionesMod = getBasecamaOpcionesPorMedida(medidaBase2);
      let msgBaseMod = `\n🛏️ *Base de cama para tu colchón de ${medidaBase2}:*  \n\n`;
      opcionesMod.forEach((opt, idx) => {
        const icon = ENUM_ICONS[idx] || `${idx + 1}️⃣`;
        if (opt.precio) {
          msgBaseMod += `${icon} *${opt.nombre}* — $${formatCurrency(opt.precio)}  \n`;
        } else {
          msgBaseMod += `${icon} *${opt.nombre}*  \n`;
        }
      });
      msgBaseMod += '\n🔗 Mira opciones aquí: https://drive.google.com/file/d/1Dh-kBicMlKznzUSJ6I--It7FVmS4YHah/view?usp=drive_link  \n\n' +
        '✳ *Responde con el número de tu elección.*  \n' +
        '↩ *Escribe "inicio"* en cualquier momento para reiniciar tu pedido.';
      await sendMessage(from, msgBaseMod);
      return;
    }

    // Continuar sin cabecero: asignamos la base seleccionada (si su precio es nulo, no se incluye) y omitimos el cabecero, luego vamos a opciones de pago
    if (text === '3') {
      const prod = state.basecamaProducto;
      userStates[from].basecama = (prod && prod.precio != null) ? prod.id : null;
      // Indicar que el cabecero no será incluido
      userStates[from].cabecero = '6';
      userStates[from].cabeceroTipo = null;
      // Iniciar flujo de pago directamente
      iniciarFlujo(from, 'pago');
      return sendMessage(from, getOpcionesPagoMessage());
    }
    // Volver al inicio
    if (['inicio','menú','menu','volver'].includes(text)) {
      delete userStates[from];
      return sendMessage(from, getMenuMessage());
    }
    // Cualquier otro texto no es válido en este punto
      return sendMessage(from, '⚠️ Escribe *1* para continuar con el cabecero, *2* para modificar la base cama, *3* para continuar sin cabecero o *"inicio"* para regresar al menú principal.');
  }
}

if (state?.flujo === 'cabecero') {
  // Paso A: seleccionar cabecero (1-6).  El estado cabeceroTipo indica si ya se seleccionó uno.
  if (!state.cabeceroTipo && ['1', '2', '3', '4', '5', '6'].includes(text)) {
    // Guardamos la selección de cabecero
    userStates[from].cabeceroTipo = text;
    // Calculamos textos de resumen con base en la selección de colchón, base y cabecero
    const medida = state.medida;
    const colchon = state.tipo.toUpperCase();
    const precioColchon = precios[state.tipo][state.medida];
    const precioColchonTxt = typeof precioColchon === 'number' ? `$${formatCurrency(precioColchon)}` : precioColchon;
    // Base cama: obtenemos nombre y precio desde el producto seleccionado, si existe.
    let basecamaTxt = 'No incluida';
    let basecamaPriceVal = 0;
    if (state.basecamaProducto && state.basecamaProducto.precio != null) {
      basecamaTxt = `${state.basecamaProducto.nombre} — $${formatCurrency(state.basecamaProducto.precio)}`;
      basecamaPriceVal = state.basecamaProducto.precio;
    }
    // Cabecero
    
    let cabeceroTxt = 'No incluido';
    // Asignamos el texto del cabecero según la selección, pero el *precio depende del TAMAÑO* del colchón
    const cabDesignNames = { '1': 'Belén', '2': 'Roma', '3': 'Torino', '4': 'Florencia', '5': 'Venecia' };
    const cabPriceBySize = getCabeceroPriceBySize(state.medida);
    if (['1','2','3','4','5'].includes(text)) {
      cabeceroTxt = `${cabDesignNames[text]} — $${formatCurrency(cabPriceBySize)}`;
    }
    if (text === '6') cabeceroTxt = 'No incluido';
    // Guardamos también el texto para cabecero en el estado, por si se necesita más adelante
    userStates[from].cabecero = text;

    // Calculamos el precio total (colchón + base + cabecero) para mostrarlo en el resumen
    // El precio del cabecero depende únicamente del tamaño (no del diseño).  Si no se
    // incluye cabecero (opción 6), su valor es cero.
    let cabPrice = 0;
    if (['1','2','3','4','5'].includes(userStates[from].cabecero)) {
      cabPrice = getCabeceroPriceBySize(state.medida);
    }
    const precioColchonVal = typeof precios[state.tipo]?.[state.medida] === 'number' ? precios[state.tipo][state.medida] : 0;
    const basePrice = basecamaPriceVal;
    const total = precioColchonVal + basePrice + cabPrice;
    const totalTxt = `$${formatCurrency(total)}`;
    // Mostramos el resumen, incluyendo el total y opciones para continuar o modificar
    await sendMessage(from, `\n🛒 *Resumen de tu pedido:*  \n\n` +
      `📦 *Colchón:* ${colchon} ${medida} — ${precioColchonTxt}  \n` +
      `🛏️ *Base cama:* ${basecamaTxt}  \n` +
      `🛋️ *Cabecero:* ${cabeceroTxt}  \n` +
      `💵 *Total:* ${totalTxt}  \n\n` +
      `✳️ *¿Qué deseas hacer ahora?*  \n` +
      `1️⃣ *Ver opciones de pago*  \n` +
      `2️⃣ *Modificar selección*  \n` +
      `↩ *Escribe "inicio"* para reiniciar tu pedido.`);
    // Enviamos la imagen correspondiente al cabecero seleccionado, si existe
    let cabeceroImg = null;
    if (text === '1') cabeceroImg = CABECERO_ROMA_IMG;
    if (text === '2') cabeceroImg = CABECERO_TORINO_IMG;
    if (text === '3') cabeceroImg = CABECERO_FLORENCIA_IMG;
    if (text === '4') cabeceroImg = CABECERO_VENECIA_IMG;
    // No incluimos imagen para la opción 5 (sin cabecero)
    if (cabeceroImg) {
      await sendMedia(from, cabeceroImg);
    }
    return;
  }
  // Paso B: luego de seleccionar cabecero, permitir opciones de pago o modificar
  if (state.cabeceroTipo) {
    // Ver opciones de pago
    if (text === '1') {
      iniciarFlujo(from, 'pago');
      return sendMessage(from, getOpcionesPagoMessage());
    }
    // Modificar selección: reiniciar el cabecero y solicitar nuevamente
    if (text === '2') {
      userStates[from].cabeceroTipo = null;
      userStates[from].cabecero = null;
      // Volvemos a preguntar por el cabecero
      {
        const cabMedida = state.medida || '';
        /*
         * Al modificar el cabecero, mostramos nuevamente la lista de diseños sin repetir el precio
         * en cada uno.  Calculamos un único valor para la medida seleccionada y lo presentamos
         * como precio general para cualquier cabecero.  Si la medida no está definida en la tabla,
         * el texto mostrará "Consultar precio".
         */
        const cabPriceVal2 = getCabeceroPriceBySize(cabMedida);
        const cabPriceTxt2 = cabPriceVal2 ? `$${formatCurrency(cabPriceVal2)}` : 'Consultar precio';
        const mensajeCab =
          `\n🛋️ *Cabeceros para tu colchón de ${cabMedida}:*\n\n` +
          `${ENUM_ICONS[0]} *Belén*  \n` +
          `${ENUM_ICONS[1]} *Roma*  \n` +
          `${ENUM_ICONS[2]} *Torino*  \n` +
          `${ENUM_ICONS[3]} *Florencia*  \n` +
          `${ENUM_ICONS[4]} *Venecia*  \n` +
          `${ENUM_ICONS[5]} *Continuar sin cabecero*  \n\n` +
          `💰 *Precio de cualquier cabecero:* ${cabPriceTxt2}\n\n` +
          '✳ *Responde con el número de tu elección.*  \n' +
          '↩ *Escribe "inicio"* en cualquier momento para reiniciar tu pedido.';
        await sendMessage(from, mensajeCab);
      }
      return;
    }
    // Volver al inicio
    if (['inicio', 'menú', 'menu', 'volver'].includes(text)) {
      delete userStates[from];
      return sendMessage(from, getMenuMessage());
    }
    // Cualquier otra entrada es inválida
    // Mensaje de advertencia cuando la entrada no coincide con las opciones permitidas
    return sendMessage(from, '⚠️ Por favor, escribe *1* para ver opciones de pago, *2* para modificar el cabecero o *"inicio"* para regresar al menú principal.');
  }
}

  // Sub-flujo del pago anticipado: espera 1 (finalizar) o 2 (volver a pagos)
if (state?.flujo === 'pago_anticipado_info') {
  const lower = (text || '').trim().toLowerCase();
  // Paso del menú de opciones (finalizar o ver otras opciones)
  if (state.pagoAnticipadoStep === 'menu') {
    // Finalizar pedido
    if (lower === '1' || lower === '1️⃣' || lower.includes('finalizar')) {
      // Solicitamos datos y comprobante de pago
      await sendMessage(from,
        `📝 *Para finalizar tu pedido, por favor envíanos:*
` +
            `• Nombre completo
` +
            `• Documento de identidad
` +
        `• Documento de identidad\n` +
        `• Ciudad y barrio\n` +
        `• Número de contacto\n` +
        `• Comprobante de pago\n\n` +
        `↩ *Escribe \"inicio\" para regresar al menú principal.`
      );
      // Cambiamos al paso de captura de datos
      userStates[from].pagoAnticipadoStep = 'datos';
      return;
    }
    // Ver opciones de pago
    if (lower === '2' || lower === '2️⃣' || lower.includes('otras')) {
      // Volver al flujo de pago y mostrar opciones
      userStates[from].flujo = 'pago';
      delete userStates[from].pagoAnticipadoStep;
      return sendMessage(from, getOpcionesPagoMessage());
    }
    // Volver al inicio
    if (['inicio','menú','menu','volver'].includes(lower)) {
      delete userStates[from];
      return sendMessage(from, getMenuMessage());
    }
    // Entrada no válida en el menú
    return sendMessage(from, '⚠️ Por favor, escribe *1* para finalizar, *2* para ver otras opciones o *"inicio"* para volver al menú.');
  }
  // Paso de captura de datos y comprobante
  if (state.pagoAnticipadoStep === 'datos') {
    // Permitir regresar al inicio
    if (['inicio','menú','menu','volver'].includes(lower)) {
      delete userStates[from];
      return sendMessage(from, getMenuMessage());
    }
    // Interpretar cualquier otro texto como datos y comprobante enviados
    await sendMessage(from, '🙏 *Gracias por elegir Slumber.* Un asesor se comunicará contigo para coordinar la entrega de tu pedido.');
    // Pasar a modo manual
    userStates[from].flujo = 'manual';
    delete userStates[from].pagoAnticipadoStep;
    return;
  }
  // Por defecto, permitir volver al menú
  if (['inicio','menú','menu','volver'].includes(lower)) {
    delete userStates[from];
    return sendMessage(from, getMenuMessage());
  }
  return sendMessage(from, '⚠️ Por favor, responde con una opción válida o *"inicio"* para regresar al menú.');
}

// ===== Flujo Promociones =====
// Cuando el usuario accede a las promociones, inicialmente se le pide enviar cualquier
// texto para continuar.  Al recibir ese texto, enviamos un mensaje con la descripción de la
// promoción, compartimos el video promocional y mostramos opciones para continuar o
// modificar.  Si el usuario vuelve a escribir, se interpretan sus opciones: 1 para ver
// opciones de pago, 2 para modificar (volver a ver la promoción) y "inicio" para regresar
// al menú principal.
if (state?.flujo === 'promociones') {
  const lower = (text || '').trim().toLowerCase();
  // Aseguramos que el producto promo esté cargado en el estado
  userStates[from] = userStates[from] || {};
  if (!userStates[from].promoProducto) {
    userStates[from].promoProducto = {
      categoria: 'colchon',
      tipo: 'onix',
      nombre: 'Colchón Ónix (Promoción)',
      medida: '140x190',
      precio: 790000,
      precioAntes: 1100000
    };
  }

  // Si aún no hemos mostrado la promoción, mostramos información y el video
  if (!state.promocionMostrada) {
    // Mensaje de la promoción con detalles del colchón Ónix y las opciones al final.  Se envía
    // primero esta descripción y posteriormente el video.  Luego se muestran las opciones.
    const promoMsg =
      `📢 ¡Gran Promoción Colchón Ónix! 🛏✨\n\n` +
      `Antes: ~$1.100.000~\n` +
      `👉 Hoy solo: $790,000\n` +
      `📏 Tamaño: 140 x 190 cm\n\n` +
      `🚚 Envío GRATIS en: Madrid, Facatativá, Mosquera, Funza, Bojacá, El Rosal y Bogotá.\n\n` +
      `🔥 ¡Aprovecha esta promoción limitada y lleva tu Colchón Ónix con la mejor calidad y al mejor precio!\n\n` +
      `✳ ¿Qué deseas hacer ahora?\n` +
      `${ENUM_ICONS[0]} Finalizar pedido\n` +
      `${ENUM_ICONS[1]} Ver opciones de pago\n` +
      `↩ Escribe "inicio" para regresar al menú principal.`;
    await sendMessage(from, promoMsg);
    // Enviamos el video promocional al final
    await sendVideo(from, PROMOCION_VIDEO_URL);
    // Marcamos que la promoción ya fue mostrada
    userStates[from] = userStates[from] || {};
    userStates[from].promocionMostrada = true;
    return;
  }
  // Si ya mostramos la promoción, interpretamos la respuesta del usuario
  // Opción 1: Finalizar pedido (lleva a opciones de pago)
  if (lower === '1' || lower === '1️⃣' || lower.includes('finalizar')) {
    // Nos aseguramos de conservar el producto promo como selección principal
    userStates[from] = userStates[from] || {};
    if (!userStates[from].promoProducto) {
      userStates[from].promoProducto = {
        categoria: 'colchon',
        tipo: 'onix',
        nombre: 'Colchón Ónix (Promoción)',
        medida: '140x190',
        precio: 790000,
        precioAntes: 1100000
      };
    }
    iniciarFlujo(from, 'pago');
    return sendMessage(from, getOpcionesPagoMessage());
  }

  // Opción 2: Ver opciones de pago (misma acción: mostrar métodos de pago)
  if (lower === '2' || lower === '2️⃣' || lower.includes('pago')) {
    userStates[from] = userStates[from] || {};
    if (!userStates[from].promoProducto) {
      userStates[from].promoProducto = {
        categoria: 'colchon',
        tipo: 'onix',
        nombre: 'Colchón Ónix (Promoción)',
        medida: '140x190',
        precio: 790000,
        precioAntes: 1100000
      };
    }
    iniciarFlujo(from, 'pago');
    return sendMessage(from, getOpcionesPagoMessage());
  }

  // Si el usuario pide modificar o volver a ver la promo, la reenviamos
  if (lower.includes('modificar') || lower.includes('ver promo') || lower.includes('promoción') || lower.includes('promocion')) {
    userStates[from].promocionMostrada = false;
    await sendMessage(from, `🔁 *Mostrando la promoción nuevamente.*`);
    // La próxima iteración reenviará mensaje + video
    return;
  }

  if (['inicio','menú','menu','volver'].includes(lower)) {
    // Regresar al menú principal
    delete userStates[from];
    return sendMessage(from, getMenuMessage());
  }
  // Si la entrada no coincide con ninguna opción válida
  return sendMessage(from, '⚠️ Por favor, escribe *1* para *finalizar el pedido* o *2* para *ver opciones de pago*. También puedes escribir *modificar* para volver a ver la promo o *inicio* para regresar al menú principal. ver la promoción o *"inicio"* para regresar al menú principal.');
}

// ===== Flujo Soporte al cliente =====
// Este flujo gestiona solicitudes de soporte, garantía o seguimiento para clientes existentes.
// Cuando el usuario ingresa a este flujo (por ejemplo, seleccionando la opción 7 en el menú
// principal o escribiendo palabras como “garantía” o “soporte”), primero le pedimos que
// describa su solicitud.  Luego solicitamos sus datos de contacto para poder atenderle y,
// finalmente, le confirmamos que un asesor se comunicará lo antes posible.  Después de
// recopilar la información necesaria, la conversación pasa a modo manual para permitir la
// interacción humana.
if (state?.flujo === 'soporte') {
  const lower = (text || '').trim().toLowerCase();
  // Permitir al usuario regresar al menú principal en cualquier momento
  if (['inicio', 'menú', 'menu', 'volver'].includes(lower)) {
    delete userStates[from];
    return sendMessage(from, getMenuMessage());
  }
  // Paso A: Si aún no hemos recibido la descripción de la solicitud, interpretamos
  // cualquier texto como tal.  Guardamos la solicitud en el estado y pedimos los datos.
  if (!state.soporteSolicitud) {
    // Guardar la descripción de la solicitud del cliente
    userStates[from] = userStates[from] || {};
    userStates[from].soporteSolicitud = text;
    // Solicitar datos de contacto para brindar una mejor atención
    return sendMessage(from,
      `📝 *Gracias por escribirnos.* Para poder ayudarte, por favor envíanos los siguientes datos:\n` +
      `• Nombre completo\n` +
      `• Documento de identidad\n` +
      `• Ciudad y barrio\n` +
      `• Número de contacto\n` +
      `• Número de pedido (opcional)\n\n` +
      `↩ *Escribe "inicio" para regresar al menú principal.`
    );
  }
  // Paso B: Ya recibimos la solicitud y esperamos los datos de contacto.  Cualquier
  // respuesta (distinta de ir al menú) se toma como los datos enviados.
  if (!state.soporteDatos) {
    // Guardar los datos proporcionados por el cliente
    userStates[from].soporteDatos = text;
    // Agradecer y notificar que un asesor se comunicará pronto
    await sendMessage(from,
      `🙏 *Gracias por compartir tu solicitud.* Un asesor se comunicará lo antes posible para atender tu caso.`
    );
    // Pasar a modo manual para permitir atención personalizada
    userStates[from].flujo = 'manual';
    return;
  }
  // Si por alguna razón llega hasta aquí, reiniciamos y mostramos mensaje genérico
  return sendMessage(from, '⚠️ No entendí tu mensaje. Escribe "inicio" para regresar al menú principal.');
}


// ===== Flujo Salas/Sofá camas =====
  if (state?.flujo === 'salas') {
    // Catálogo de productos (precios: null => "Consultar precio")
    const productos = {
      // Lista de salas extraídas del catálogo de muebles
      salas: [
        {
          id: '1',
          nombre: 'Sala L Multifuncional',
          // Precio actualizado: 2.590.000
          precio: 2590000,
          descripcion: 'Mueble modular en forma de L con espuma de alta densidad y tela AquaFobiak. Incluye puff y tres cojines; capacidad para seis puestos.',
          imagen: SALA_L_MULTI_IMG
        },
        {
          id: '2',
          nombre: 'Sala Oslo',
          // Precio actualizado: 2.490.000
          precio: 2490000,
          descripcion: 'Sala de diseño curvo que incluye silla, sillón y sofá. Fabricada en madera sólida y tapizada en tela linato; incluye puff y poltrona.',
          imagen: SALA_OSLO_IMG
        },
        {
          id: '3',
          nombre: 'Sala Tipo Huevo',
          // Precio actualizado: 2.390.000
          precio: 2390000,
          descripcion: 'Juego de sala con sofá cama de tres posiciones (brazo removible), silla reclinable, silla mecedora, puff y cojines. Estructura sajo y espumas de alta densidad.',
          imagen: SALA_TIPO_HUEVO_IMG
        },
        {
          id: '4',
          nombre: 'Sala Click Fija',
          // Precio actualizado: 2.490.000
          precio: 2490000,
          descripcion: 'Juego de sala con sofá reclinable y dos poltronas: una mecedora y otra reclinable. El sofá tiene posiciones sentado, semi sentado y acostado; incluye puff.',
          imagen: SALA_CLICK_FIJA_IMG
        },
        {
          id: '5',
          nombre: 'Sala Bianca',
          // Precio actualizado: 3.290.000
          precio: 3290000,
          descripcion: 'Sala fabricada en madera sólida y tapizada en tela linato. Incluye sofá fijo, puff y sofá cama con mecanismo metálico desplegable para convertirlo en una cama espaciosa.',
          imagen: SALA_BIANCA_IMG
        }
      ],
      // Lista de sofá camas extraídas del catálogo
      sofascamas: [
        {
          id: '1',
          nombre: 'Sofá cama Bianca',
          // Precio actualizado: 1.980.000
          precio: 1980000,
          descripcion: 'Sofá cama de tres posiciones con mecanismo metálico desplegable, estructura de madera y tela antimanchas.'
        }
      ]
    };

    // Paso A: elegir categoría (1 = Salas, 2 = Sofá camas)
    if (!state.muebleTipo && (text === '1' || text === '2')) {
      // Determinar si el usuario eligió salas o sofá camas
      const tipoSeleccionado = text === '1' ? 'salas' : 'sofascamas';
      userStates[from].muebleTipo = tipoSeleccionado;

      // Si elige salas, mostramos la lista de todas las salas y enviamos el catálogo PDF
      if (tipoSeleccionado === 'salas') {
        // Generamos la lista de salas con emojis numéricos estándar (1️⃣, 2️⃣, 3️⃣...).
        const lista = productos.salas
          .map((p, idx) => {
            const precioTxt = p.precio ? `$${formatCurrency(p.precio)}` : 'Consultar precio';
            const icon = ENUM_ICONS[idx] || `${idx + 1}️⃣`;
            return `${icon} *${p.nombre}* — ${precioTxt}`;
          })
          .join('\n');

        await sendMessage(from, `🛋 *Salas disponibles:*\n\n${lista}\n\n🔗 Mira opciones aquí: ${LINK_SALAS}

✳ *Responde con el número del producto para continuar.*\n`);
      } else {
        // Único sofá cama disponible: seleccionamos el producto automáticamente y enviamos su imagen
        const sofaProducto = productos.sofascamas[0];
        userStates[from].muebleProducto = sofaProducto;
        const precioTxt = sofaProducto.precio ? `$${formatCurrency(sofaProducto.precio)}` : 'Consultar precio con asesor';

        // Mensaje con detalles del sofá cama y opciones
        await sendMessage(from, `🛋 *Sofá cama disponible:*\n\n• *Producto:* ${sofaProducto.nombre}\n• *Detalles:* ${sofaProducto.descripcion || 'Consultar especificaciones con asesor'}\n• *Precio:* ${precioTxt}\n\n✳ *¿Qué deseas hacer ahora?*\n1️⃣ *Ver opciones de pago*\n↩ *Escribe "inicio"* para regresar al menú principal.`);
        // Enviamos la imagen de sofá cama en lugar del catálogo
        await sendMedia(from, SOFASCAMA_BIANCA_IMG);
      }
      return;
    }

    // Paso B: elegir un producto del listado
    if (state.muebleTipo && !state.muebleProducto && /^\d+$/.test(text)) {
      const lista = productos[state.muebleTipo] || [];
      const elegido = lista.find(p => p.id === text);
      if (!elegido) {
        return sendMessage(from, '⚠️ Opción no válida. Elige un número del listado o escribe *"inicio"* para regresar.');
      }
      userStates[from].muebleProducto = elegido;
      const precioTxt = elegido.precio ? `$${formatCurrency(elegido.precio)}` : 'Consultar precio con asesor';

      // Construir mensaje de detalle y opciones dinámico según si hay múltiples productos
      const categoriaNombre = state.muebleTipo === 'salas' ? 'Salas' : 'Sofá camas';
      const tieneVarias = (productos[state.muebleTipo] || []).length > 1;
      const opcionesTxt = tieneVarias
        ? '1️⃣ *Ver opciones de pago*\n2️⃣ *Modificar selección*'
        : '1️⃣ *Ver opciones de pago*';

      // Enviamos los detalles del producto seleccionado y luego su imagen
      await sendMessage(from, `\n🛒 *Detalle de tu pedido (Muebles)*\n\n• *Categoría:* ${categoriaNombre}\n• *Producto:* ${elegido.nombre}\n• *Detalles:* ${elegido.descripcion || 'Consultar especificaciones con asesor'}\n• *Precio:* ${precioTxt}\n\n✳ *¿Qué deseas hacer ahora?*\n${opcionesTxt}\n↩ *Escribe "inicio"* para regresar al menú principal.`);
      if (elegido.imagen) {
        await sendMedia(from, elegido.imagen);
      }
      return;
    }

    // Paso C: siguiente acción tras confirmar el pedido
    if (state.muebleProducto) {
      // Opción para ver opciones de pago
      if (text === '1') {
        iniciarFlujo(from, 'pago');
        return sendMessage(from, getOpcionesPagoMessage());
      }

      // Determinar si hay múltiples productos para esta categoría
      const disponible = productos[state.muebleTipo] || [];
      const multiple = disponible.length > 1;

      // Opción para modificar selección solo si hay varias opciones
      if (text === '2') {
        if (multiple) {
          // Reiniciar la selección de producto y mostrar de nuevo la lista con iconos personalizados
          userStates[from].muebleProducto = null;
          const lista = disponible
            .map((p, idx) => {
              const icon = ENUM_ICONS[idx] || `${idx + 1}️⃣`;
              const precioTxt = p.precio ? `$${formatCurrency(p.precio)}` : 'Consultar precio';
              return `${icon} *${p.nombre}* — ${precioTxt}`;
            })
            .join('\n');
          return sendMessage(from, `🔁 *${state.muebleTipo === 'salas' ? 'Salas' : 'Sofá camas'} disponibles:*\n\n${lista}\n\n✳ *Responde con el número del producto para continuar.*\n↩ *Escribe "inicio"* para regresar al menú principal.`);
        }
        // Si solo hay un producto, no hay nada que modificar
        return sendMessage(from, '⚠️ Sólo hay un producto disponible. Escribe *1* para ver opciones de pago o *"inicio"* para regresar al menú principal.');
      }

      // Volver al inicio
      if (['inicio','menú','menu','volver'].includes(text)) {
        delete userStates[from];
        return sendMessage(from, getMenuMessage());
      }

      // Cualquier otro texto aquí no es válido
      if (multiple) {
        return sendMessage(from, '⚠️ Escribe *1* para ver opciones de pago, *2* para modificar o *"inicio"* para regresar.');
      }
      return sendMessage(from, '⚠️ Escribe *1* para ver opciones de pago o *"inicio"* para regresar.');
    }
  }

  // ===== Flujo Comedores y Muebles =====
  if (state?.flujo === 'comedor') {
    // Catálogo de productos para comedores y muebles.  Cada entrada incluye un ID, nombre, descripción, precio y enlace de imagen.
    const productos = {
      comedores: [
        {
          id: '1',
          nombre: COMEDOR_PRODUCT.nombre,
          precio: COMEDOR_PRODUCT.precio,
          descripcion: COMEDOR_PRODUCT.descripcion,
          imagen: COMEDOR_IMAGE
        }
      ],
      muebles: [
        {
          id: '1',
          nombre: 'Puff Baúl',
          // Precio actualizado según tabla: 490.000
          precio: 490000,
          descripcion: 'Puff baúl con estructura Sajo y espuma de poliuretano de alta densidad. Forrado en tela de alta calidad, 100% antifluidos, con tapa en madera lacada. Capacidad para un puesto.',
          imagen: MUEBLE_PUFF_IMG
        },
        {
          id: '2',
          nombre: 'Silla Huevo Mecedora',
          // Precio actualizado según tabla: 790.000
          precio: 790000,
          descripcion: 'Silla huevo mecedora con estructura Sajo y espuma de alta densidad. Forrada en tela antifluidos y amigable con las mascotas, con tapa en madera lacada. Capacidad para un puesto.',
          imagen: MUEBLE_SILLA_HUEVO_IMG
        }
      ]
    };

    // Paso A: seleccionar categoría (1 = Comedores, 2 = Muebles)
    if (!state.comedorTipo && (text === '1' || text === '2')) {
      const tipoSeleccionado = text === '1' ? 'comedores' : 'muebles';
      userStates[from].comedorTipo = tipoSeleccionado;
      // Si elige comedores, se asigna automáticamente el único producto y se muestran sus detalles
      if (tipoSeleccionado === 'comedores') {
        const comedor = productos.comedores[0];
        userStates[from].comedorProducto = comedor;
        const precioTxt = comedor.precio ? `$${formatCurrency(comedor.precio)}` : 'Consultar precio con asesor';
        await sendMessage(from, `🍽️ *Comedor disponible:*\n\n• *Producto:* ${comedor.nombre}\n• *Detalles:* ${comedor.descripcion || 'Consultar especificaciones con asesor'}\n• *Precio:* ${precioTxt}\n\n✳ *¿Qué deseas hacer ahora?*\n1️⃣ *Ver opciones de pago*\n↩ *Escribe "inicio"* para regresar al menú principal.`);
        await sendMedia(from, comedor.imagen);
      } else {
        // Si elige muebles, mostramos la lista de muebles disponibles usando emojis numéricos
        const listaMuebles = productos.muebles
          .map((p, idx) => {
            const precioTxt = p.precio ? `$${formatCurrency(p.precio)}` : 'Consultar precio';
            const icon = ENUM_ICONS[idx] || `${idx + 1}️⃣`;
            return `${icon} *${p.nombre}* — ${precioTxt}`;
          })
          .join('\n');
        await sendMessage(from, `🪑 *Muebles disponibles:*

${listaMuebles}

🔗 Mira opciones aquí: ${LINK_MUEBLES}

✳ *Responde con el número del producto para continuar.*
↩ *Escribe "inicio"* para regresar al menú principal.`);
      }
      return;
    }

    // Paso B: selección de producto dentro de la categoría
    if (state.comedorTipo && !state.comedorProducto && /^\d+$/.test(text)) {
      const lista = productos[state.comedorTipo] || [];
      const elegido = lista.find(p => p.id === text);
      if (!elegido) {
        return sendMessage(from, '⚠️ Opción no válida. Elige un número del listado o escribe *"inicio"* para regresar.');
      }
      userStates[from].comedorProducto = elegido;
      const precioTxt = elegido.precio ? `$${formatCurrency(elegido.precio)}` : 'Consultar precio con asesor';
      const categoriaNombre = state.comedorTipo === 'comedores' ? 'Comedores' : 'Muebles';
      const tieneVarias = (productos[state.comedorTipo] || []).length > 1;
      const opcionesTxt = tieneVarias
        ? '1️⃣ *Ver opciones de pago*\n2️⃣ *Modificar selección*'
        : '1️⃣ *Ver opciones de pago*';
      await sendMessage(from, `\n🛒 *Detalle de tu pedido (${categoriaNombre})*\n\n• *Producto:* ${elegido.nombre}\n• *Detalles:* ${elegido.descripcion || 'Consultar especificaciones con asesor'}\n• *Precio:* ${precioTxt}\n\n✳ *¿Qué deseas hacer ahora?*\n${opcionesTxt}\n↩ *Escribe "inicio"* para regresar al menú principal.`);
      // Enviamos la imagen del mueble seleccionado
      await sendMedia(from, elegido.imagen);
      return;
    }

    // Paso C: acciones después de seleccionar un producto
    if (state.comedorProducto) {
      // Ver opciones de pago
      if (text === '1') {
        iniciarFlujo(from, 'pago');
        return sendMessage(from, getOpcionesPagoMessage());
      }
      // Modificar selección (solo si hay varios productos en la categoría)
      const disponible = productos[state.comedorTipo] || [];
      const multiple = disponible.length > 1;
      if (text === '2') {
        if (multiple) {
          // Reiniciar la selección de producto y mostrar de nuevo la lista con iconos personalizados
          userStates[from].comedorProducto = null;
          const lista = disponible
            .map((p, idx) => {
              const icon = ENUM_ICONS[idx] || `${idx + 1}️⃣`;
              const precioTxt = p.precio ? `$${formatCurrency(p.precio)}` : 'Consultar precio';
              return `${icon} *${p.nombre}* — ${precioTxt}`;
            })
            .join('\n');
          return sendMessage(from, `🔁 *${state.comedorTipo === 'comedores' ? 'Comedores' : 'Muebles'} disponibles:*\n\n${lista}\n\n✳ *Responde con el número del producto para continuar.*\n↩ *Escribe "inicio"* para regresar al menú principal.`);
        }
        // Si solo hay un producto, no hay nada que modificar
        return sendMessage(from, '⚠️ Sólo hay un producto disponible. Escribe *1* para ver opciones de pago o *"inicio"* para regresar al menú principal.');
      }
      // Volver al inicio
      if (['inicio','menú','menu','volver'].includes(text)) {
        delete userStates[from];
        return sendMessage(from, getMenuMessage());
      }
      // Cualquier otra respuesta no válida
      if (multiple) {
        return sendMessage(from, '⚠️ Escribe *1* para ver opciones de pago, *2* para modificar o *"inicio"* para regresar.');
      }
      return sendMessage(from, '⚠️ Escribe *1* para ver opciones de pago o *"inicio"* para regresar.');
    }
  }


  // ===== Flujo Almohadas y Protectores =====
  if (state?.flujo === 'almohada') {
    // Catálogo de productos para almohadas y protectores.  Cada entrada incluye id, nombre, descripción, precio y enlace de imagen.
    const productos = {
      // Catálogo de almohadas basado en la imagen proporcionada.  Cada entrada contiene nombre y
      // descripción fieles a los beneficios que aparecen en la ficha de producto.  Se dejan los
      // precios en null para que el bot muestre “Consultar precio” hasta que se definan.
      almohadas: [
        {
          id: '1',
          nombre: 'Almohada Microfibra Siliconada',
          // Precio actualizado: 30.000
          precio: 30000,
          descripcion: 'Almohada confeccionada en microfibra siliconada de 50×70 cm. Posee relleno siliconado, es anti ácaros y antibacteriana, lo que proporciona un descanso higiénico y suave.',
          imagen: ALMOHADA1_IMG
        },
        {
          id: '2',
          nombre: 'Almohada Memory Classic',
          // Precio actualizado: 119.000
          precio: 119000,
          descripcion: 'Almohada con núcleo de memory foam y forro de tela de fibras naturales. Su espuma viscoelástica se adapta a la forma de tu cabeza y cuello, ayudando a mantener la alineación cervical y reducir molestias en cuello y espalda.',
          imagen: ALMOHADA2_IMG
        },
        {
          id: '3',
          nombre: 'Almohada Memory Cervical',
          // Precio actualizado: 119.000
          precio: 119000,
          descripcion: 'Almohada viscoelástica con curvatura especial para distribuir el peso de manera uniforme. Ideal para personas que duermen de lado o de espaldas; reduce puntos de presión y alinea la columna.',
          imagen: ALMOHADA3_IMG
        }
      ],
      // Catálogo de protectores de colchón según la imagen.  El primer modelo es antifluido y
      // absorbente, mientras que el segundo es acolchado y suave al tacto.  Se mantienen los
      // precios en null a la espera de datos definitivos.
      protectores: [
        {
          id: '1',
          nombre: 'Protector Antifluido Terry',
          precio: null,
          descripcion: 'Protector de colchón en tejido Terry, disponible en medidas desde 1,90 m hasta 2,00 m. Anti ácaros y antibacteriano, con capacidad retardante de líquidos para proteger contra humedad y derrames.',
          imagen: PROTECTOR1_IMG
        },
        {
          id: '2',
          nombre: 'Protector Termosellado',
          precio: null,
          descripcion: 'Protector acolchado termosellado que brinda mayor comodidad y soporte. Disponible en medidas desde 1,90 m hasta 2,00 m, es anti ácaros y suave al tacto; protege de polvo, alérgenos y contaminantes.',
          imagen: PROTECTOR2_IMG
        }
      ]
    };

    // Paso A: seleccionar categoría (1 = Almohadas, 2 = Protectores)
    if (!state.almohadaTipo && (text === '1' || text === '2')) {
      const tipoSeleccionado = text === '1' ? 'almohadas' : 'protectores';
      userStates[from].almohadaTipo = tipoSeleccionado;
      const listaProductos = productos[tipoSeleccionado];
      // Si solo hay un producto en la categoría, seleccionarlo automáticamente
      if (listaProductos.length === 1) {
        const unico = listaProductos[0];
        userStates[from].almohadaProducto = unico;
        const precioTxt = (typeof unico.precio === 'number') ? `$${formatCurrency(unico.precio)}` : 'Consultar precio con asesor';
        const categoriaNombre = tipoSeleccionado === 'almohadas' ? 'Almohada' : 'Protector';
        await sendMessage(from, `
🛏️ *${categoriaNombre} disponible:*

• *Producto:* ${unico.nombre}
• *Detalles:* ${unico.descripcion || 'Consultar especificaciones con asesor'}
• *Precio:* ${precioTxt}

✳ *¿Qué deseas hacer ahora?*
1️⃣ *Ver opciones de pago*  
↩ *Escribe "inicio"* para regresar al menú principal.`);
        if (unico.imagen) {
          await sendMedia(from, unico.imagen);
        }
      } else {
        // Hay múltiples productos: mostrar lista usando emojis numéricos estándar
        const lista = listaProductos
          .map((p, idx) => {
            const icon = ENUM_ICONS[idx] || `${idx + 1}️⃣`;
            // Para protectores, el precio varía según la medida; evitamos mostrar "Consultar precio"
            let precioTxt;
            if (typeof p.precio === 'number') {
              precioTxt = `$${formatCurrency(p.precio)}`;
            } else if (tipoSeleccionado === 'protectores') {
              precioTxt = 'Precio según medida';
            } else {
              precioTxt = 'Consultar precio';
            }
            return `${icon} *${p.nombre}* — ${precioTxt}`;
          })
          .join('\n');
        const categoriaNombre = tipoSeleccionado === 'almohadas' ? 'Almohadas' : 'Protectores';
        // Seleccionamos un icono apropiado para cada categoría (almohadas vs protectores)
        const categoriaIcon = tipoSeleccionado === 'almohadas' ? '😴' : '🛡️';
        const mensajeLista = `\n${categoriaIcon} *${categoriaNombre} disponibles:*\n\n${lista}\n\n✳ *Responde con el número del producto para continuar.*\n↩ *Escribe "inicio"* para regresar al menú principal.`;
        // Enviamos el listado y luego una imagen ilustrativa según la categoría
        await sendMessage(from, mensajeLista);
        if (tipoSeleccionado === 'almohadas') {
          await sendMedia(from, ALMOHADAS_LIST_IMG);
        } else {
          await sendMedia(from, PROTECTORES_LIST_IMG);
        }
      }
      return;
    }

    // Paso B: seleccionar producto dentro de la categoría
    if (state.almohadaTipo && !state.almohadaProducto && /^\d+$/.test(text)) {
      const lista = productos[state.almohadaTipo] || [];
      const elegido = lista.find(p => p.id === text);
      if (!elegido) {
        return sendMessage(from, '⚠️ Opción no válida. Elige un número del listado o escribe *"inicio"* para regresar.');
      }
      // Guardamos la selección de producto
      userStates[from].almohadaProducto = elegido;
      // Si la categoría es "protectores", primero solicitamos la medida para poder calcular el precio.
      if (state.almohadaTipo === 'protectores') {
        // Determinar la clave del protector para el mapa de precios (antifluido o termosellado)
        const nombre = (elegido.nombre || '').toLowerCase();
        let key = null;
        if (nombre.includes('antifluido') || nombre.includes('terry')) {
          key = 'antifluido';
        } else if (nombre.includes('termosellado')) {
          key = 'termosellado';
        }
        // Guardamos la clave y reiniciamos la selección de medida
        userStates[from].protectorKey = key;
        userStates[from].protectorSize = null;
        userStates[from].protectorPrice = null;
        userStates[from].protectorStep = 'size';
        // Construimos la lista de medidas disponibles con sus precios
        const preciosMap = key ? PROTECTORES_PRECIOS[key] || {} : {};
        const entries = Object.entries(preciosMap);
        const sizeOptions = entries.map(([sizeCode, price], idx) => {
          const icon = ENUM_ICONS[idx] || `${idx + 1}️⃣`;
          const sizeLabel = sizeCode.replace('x', ' x ');
          const precioTxt = `$${formatCurrency(price)}`;
          return `${icon} ${sizeLabel} — ${precioTxt}`;
        }).join('\n');
        // Instrucción para modificar la selección de protector (sin usar un número conflictivo)
        const modificarLinea = '🔁 *Escribe "modificar" para cambiar de protector*';
        // Enviamos mensaje solicitando la medida y ofreciendo opción de modificar
        await sendMessage(from, `\n🛡️ *Protector seleccionado:* ${elegido.nombre}\n\nSelecciona la medida de tu protector:\n\n${sizeOptions}\n\n${modificarLinea}\n\n✳ *Responde con el número de tu medida para continuar.*\n↩ *Escribe "inicio" para regresar al menú principal.`);
        // Enviamos la imagen del protector si está disponible
        if (elegido.imagen) {
          await sendMedia(from, elegido.imagen);
        }
        return;
      } else {
        // Si es una almohada, mostramos directamente los detalles y opciones de pago/modificación
        const precioTxt = (typeof elegido.precio === 'number') ? `$${formatCurrency(elegido.precio)}` : 'Consultar precio con asesor';
        const categoriaNombre = 'Almohada';
        await sendMessage(from, `\n🛒 *Detalle de tu pedido*\n\n• *Categoría:* ${categoriaNombre}\n• *Producto:* ${elegido.nombre}\n• *Detalles:* ${elegido.descripcion || 'Consultar especificaciones con asesor'}\n• *Precio:* ${precioTxt}\n\n✳ *¿Qué deseas hacer ahora?*\n1️⃣ *Ver opciones de pago*\n2️⃣ *Modificar selección*\n↩ *Escribe "inicio" para regresar al menú principal.`);
        if (elegido.imagen) {
          await sendMedia(from, elegido.imagen);
        }
        return;
      }
    }

    // Paso B2: si el producto seleccionado es un protector y estamos esperando la medida
    // del colchón, interpretamos la respuesta del usuario como una elección de tamaño o
    // una solicitud de modificación.  Esto ocurre después de enviar la lista de medidas.
    if (state.almohadaTipo === 'protectores' && state.protectorStep === 'size') {
      // Permitir al usuario cambiar de protector escribiendo "modificar"
      if (msg.toLowerCase() === 'modificar') {
        // Reiniciamos los valores relacionados con protectores y volvemos a mostrar la lista
        userStates[from].almohadaProducto = null;
        userStates[from].protectorKey = null;
        userStates[from].protectorSize = null;
        userStates[from].protectorPrice = null;
        userStates[from].protectorStep = null;
        const lista = (productos['protectores'] || []).map((p, idx) => {
          const icon = ENUM_ICONS[idx] || `${idx + 1}️⃣`;
          // Para protectores, indicamos que el precio depende de la medida seleccionada
          return `${icon} *${p.nombre}* — Precio según medida`;
        }).join('\n');
        return sendMessage(from, `🔁 *Protectores disponibles:*\n\n${lista}\n\n✳ *Responde con el número del producto para continuar.*\n↩ *Escribe "inicio" para regresar al menú principal.`);
      }
      // Si el usuario ingresa un número, intentamos asociarlo a una medida disponible
      if (/^\d+$/.test(text)) {
        const key = state.protectorKey;
        const precioMap = key ? PROTECTORES_PRECIOS[key] || {} : {};
        const entries = Object.entries(precioMap);
        const idx = parseInt(text) - 1;
        if (entries[idx]) {
          const [sizeKey, price] = entries[idx];
          // Guardamos la medida y el precio elegidos
          userStates[from].protectorSize = sizeKey;
          userStates[from].protectorPrice = price;
          userStates[from].protectorStep = 'detalle';
          const medidaTxt = sizeKey.replace('x', ' x ');
          const precioTxt = `$${formatCurrency(price)}`;
          // Construimos el mensaje de detalle con medida y precio
          const nombreProt = state.almohadaProducto.nombre;
          await sendMessage(from, `\n🛒 *Detalle de tu pedido*\n\n• *Categoría:* Protector\n• *Producto:* ${nombreProt}\n• *Medida:* ${medidaTxt}\n• *Precio:* ${precioTxt}\n\n✳ *¿Qué deseas hacer ahora?*\n1️⃣ *Ver opciones de pago*\n2️⃣ *Modificar selección*\n↩ *Escribe "inicio" para regresar al menú principal.`);
          return;
        } else {
          // El número ingresado no corresponde a ninguna medida
          return sendMessage(from, '⚠️ Número inválido. Responde con el número de tu medida o escribe "modificar" para elegir otro protector.');
        }
      }
      // Si llega hasta aquí y no coincide con nada, recordamos cómo avanzar
      return sendMessage(from, '⚠️ Escribe el número de tu medida para continuar o "modificar" para cambiar de protector.');
    }

    // Paso C: acciones posteriores a la selección (ver opciones de pago o modificar)
    if (state.almohadaProducto) {
      // --- Gestión de opciones tras seleccionar una almohada o protector ---
      // Si el producto pertenece a la categoría de protectores y ya se eligió la medida
      // (state.protectorStep === 'detalle'), las opciones 1 y 2 tienen comportamientos
      // específicos: 1 = ver opciones de pago; 2 = modificar (volver a seleccionar medida).
      if (state.almohadaTipo === 'protectores' && state.protectorStep === 'detalle') {
        if (text === '1') {
          // Ver opciones de pago
          iniciarFlujo(from, 'pago');
          return sendMessage(from, getOpcionesPagoMessage());
        }
        if (text === '2') {
          // Modificar selección: se reinicia la medida y precio del protector para
          // volver a solicitar la medida del mismo producto
          userStates[from].protectorSize = null;
          userStates[from].protectorPrice = null;
          userStates[from].protectorStep = 'size';
          // Construimos nuevamente el listado de medidas disponibles
          const key = state.protectorKey;
          const preciosMap = key ? PROTECTORES_PRECIOS[key] || {} : {};
          const entries = Object.entries(preciosMap);
          const sizeOptions = entries.map(([sizeCode, price], idx) => {
            const icon = ENUM_ICONS[idx] || `${idx + 1}️⃣`;
            const sizeLabel = sizeCode.replace('x', ' x ');
            const precioTxt = `$${formatCurrency(price)}`;
            return `${icon} ${sizeLabel} — ${precioTxt}`;
          }).join('\n');
          const modificarLinea = '🔁 *Escribe "modificar" para cambiar de protector*';
          await sendMessage(from, `\n🛡️ *Protector seleccionado:* ${state.almohadaProducto.nombre}\n\nSelecciona la medida de tu protector:\n\n${sizeOptions}\n\n${modificarLinea}\n\n✳ *Responde con el número de tu medida para continuar.*\n↩ *Escribe "inicio" para regresar al menú principal.`);
          return;
        }
      }
      // Opción 1: Ver opciones de pago (aplica para almohadas o protectores sin medida)
      if (text === '1') {
        iniciarFlujo(from, 'pago');
        return sendMessage(from, getOpcionesPagoMessage());
      }
      // Opción 2: Modificar selección (cambiar de almohada o protector)
      if (text === '2') {
        // Reiniciamos la selección de producto y de protector (si aplica)
        userStates[from].almohadaProducto = null;
        userStates[from].protectorKey = null;
        userStates[from].protectorSize = null;
        userStates[from].protectorPrice = null;
        userStates[from].protectorStep = null;
        // Construimos el listado de productos de la categoría actual
        const lista = (productos[state.almohadaTipo] || []).map((p, idx) => {
          const icon = ENUM_ICONS[idx] || `${idx + 1}️⃣`;
          let precioTxt;
          if (typeof p.precio === 'number') {
            precioTxt = `$${formatCurrency(p.precio)}`;
          } else if (state.almohadaTipo === 'protectores') {
            precioTxt = 'Precio según medida';
          } else {
            precioTxt = 'Consultar precio';
          }
          return `${icon} *${p.nombre}* — ${precioTxt}`;
        }).join('\n');
        const categoriaNombre = state.almohadaTipo === 'almohadas' ? 'Almohadas' : 'Protectores';
        return sendMessage(from, `🔁 *${categoriaNombre} disponibles:*\n\n${lista}\n\n✳ *Responde con el número del producto para continuar.*\n↩ *Escribe "inicio" para regresar al menú principal.`);
      }
      // Volver al inicio
      if (['inicio','menú','menu','volver'].includes(text)) {
        delete userStates[from];
        return sendMessage(from, getMenuMessage());
      }
      // Cualquier otro texto no válido
      return sendMessage(from, '⚠️ Escribe *1* para ver opciones de pago, *2* para modificar o *"inicio"* para regresar.');
    }
  }

  if (state?.flujo === 'pago') {  const choice = (text || '').trim();

    // Gestionar flujos posteriores según el método de pago seleccionado
    if (state.pagoDetalle) {
      // Contraentrega: paso de confirmación
      if ((state.pagoDetalle === 'contraentrega' || state.pagoDetalle === 'tarjeta_bold') && state.pagoStep === 'confirmar') {
        if (text === '1') {
          // El usuario desea finalizar el pedido. Construimos el resumen completo adaptado a cada flujo y solicitamos datos.
          // Reiniciamos el paso para solicitar datos después de enviar el resumen
          userStates[from].pagoStep = 'datos';
          // Construimos las líneas del resumen según el flujo y selección del usuario
          const resumenLineas = [];
          let total = 0;
          let totalConocido = true;
          // Si el usuario viene del flujo de colchones (tiene medida y tipo)
          if (state.promoProducto && (!state.medida || !state.tipo)) {
            const p = state.promoProducto;
            const nombre = `${p.nombre}${p.medida ? ' (' + p.medida + ')' : ''}`.trim();
            const precioVal = (typeof p.precio === 'number') ? p.precio : null;
            const precioTxt = (typeof precioVal === 'number') ? `$${formatCurrency(precioVal)}` : 'Consultar precio';
            resumenLineas.push(`🛏 *Colchón:* ${nombre} — ${precioTxt}`);
            if (typeof precioVal === 'number') {
              total += precioVal;
            } else {
              totalConocido = false;
            }
          } else if (state.medida && state.tipo) {
            const medida = state.medida;
            const colchonTipo = state.tipo?.toUpperCase() || '';
            const precioColchonVal = (precios[state.tipo] && precios[state.tipo][state.medida]) ? precios[state.tipo][state.medida] : 0;
            const precioColchonTxt = typeof precioColchonVal === 'number' ? `$${formatCurrency(precioColchonVal)}` : precioColchonVal;
            resumenLineas.push(`📦 *Colchón:* ${colchonTipo} ${medida} — ${precioColchonTxt}`);
            if (typeof precioColchonVal === 'number') {
              total += precioColchonVal;
            } else {
              totalConocido = false;
            }
            // Base cama: tomamos el nombre y precio desde basecamaProducto si existe, de lo contrario usamos el mapa estático para compatibilidad.
            let basecamaTxt = 'No incluida';
            let basePrice = 0;
            if (state.basecamaProducto && state.basecamaProducto.precio != null) {
              basecamaTxt = `${state.basecamaProducto.nombre} — $${formatCurrency(state.basecamaProducto.precio)}`;
              basePrice = state.basecamaProducto.precio;
            } else {
              if (state.basecama === '1') { basecamaTxt = 'Base cama dividida — $450.000'; basePrice = 450000; }
              if (state.basecama === '2') { basecamaTxt = 'Base cama cajones — $850.000'; basePrice = 850000; }
              if (state.basecama === '3') { basecamaTxt = 'Base cama baúl — $1.050.000'; basePrice = 1050000; }
              if (state.basecama === '4') { basecamaTxt = 'Base cama nido — $700.000'; basePrice = 700000; }
              if (state.basecama === null) { basecamaTxt = 'No incluida'; basePrice = 0; }
            }
            resumenLineas.push(`🛏️ *Base cama:* ${basecamaTxt}`);
            if (basePrice > 0) {
              total += basePrice;
            }
            // Cabecero: mapear precios actualizados de acuerdo al producto seleccionado
            let cabeceroTxt = 'No incluido';
            let cabPrice = 0;
            
            const cabeceroNames = { '1': 'Belén', '2': 'Roma', '3': 'Torino', '4': 'Florencia', '5': 'Venecia' };
            if (['1','2','3','4','5'].includes(state.cabecero)) {
              const precioCab = getCabeceroPriceBySize(state.medida);
              cabeceroTxt = `${cabeceroNames[state.cabecero]} — $${formatCurrency(precioCab)}`;
              cabPrice = precioCab;
            }
    
    if (state.cabecero === '6' || state.cabecero === null) {
              cabeceroTxt = 'No incluido';
              cabPrice = 0;
            }
            resumenLineas.push(`🛋️ *Cabecero:* ${cabeceroTxt}`);
            if (state.cabecero && typeof cabPrice === 'number') {
              total += cabPrice;
            }
          } else if (state.muebleProducto) {
            // Flujo de salas/sofá cama
            const categoria = state.muebleTipo === 'salas' ? 'Sala' : 'Sofá cama';
            const nombre = state.muebleProducto.nombre;
            const precioVal = state.muebleProducto.precio;
            const precioTxt = (typeof precioVal === 'number') ? `$${formatCurrency(precioVal)}` : 'Consultar precio';
            resumenLineas.push(`🛋️ *${categoria}:* ${nombre} — ${precioTxt}`);
            if (typeof precioVal === 'number') {
              total += precioVal;
            } else {
              totalConocido = false;
            }
          } else if (state.comedorProducto) {
            // Flujo de comedores/muebles
            const categoria = state.comedorTipo === 'comedores' ? 'Comedor' : 'Mueble';
            const nombre = state.comedorProducto.nombre;
            const precioVal = state.comedorProducto.precio;
            const precioTxt = (typeof precioVal === 'number') ? `$${formatCurrency(precioVal)}` : 'Consultar precio';
            const icono = (state.comedorTipo === 'comedores') ? '🍽️' : '🪑';
            resumenLineas.push(`${icono} *${categoria}:* ${nombre} — ${precioTxt}`);
            if (typeof precioVal === 'number') {
              total += precioVal;
            } else {
              totalConocido = false;
            }
          } else if (state.almohadaProducto) {
            // Flujo de almohadas/protectores
            if (state.almohadaTipo === 'protectores') {
              // Para protectores utilizamos la medida y precio seleccionados si existen
              const nombre = state.almohadaProducto.nombre;
              const sizeKey = state.protectorSize;
              const precioVal = (typeof state.protectorPrice === 'number') ? state.protectorPrice : state.almohadaProducto.precio;
              const medidaTxt = sizeKey ? ` (${sizeKey.replace('x', ' x ')})` : '';
              const precioTxt = (typeof precioVal === 'number') ? `$${formatCurrency(precioVal)}` : 'Consultar precio';
              resumenLineas.push(`🛡️ *Protector:* ${nombre}${medidaTxt} — ${precioTxt}`);
              if (typeof precioVal === 'number') {
                total += precioVal;
              } else {
                totalConocido = false;
              }
            } else {
              // Para almohadas mantenemos la lógica original
              const nombre = state.almohadaProducto.nombre;
              const precioVal = state.almohadaProducto.precio;
              const precioTxt = (typeof precioVal === 'number') ? `$${formatCurrency(precioVal)}` : 'Consultar precio';
              resumenLineas.push(`😴 *Almohada:* ${nombre} — ${precioTxt}`);
              if (typeof precioVal === 'number') {
                total += precioVal;
              } else {
                totalConocido = false;
              }
            }
          } else {
            // Si no tenemos ninguna selección, mostramos mensaje genérico
            resumenLineas.push('No se ha seleccionado ningún producto.');
            totalConocido = false;
          }
          // Construimos texto de total
          const totalTxt = totalConocido ? `$${formatCurrency(total)}` : 'Consultar precio';
          const resumenTexto = resumenLineas.join('\n');
          const metodoPagoTxt = state.pagoDetalle === 'tarjeta_bold' ? 'Tarjeta (crédito/débito) - Link Bold' : 'Pago contraentrega';
          const mensajeFinal = `
🛒 *Resumen de tu pedido:*

${resumenTexto}

💵 *Total:* ${totalTxt}

💳 *Medio de pago:* ${metodoPagoTxt}

` +
            `📝 *Para finalizar tu pedido, por favor envíanos:*\n` +
            `• Nombre completo\n` +
            `• Ciudad y barrio de entrega\n` +
            `• Dirección de entrega\n` +
            `• Número de contacto\n\n` +
            `🙏 *Gracias por elegir Slumber, tu descanso en manos de especialistas en calidad y confort.*\n` +
            `
\n\n` +
            `↩ *Escribe "inicio"* para regresar al menú principal.`;
          return sendMessage(from, mensajeFinal);
        }
        if (text === '2') {
          // El usuario quiere ver opciones de pago. Reiniciamos el estado y mostramos el menú de pagos.
          userStates[from].pagoDetalle = null;
          userStates[from].pagoStep = null;
          return sendMessage(from, getOpcionesPagoMessage());
        }
        // Permitir regresar al inicio
        if ([ 'inicio', 'menú', 'menu', 'volver' ].includes(text)) {
          delete userStates[from];
          return sendMessage(from, getMenuMessage());
        }
        return sendMessage(from, '⚠️ Escribe *1* para finalizar tu pedido, *2* para ver opciones de pago o *"inicio"* para regresar al menú principal.');
      }

      // Financiación ADDI: paso de confirmación
      if (state.pagoDetalle === 'addi' && state.pagoStep === 'confirmar') {
        if (text === '1') {
          // Finalizar pedido con ADDI: construimos el resumen completo y solicitamos datos de financiación y entrega
          const resumenLineas = [];
          let total = 0;
          let totalConocido = true;
          // Si se seleccionó un colchón, agregamos su resumen y sumamos su precio
          if (state.promoProducto && (!state.medida || !state.tipo)) {
            const p = state.promoProducto;
            const nombre = `${p.nombre}${p.medida ? ' (' + p.medida + ')' : ''}`.trim();
            const precioVal = (typeof p.precio === 'number') ? p.precio : null;
            const precioTxt = (typeof precioVal === 'number') ? `$${formatCurrency(precioVal)}` : 'Consultar precio';
            resumenLineas.push(`🛏 *Colchón:* ${nombre} — ${precioTxt}`);
            if (typeof precioVal === 'number') {
              total += precioVal;
            } else {
              totalConocido = false;
            }
          } else if (state.medida && state.tipo) {
            const medida = state.medida;
            const colchonTipo = state.tipo?.toUpperCase() || '';
            const precioColchonVal = (precios[state.tipo] && precios[state.tipo][state.medida]) ? precios[state.tipo][state.medida] : 0;
            const precioColchonTxt = typeof precioColchonVal === 'number' ? `$${formatCurrency(precioColchonVal)}` : precioColchonVal;
            resumenLineas.push(`📦 *Colchón:* ${colchonTipo} ${medida} — ${precioColchonTxt}`);
            if (typeof precioColchonVal === 'number') {
              total += precioColchonVal;
            } else {
              totalConocido = false;
            }
            // Base cama
            let basecamaTxt = 'No incluida';
            let basePrice = 0;
            if (state.basecamaProducto && state.basecamaProducto.precio != null) {
              basecamaTxt = `${state.basecamaProducto.nombre} — $${formatCurrency(state.basecamaProducto.precio)}`;
              basePrice = state.basecamaProducto.precio;
            } else {
              if (state.basecama === '1') { basecamaTxt = 'Base cama dividida — $450.000'; basePrice = 450000; }
              if (state.basecama === '2') { basecamaTxt = 'Base cama cajones — $850.000'; basePrice = 850000; }
              if (state.basecama === '3') { basecamaTxt = 'Base cama baúl — $1.050.000'; basePrice = 1050000; }
              if (state.basecama === '4') { basecamaTxt = 'Base cama nido — $700.000'; basePrice = 700000; }
              if (state.basecama === null) { basecamaTxt = 'No incluida'; basePrice = 0; }
            }
            resumenLineas.push(`🛏️ *Base cama:* ${basecamaTxt}`);
            if (basePrice > 0) {
              total += basePrice;
            }
            // Cabecero
            let cabeceroTxt = 'No incluido';
            let cabPrice = 0;
            const cabeceroNames = { '1': 'Belén', '2': 'Roma', '3': 'Torino', '4': 'Florencia', '5': 'Venecia' };
            if (['1','2','3','4','5'].includes(state.cabecero)) {
              const precioCab = getCabeceroPriceBySize(state.medida);
              cabeceroTxt = `${cabeceroNames[state.cabecero]} — $${formatCurrency(precioCab)}`;
              cabPrice = precioCab;
            }
            if (state.cabecero === '6' || state.cabecero === null) {
              cabeceroTxt = 'No incluido';
              cabPrice = 0;
            }
            resumenLineas.push(`🛋️ *Cabecero:* ${cabeceroTxt}`);
            if (state.cabecero && typeof cabPrice === 'number') {
              total += cabPrice;
            }
          } else if (state.muebleProducto) {
            // Sala o sofá cama
            const categoria = state.muebleTipo === 'salas' ? 'Sala' : 'Sofá cama';
            const nombre = state.muebleProducto.nombre;
            const precioVal = state.muebleProducto.precio;
            const precioTxt = (typeof precioVal === 'number') ? `$${formatCurrency(precioVal)}` : 'Consultar precio';
            resumenLineas.push(`🛋️ *${categoria}:* ${nombre} — ${precioTxt}`);
            if (typeof precioVal === 'number') {
              total += precioVal;
            } else {
              totalConocido = false;
            }
          } else if (state.comedorProducto) {
            // Comedor o mueble
            const categoria = state.comedorTipo === 'comedores' ? 'Comedor' : 'Mueble';
            const nombre = state.comedorProducto.nombre;
            const precioVal = state.comedorProducto.precio;
            const precioTxt = (typeof precioVal === 'number') ? `$${formatCurrency(precioVal)}` : 'Consultar precio';
            const icono = (state.comedorTipo === 'comedores') ? '🍽️' : '🪑';
            resumenLineas.push(`${icono} *${categoria}:* ${nombre} — ${precioTxt}`);
            if (typeof precioVal === 'number') {
              total += precioVal;
            } else {
              totalConocido = false;
            }
          } else if (state.almohadaProducto) {
            // Almohada o protector
            if (state.almohadaTipo === 'protectores') {
              const nombre = state.almohadaProducto.nombre;
              const sizeKey = state.protectorSize;
              const precioVal = (typeof state.protectorPrice === 'number') ? state.protectorPrice : state.almohadaProducto.precio;
              const medidaTxt = sizeKey ? ` (${sizeKey.replace('x', ' x ')})` : '';
              const precioTxt = (typeof precioVal === 'number') ? `$${formatCurrency(precioVal)}` : 'Consultar precio';
              resumenLineas.push(`🛡️ *Protector:* ${nombre}${medidaTxt} — ${precioTxt}`);
              if (typeof precioVal === 'number') {
                total += precioVal;
              } else {
                totalConocido = false;
              }
            } else {
              const nombre = state.almohadaProducto.nombre;
              const precioVal = state.almohadaProducto.precio;
              const precioTxt = (typeof precioVal === 'number') ? `$${formatCurrency(precioVal)}` : 'Consultar precio';
              resumenLineas.push(`😴 *Almohada:* ${nombre} — ${precioTxt}`);
              if (typeof precioVal === 'number') {
                total += precioVal;
              } else {
                totalConocido = false;
              }
            }
          } else {
            resumenLineas.push('No se ha seleccionado ningún producto.');
            totalConocido = false;
          }
          const totalTxt = totalConocido ? `$${formatCurrency(total)}` : 'Consultar precio';
          const resumenTexto = resumenLineas.join('\n');
          const mensajeDatos =
            `\n🛒 *Resumen de tu pedido:*\n\n${resumenTexto}\n\n💵 *Total:* ${totalTxt}\n\n` +
            `📄 *Para continuar con tu financiación ADDI, por favor envíanos:*\n` +
            `• Cédula\n` +
            `• Nombre y primer apellido\n` +
            `• Celular\n` +
            `• Correo electrónico\n` +
            `• Ciudad y barrio de entrega\n` +
            `• Dirección de entrega\n` +
            `• Número de contacto\n\n` +
            `🙏 Un asesor puede colaborarte con el proceso y despejar tus inquietudes.\n\n` +
            `↩ *Escribe \"inicio\"* para regresar al menú principal.`;
          // Enviamos el mensaje solicitando datos y dejamos el flujo en espera de datos
          await sendMessage(from, mensajeDatos);
          // Establecemos el paso para solicitar datos
          userStates[from].pagoStep = 'datos';
          return;
        }
        if (text === '2') {
          userStates[from].pagoDetalle = null;
          userStates[from].pagoStep = null;
          return sendMessage(from, getOpcionesPagoMessage());
        }
        if (['inicio','menú','menu','volver'].includes(text)) {
          delete userStates[from];
          return sendMessage(from, getMenuMessage());
        }
        return sendMessage(from, '⚠️ Escribe *1* para finalizar tu pedido, *2* para ver opciones de pago o *"inicio"* para regresar al menú principal.');
      }

      // Crédito VANTI: paso de confirmación
      if (state.pagoDetalle === 'vanti' && state.pagoStep === 'confirmar') {
        if (text === '1') {
          // Finalizar pedido con VANTI: construimos el resumen completo y solicitamos datos de crédito y entrega
          const resumenLineas = [];
          let total = 0;
          let totalConocido = true;
          if (state.promoProducto && (!state.medida || !state.tipo)) {
            const p = state.promoProducto;
            const nombre = `${p.nombre}${p.medida ? ' (' + p.medida + ')' : ''}`.trim();
            const precioVal = (typeof p.precio === 'number') ? p.precio : null;
            const precioTxt = (typeof precioVal === 'number') ? `$${formatCurrency(precioVal)}` : 'Consultar precio';
            resumenLineas.push(`🛏 *Colchón:* ${nombre} — ${precioTxt}`);
            if (typeof precioVal === 'number') {
              total += precioVal;
            } else {
              totalConocido = false;
            }
          } else if (state.medida && state.tipo) {
            const medida = state.medida;
            const colchonTipo = state.tipo?.toUpperCase() || '';
            const precioColchonVal = (precios[state.tipo] && precios[state.tipo][state.medida]) ? precios[state.tipo][state.medida] : 0;
            const precioColchonTxt = typeof precioColchonVal === 'number' ? `$${formatCurrency(precioColchonVal)}` : precioColchonVal;
            resumenLineas.push(`📦 *Colchón:* ${colchonTipo} ${medida} — ${precioColchonTxt}`);
            if (typeof precioColchonVal === 'number') {
              total += precioColchonVal;
            } else {
              totalConocido = false;
            }
            // Base cama
            let basecamaTxt = 'No incluida';
            let basePrice = 0;
            if (state.basecamaProducto && state.basecamaProducto.precio != null) {
              basecamaTxt = `${state.basecamaProducto.nombre} — $${formatCurrency(state.basecamaProducto.precio)}`;
              basePrice = state.basecamaProducto.precio;
            } else {
              if (state.basecama === '1') { basecamaTxt = 'Base cama dividida — $450.000'; basePrice = 450000; }
              if (state.basecama === '2') { basecamaTxt = 'Base cama cajones — $850.000'; basePrice = 850000; }
              if (state.basecama === '3') { basecamaTxt = 'Base cama baúl — $1.050.000'; basePrice = 1050000; }
              if (state.basecama === '4') { basecamaTxt = 'Base cama nido — $700.000'; basePrice = 700000; }
              if (state.basecama === null) { basecamaTxt = 'No incluida'; basePrice = 0; }
            }
            resumenLineas.push(`🛏️ *Base cama:* ${basecamaTxt}`);
            if (basePrice > 0) {
              total += basePrice;
            }
            // Cabecero
            let cabeceroTxt = 'No incluido';
            let cabPrice = 0;
            const cabeceroNames = { '1': 'Belén', '2': 'Roma', '3': 'Torino', '4': 'Florencia', '5': 'Venecia' };
            if (['1','2','3','4','5'].includes(state.cabecero)) {
              const precioCab = getCabeceroPriceBySize(state.medida);
              cabeceroTxt = `${cabeceroNames[state.cabecero]} — $${formatCurrency(precioCab)}`;
              cabPrice = precioCab;
            }
            if (state.cabecero === '6' || state.cabecero === null) {
              cabeceroTxt = 'No incluido';
              cabPrice = 0;
            }
            resumenLineas.push(`🛋️ *Cabecero:* ${cabeceroTxt}`);
            if (state.cabecero && typeof cabPrice === 'number') {
              total += cabPrice;
            }
          } else if (state.muebleProducto) {
            // Sala o sofá cama
            const categoria = state.muebleTipo === 'salas' ? 'Sala' : 'Sofá cama';
            const nombre = state.muebleProducto.nombre;
            const precioVal = state.muebleProducto.precio;
            const precioTxt = (typeof precioVal === 'number') ? `$${formatCurrency(precioVal)}` : 'Consultar precio';
            resumenLineas.push(`🛋️ *${categoria}:* ${nombre} — ${precioTxt}`);
            if (typeof precioVal === 'number') {
              total += precioVal;
            } else {
              totalConocido = false;
            }
          } else if (state.comedorProducto) {
            // Comedor o mueble
            const categoria = state.comedorTipo === 'comedores' ? 'Comedor' : 'Mueble';
            const nombre = state.comedorProducto.nombre;
            const precioVal = state.comedorProducto.precio;
            const precioTxt = (typeof precioVal === 'number') ? `$${formatCurrency(precioVal)}` : 'Consultar precio';
            const icono = (state.comedorTipo === 'comedores') ? '🍽️' : '🪑';
            resumenLineas.push(`${icono} *${categoria}:* ${nombre} — ${precioTxt}`);
            if (typeof precioVal === 'number') {
              total += precioVal;
            } else {
              totalConocido = false;
            }
          } else if (state.almohadaProducto) {
            // Almohada o protector
            if (state.almohadaTipo === 'protectores') {
              const nombre = state.almohadaProducto.nombre;
              const sizeKey = state.protectorSize;
              const precioVal = (typeof state.protectorPrice === 'number') ? state.protectorPrice : state.almohadaProducto.precio;
              const medidaTxt = sizeKey ? ` (${sizeKey.replace('x', ' x ')})` : '';
              const precioTxt = (typeof precioVal === 'number') ? `$${formatCurrency(precioVal)}` : 'Consultar precio';
              resumenLineas.push(`🛡️ *Protector:* ${nombre}${medidaTxt} — ${precioTxt}`);
              if (typeof precioVal === 'number') {
                total += precioVal;
              } else {
                totalConocido = false;
              }
            } else {
              const nombre = state.almohadaProducto.nombre;
              const precioVal = state.almohadaProducto.precio;
              const precioTxt = (typeof precioVal === 'number') ? `$${formatCurrency(precioVal)}` : 'Consultar precio';
              resumenLineas.push(`😴 *Almohada:* ${nombre} — ${precioTxt}`);
              if (typeof precioVal === 'number') {
                total += precioVal;
              } else {
                totalConocido = false;
              }
            }
          } else {
            resumenLineas.push('No se ha seleccionado ningún producto.');
            totalConocido = false;
          }
          const totalTxt = totalConocido ? `$${formatCurrency(total)}` : 'Consultar precio';
          const resumenTexto = resumenLineas.join('\n');
          const mensajeDatos =
            `\n🛒 *Resumen de tu pedido:*\n\n${resumenTexto}\n\n💵 *Total:* ${totalTxt}\n\n` +
            `📄 *Para continuar con tu crédito VANTI, por favor envíanos:*\n` +
            `• Cédula del titular\n` +
            `• Número de contrato\n` +
            `• Ciudad y barrio de entrega\n` +
            `• Dirección de entrega\n` +
            `• Número de contacto\n\n` +
            `🙏 Un asesor puede colaborarte con el proceso y despejar tus inquietudes.\n\n` +
            `↩ *Escribe \"inicio\"* para regresar al menú principal.`;
          // Enviamos el mensaje solicitando datos y dejamos el flujo en espera de datos
          await sendMessage(from, mensajeDatos);
          userStates[from].pagoStep = 'datos';
          return;
        }
        if (text === '2') {
          userStates[from].pagoDetalle = null;
          userStates[from].pagoStep = null;
          return sendMessage(from, getOpcionesPagoMessage());
        }
        if (['inicio','menú','menu','volver'].includes(text)) {
          delete userStates[from];
          return sendMessage(from, getMenuMessage());
        }
        return sendMessage(from, '⚠️ Escribe *1* para finalizar tu pedido, *2* para ver opciones de pago o *"inicio"* para regresar al menú principal.');
      }

      // Contraentrega: después de solicitar datos
      if (state.pagoDetalle === 'contraentrega' && state.pagoStep === 'datos') {
        // Si el usuario quiere volver al inicio, borramos el estado y mostramos el menú principal.
        if (['inicio','menú','menu','volver'].includes(text)) {
          delete userStates[from];
          return sendMessage(from, getMenuMessage());
        }
        // Agradecemos los datos y marcamos la conversación para atención manual.  Esto evita
        // respuestas automáticas posteriores y permite que un asesor humano continúe el chat.
        await sendMessage(from, '🙏 Gracias por enviar tus datos. Un asesor se comunicará contigo en breve.');
        userStates[from].flujo = 'manual';
        return;
      }

      // Financiación ADDI: después de solicitar datos
      if (state.pagoDetalle === 'addi' && state.pagoStep === 'datos') {
        // Permitir volver al inicio
        if (['inicio','menú','menu','volver'].includes(text)) {
          delete userStates[from];
          return sendMessage(from, getMenuMessage());
        }
        // Agradecemos los datos y pasamos a modo manual
        await sendMessage(from, '🙏 Gracias por enviar tus datos. Un asesor se comunicará contigo en breve.');
        userStates[from].flujo = 'manual';
        return;
      }

      // Crédito VANTI: después de solicitar datos
      if (state.pagoDetalle === 'vanti' && state.pagoStep === 'datos') {
        if (['inicio','menú','menu','volver'].includes(text)) {
          delete userStates[from];
          return sendMessage(from, getMenuMessage());
        }
        await sendMessage(from, '🙏 Gracias por enviar tus datos. Un asesor se comunicará contigo en breve.');
        userStates[from].flujo = 'manual';
        return;
      }


      // Tarjeta (Bold): después de solicitar datos
      if (state.pagoDetalle === 'tarjeta_bold' && state.pagoStep === 'datos') {
        if (['inicio','menú','menu','volver'].includes(text)) {
          delete userStates[from];
          return sendMessage(from, getMenuMessage());
        }
        await sendMessage(from, '🙏 Gracias por enviar tus datos. Un asesor se comunicará contigo para enviarte el link de pago (Bold) y guiarte en el proceso con tarjeta.');
        userStates[from].flujo = 'manual';
        return;
      }


      // Para otros métodos de pago (ADDI, VANTI) mantenemos la lógica existente:
      if (text === '1') {
        // Reiniciar para mostrar otras opciones de pago
        userStates[from].pagoDetalle = null;
        return sendMessage(from, getOpcionesPagoMessage());
      }
      if (['inicio','menú','menu','volver'].includes(text)) {
        delete userStates[from];
        return sendMessage(from, getMenuMessage());
      }
        return sendMessage(from, '⚠️ Escribe *1* para ver opciones de pago o *"inicio"* para regresar al menú principal.');
    }


    // Opción 1: Pago contraentrega
    if (text === '1') {
      // Guardamos el método y el paso de confirmación
      userStates[from].pagoDetalle = 'contraentrega';
      userStates[from].pagoStep = 'confirmar';
      // Construimos solo el mensaje informativo de contraentrega (sin resumen)
      const mensajeContra =
        `\n📦 *PAGO CONTRAENTREGA*\n\n` +
        // Primero informamos del anticipo y el saldo que se paga al recibir.
        `💳 Se requiere un anticipo del *10%* al realizar el pedido y el *90%* restante se paga cuando recibes tu pedido.\n\n` +
        // Luego listamos las ciudades en las que aplica el servicio y aclaramos que el envío es gratuito.
        `📍 *Disponible solo en Bogotá, Madrid (Cundinamarca), Facatativá, Mosquera, Funza, Bojacá y El Rosal.*\n` +
        `🛵 En estas ciudades el envío es *gratis*.\n` +
        // Finalmente aclaramos que en otras ciudades debe pagarse el total de la compra por adelantado.
        `🏷️ Para otras ciudades o municipios se debe cancelar el *100%* del valor de la compra en el momento del pedido.\n\n` +
        `✳ *¿Qué deseas hacer ahora?*\n` +
        `${ENUM_ICONS[0]} *Finalizar pedido*\n` +
        `${ENUM_ICONS[1]} *Ver opciones de pago*\n` +
        `↩ *Escribe "inicio"* para regresar al menú principal.`;
      return sendMessage(from, mensajeContra);
    }

    // Opción 2: Financiación con ADDI
    if (text === '2') {
      // Selecciona financiación con ADDI e inicia el paso de confirmación
      userStates[from].pagoDetalle = 'addi';
      userStates[from].pagoStep   = 'confirmar';
      return sendMessage(from, `
🏦 *Financiación con ADDI*

Compra hoy y paga en cuotas de manera rápida y segura. Puedes solicitar o verificar tu *cupo* en la página oficial de ADDI antes de realizar tu compra.

Un asesor puede colaborarte con el proceso de solicitud y resolver tus inquietudes. Para continuar con tu financiación, debes finalizar tu pedido.

✳️ *¿Qué deseas hacer ahora?*\n${ENUM_ICONS[0]} *Finalizar pedido*\n${ENUM_ICONS[1]} *Ver opciones de pago*\n↩ *Escribe "inicio"* para regresar al menú principal.
      `);
    }

    // Opción 3: Crédito VANTI
    if (text === '3') {
      // Selecciona crédito VANTI e inicia el paso de confirmación
      userStates[from].pagoDetalle = 'vanti';
      userStates[from].pagoStep   = 'confirmar';
      return sendMessage(from, `
🏦 *Crédito VANTI*

Financia tu compra con cuotas cómodas y sin cuota inicial. Puedes solicitar tu crédito y conocer tu *cupo* en la página oficial de Vanti.

📄 *Recuerda que el trámite debe ser realizado solo por el titular de la cuenta.*

Un asesor puede colaborarte con la solicitud y despejar tus dudas. Para proceder con el crédito VANTI, debes finalizar tu pedido.

✳️ *¿Qué deseas hacer ahora?*\n${ENUM_ICONS[0]} *Finalizar pedido*\n${ENUM_ICONS[1]} *Ver opciones de pago*\n↩ *Escribe "inicio"* para volver al menú principal.
      `);
    }


    // Opción 4: Pago anticipado (transferencia)
    if (text === '4') {
      // Selecciona pago anticipado e inicia el paso de confirmación
      userStates[from].pagoDetalle = 'anticipado';
      userStates[from].pagoStep   = 'confirmar';
      return sendPagoAnticipado(from);
    }

    // Opción 5: Pago con tarjeta (Crédito / Débito) - Link de pago (Bold)
    if (text === '5') {
      userStates[from].pagoDetalle = 'tarjeta_bold';
      userStates[from].pagoStep   = 'confirmar';
      return sendMessage(from,
        `💳 *Pago con tarjeta (crédito o débito) — Link de pago (Bold)*\n\n` +
        `Este pago se realiza por un *link de pago (Bold)* que te enviará el asesor al finalizar tu compra.\n\n` +
        `✳ *¿Qué deseas hacer ahora?*\n` +
        `${ENUM_ICONS[0]} *Finalizar pedido*\n` +
        `${ENUM_ICONS[1]} *Ver opciones de pago*\n` +
        `↩ *Escribe "inicio"* para regresar al menú principal.`
      );
    }

  }


  // ===== Flujo informativo de Pagos y financiación (menú principal opción 4) =====
  // Este bloque fue movido fuera del flujo 'pago' para que se ejecute correctamente
  if (state?.flujo === 'pago_info') {
    // Si el usuario ya eligió un método y está revisando la información, permitimos ver otras opciones o volver al menú principal.
    if (state.pagoInfoMetodo && state.pagoInfoStep === 'menu') {
      if (text === '1') {
        // Mostrar nuevamente las opciones de pago y limpiar la selección actual
        userStates[from].pagoInfoMetodo = null;
        userStates[from].pagoInfoStep = null;
        return sendMessage(from, getOpcionesPagoMessage());
      }
      if (['inicio','menú','menu','volver'].includes(text)) {
        delete userStates[from];
        return sendMessage(from, getMenuMessage());
      }
      // Cualquier otra entrada es inválida
      return sendMessage(from, '⚠️ Por favor, responde con *1* para ver opciones de pago o escribe *"inicio"* para regresar al menú principal.');
    }
    // Si el usuario ya escogió un método y estamos esperando datos
    if (state.pagoInfoMetodo && state.pagoInfoStep === 'datos') {
      // Permitir volver al inicio
      if (['inicio','menú','menu','volver'].includes(text)) {
        delete userStates[from];
        return sendMessage(from, getMenuMessage());
      }
      // Agradecemos los datos enviados y avisamos que un asesor se pondrá en contacto.
      // Marcamos la conversación como manual para que no se envíen más respuestas automáticas.
      await sendMessage(from, '🙏 *Gracias por enviar tus datos.* Un asesor se comunicará contigo en breve para continuar el proceso.');
      userStates[from].flujo = 'manual';
      return;
    }
    // Si aún no ha elegido un método de pago/información
    if (!state.pagoInfoMetodo) {
      if (text === '1') {
        // Pago contraentrega informativo.  Describimos la modalidad y solicitamos datos básicos para continuar.
        userStates[from].pagoInfoMetodo = 'contraentrega';
        userStates[from].pagoInfoStep = 'menu';
        return sendMessage(from,
          `\n📦 *PAGO CONTRAENTREGA*\n\n` +
          `💳 Se requiere un anticipo del *10%* al realizar el pedido y el *90%* restante se paga cuando recibes tu pedido.\n\n` +
          `📍 *Disponible solo en Bogotá, Madrid (Cundinamarca), Facatativá, Mosquera, Funza, Bojacá y El Rosal.*\n` +
          `🛵 En estas ciudades el envío es *gratis*.\n` +
          `🏷️ Para otras ciudades o municipios se debe cancelar el *100%* del valor de la compra al momento del pedido.\n\n` +
          `✳ *¿Qué deseas hacer ahora?*\n` +
          // Utilizamos emojis numéricos en lugar de glifos de enumeración no soportados
          `${ENUM_ICONS[0]} *Ver opciones de pago*\n` +
          `↩ *Escribe "inicio" para regresar al menú principal.*`);
      }
      if (text === '2') {
        // Financiación ADDI informativa
        userStates[from].pagoInfoMetodo = 'addi';
        userStates[from].pagoInfoStep = 'menu';
        return sendMessage(from, `\n🏦 *Financiación con ADDI*\n\n` +
          `Compra hoy y paga en cuotas de manera rápida y segura. Puedes solicitar o verificar tu *cupo* en la página oficial de ADDI antes de realizar tu compra.\nRequisitos mínimos y respuesta ágil.\n\n` +
          `✳ *¿Qué deseas hacer ahora?*\n` +
          // Reemplazamos glifos por emojis numéricos para compatibilidad
          `${ENUM_ICONS[0]} *Ver opciones de pago*\n` +
          `↩ *Escribe "inicio" para regresar al menú principal.*`);
      }
      if (text === '3') {
        // Crédito VANTI informativa
        userStates[from].pagoInfoMetodo = 'vanti';
        userStates[from].pagoInfoStep = 'menu';
        return sendMessage(from, `\n🏦 *Crédito VANTI*\n\n` +
          `Financia tu compra con cuotas cómodas y sin cuota inicial. Puedes solicitar tu crédito y conocer tu *cupo* en la página oficial de Vanti antes de realizar tu compra.\n\n` +
          `✳ *¿Qué deseas hacer ahora?*\n` +
          // Utilizamos emojis numéricos para enumerar las opciones
          `${ENUM_ICONS[0]} *Ver opciones de pago*\n` +
          `↩ *Escribe "inicio" para regresar al menú principal.*`);
      }
      
      if (text === '4') {
        // Pago anticipado informativo: solo descripción con datos bancarios
        userStates[from].pagoInfoMetodo = 'anticipado';
        userStates[from].pagoInfoStep = 'menu';
        return sendMessage(from, `\n🏦 *Pago anticipado (transferencia)*\n\n` +
          `Puedes pagar el 100% de tu compra por transferencia. Esta opción se utiliza para envíos fuera de las ciudades habilitadas para contraentrega o si prefieres anticipar el pago completo. Los datos bancarios son los siguientes:\n\n` +
          `• *Empresa:* Slumber\n` +
          `• *Banco:* Bancolombia\n` +
          `• *Cuenta:* 231-000039-32 (Ahorros)\n` +
          `• *NIT:* 901.770.087-1\n` +
          `• *Nequi / Daviplata:* 3102796080\n\n` +
          `✳ *¿Qué deseas hacer ahora?*\n` +
          // Sustituimos las listas con emojis numéricos para compatibilidad
          `${ENUM_ICONS[0]} *Ver opciones de pago*\n` +
          `↩ *Escribe "inicio" para regresar al menú principal.*`);
      }

      if (text === '5') {
        // Pago con tarjeta (Bold) informativo
        userStates[from].pagoInfoMetodo = 'tarjeta_bold';
        userStates[from].pagoInfoStep = 'menu';
        return sendMessage(from,
          `\n💳 *Pago con tarjeta (crédito o débito) — Link de pago (Bold)*\n\n` +
          `Este pago se realiza por un *link de pago (Bold)* que te enviará un asesor al finalizar tu compra.\n\n` +
          `✅ Un asesor te guiará paso a paso hasta finalizar el pago.\n\n` +
          `✳ *¿Qué deseas hacer ahora?*\n` +
          `${ENUM_ICONS[0]} *Ver opciones de pago*\n` +
          `↩ *Escribe "inicio" para regresar al menú principal.*`
        );
      }
// Permitir volver al menú principal
      if (['inicio','menú','menu','volver'].includes(text)) {
        delete userStates[from];
        return sendMessage(from, getMenuMessage());
      }
      // Otra entrada no válida
      return sendMessage(from, '⚠️ Por favor, elige *1*, *2*, *3*, *4* o *5*, o escribe *"inicio"* para regresar al menú principal.');
    }
  }

  return sendMessage(from, `👋 ¡Hola! No entendí tu mensaje. Escribe *"inicio"* para ver el menú o una palabra como *"colchones"*.`);

// (El manejo de pagos anticipados dentro del flujo informativo ya se gestiona en la lógica anterior.)

}

function getMenuMessage() {
  // Construimos el menú principal con el nuevo orden y opciones.  Utilizamos emojis numéricos
  // para asegurar la compatibilidad en todas las plataformas.  Ajusta los textos si es
  // necesario pero mantén la estructura de enumeración.
  return `
👋 *¡Hola! Bienvenido a Slumber* 🛏️

Selecciona una opción para continuar:

1️⃣ *Colchones* — tipos, medidas y precios  
2️⃣ *Salas y sofá camas*  
3️⃣ *Comedores y muebles*  
4️⃣ *Almohadas y protectores*  
5️⃣ *Promociones*  
6️⃣ *Pagos y financiación*  
7️⃣ *Soporte al cliente* (garantía, seguimiento)

✳ *Escribe el número de tu elección* para avanzar.`;
}

/* ==========================
   Atajos de “catálogo” globales
========================== */
async function tryCatalogShortcuts(from, text) {
  const t = (text || '').toLowerCase();
  if (t.includes('catalogo cabeceros') || t.includes('catálogo cabeceros')) {
    await sendMessage(from, '📘 Cabeceros — Enviando PDF...');
    return true;
  }
  if (t.includes('catalogo basecamas') || t.includes('catálogo basecamas')) {
    await sendMessage(from, '📘 Basecamas — Enviando PDF...');
    return true;
  }
  if (t.includes('catalogo muebles') || t.includes('catálogo muebles') || t.includes('catalogo salas') || t.includes('catálogo salas')) {
    await sendMessage(from, '📘 Muebles/Salas — Enviando PDF...');
    return true;
  }
  return false;
}
