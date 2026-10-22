// Sends one test email with this install's mail settings (npm run email:test).
import { installPaths } from '../server/config.mjs';
import { openDatabase } from '../server/db.mjs';
import { sendMail } from '../server/mail.mjs';
import { BRAND_NAME } from '../server/brand.mjs';
import { createSettings } from '../server/settings.mjs';

// Mail settings come from .env when it sets them, otherwise from what the parent saved in the wizard or dashboard.
const { sqlite } = openDatabase(installPaths().database);
let mail;
try {
  const settings = createSettings(sqlite);
  mail = { MAIL_MODE: settings.get('mail_mode'), BREVO_API_KEY: settings.get('brevo_api_key'), SENDER_EMAIL: settings.get('sender_email'), NOTIFY_EMAIL: settings.get('notify_email') };
} finally { sqlite.close(); }
if (mail.MAIL_MODE !== 'brevo') throw new Error('Email is off. Turn it on in the parent dashboard (Settings) or set MAIL_MODE=brevo first.');
await sendMail(mail, { email: mail.NOTIFY_EMAIL }, `${BRAND_NAME} email setup test`, `<p>Your ${BRAND_NAME} email connection is working.</p>`, `Your ${BRAND_NAME} email connection is working.`);
console.log('Brevo accepted the test message. Check the recipient inbox and provider delivery log.');
