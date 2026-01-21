const express = require('express');
// Express 5.x incluye su propio middleware JSON, no es necesario body-parser.
const dotenv = require('dotenv');
const whatsappController = require('./whatsappController');

// Load environment variables from .env file if present. This will not override
// environment variables explicitly set in the hosting provider (e.g. Render).
dotenv.config();

const app = express();

// Prefer the PORT provided by the hosting environment (e.g. Render or Heroku).
// Fall back to 3000 when running locally.
const PORT = process.env.PORT || 3000;

// Analiza automáticamente las solicitudes JSON entrantes.
app.use(express.json());

// Verifica que las variables de entorno esenciales existan y muestra una advertencia si no.
const requiredEnv = ['VERIFY_TOKEN', 'WHATSAPP_TOKEN', 'PHONE_NUMBER_ID'];
requiredEnv.forEach(key => {
  if (!process.env[key]) {
    console.warn(`⚠️ Advertencia: La variable de entorno ${key} no está definida.`);
  }
});

// Health check endpoint. This simple route returns "OK" and can be used by
// hosting providers or monitoring tools to verify that the server is running.
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Webhook verification endpoint. WhatsApp Cloud API will perform a GET
// request to this path with specific query parameters to verify your
// verify token. The verifyWebhook handler responds with the challenge from
// WhatsApp when the tokens match.
app.get('/webhook', whatsappController.verifyWebhook);

// Webhook receiver endpoint. All incoming messages and events from WhatsApp
// Cloud API will arrive here as POST requests. The handleMessage
// method processes the payload and sends appropriate replies.
app.post('/webhook', whatsappController.handleMessage);

// Start the HTTP server. Listening on the configured PORT allows the server
// to accept incoming webhook requests. When deploying to Render or similar,
// ensure that the app listens on process.env.PORT.
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});