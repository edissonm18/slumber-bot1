const express = require('express');
// Express 5.x incluye su propio middleware JSON, no es necesario body-parser.
const dotenv = require('dotenv');
const whatsappController = require('./whatsappController');

dotenv.config();

const app = express();
// Puerto configurado a través de la variable de entorno PORT o 3000 por defecto.
const PORT = process.env.PORT || 3000;

// Analiza automáticamente las solicitudes JSON entrantes.
app.use(express.json());

// Endpoint de salud para monitorización.
app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

// Verifica que las variables de entorno esenciales existan y muestra una advertencia si no.
const requiredEnv = ['VERIFY_TOKEN', 'WHATSAPP_TOKEN', 'PHONE_NUMBER_ID', 'SHEET_ID', 'GOOGLE_SHEETS_CREDENTIALS'];
requiredEnv.forEach(key => {
  if (!process.env[key]) {
    console.warn(`⚠️ Advertencia: La variable de entorno ${key} no está definida.`);
  }
});

// Rutas del webhook
app.get('/webhook', whatsappController.verifyWebhook);
app.post('/webhook', whatsappController.handleMessage);

// Inicia el servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
