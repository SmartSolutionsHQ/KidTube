import { sendMail } from '../server/mail.mjs';
import { BRAND_NAME } from '../server/settings.mjs';
if(process.env.MAIL_MODE!=='brevo')throw new Error('Set MAIL_MODE=brevo and configure the sender first.');
await sendMail(process.env,{email:process.env.NOTIFY_EMAIL},`${BRAND_NAME} email setup test`,`<p>Your ${BRAND_NAME} email connection is working.</p>`,`Your ${BRAND_NAME} email connection is working.`);
console.log('Brevo accepted the test message. Check the recipient inbox and provider delivery log.');
