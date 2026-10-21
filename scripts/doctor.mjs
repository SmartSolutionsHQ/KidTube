import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
let failures=0;
function check(name,ok){console.log(`${ok?'OK':'MISSING'}: ${name}`);if(!ok)failures++;}
check('Node 24.16 or later in the Node 24 line',Number(process.versions.node.split('.')[0])===24&&Number(process.versions.node.split('.')[1])>=16);
for(const binary of ['ffmpeg','ffprobe'])check(binary,spawnSync(binary,['-version'],{stdio:'ignore'}).status===0);
check('Private .env file',existsSync('.env'));
check('Signing secret (32+ characters)',(process.env.SIGN_SECRET||'').length>=32);
check('Database initialized',existsSync(process.env.DATABASE_PATH||'data/kidtube.sqlite'));
check('SITE_URL configured',/^https?:\/\//.test(process.env.SITE_URL||''));
if(process.env.MAIL_MODE==='brevo')for(const key of ['BREVO_API_KEY','SENDER_EMAIL','NOTIFY_EMAIL'])check(key,Boolean(process.env[key]));
console.log('Mail mode: '+(process.env.MAIL_MODE||'disabled')+'. This check sends no email.');
process.exitCode=failures?1:0;
