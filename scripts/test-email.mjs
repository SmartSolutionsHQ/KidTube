import { sendMail } from '../server/mail.mjs';
if(process.env.MAIL_MODE!=='brevo')throw new Error('Set MAIL_MODE=brevo and configure the sender first.');
await sendMail(process.env,{email:process.env.NOTIFY_EMAIL},'KidTube email setup test','<p>Your KidTube email connection is working.</p>','Your KidTube email connection is working.');
console.log('Brevo accepted the test message. Check the recipient inbox and provider delivery log.');
