import { existsSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { openDatabase } from '../server/db.mjs';
import { migrate } from '../server/schema.mjs';
import { createSettings } from '../server/settings.mjs';
import { passwordRecord } from '../server/passwords.mjs';

// Run from the project directory. Refuse to change an existing installation.
const database=resolve(process.env.DATABASE_PATH||'data/kidtube.sqlite');
if(existsSync('.env')||existsSync(database))throw new Error('An installation already exists. Setup never overwrites .env or a database. See docs/OPERATIONS.md.');
const rl=createInterface({input:process.stdin,output:process.stdout});
try {
 const email=String(process.env.KIDTUBE_ADMIN_EMAIL||await rl.question('Parent email: ')).trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Enter a valid email address.');
 const site=new URL(process.env.SITE_URL||await rl.question('Site URL [http://localhost:3000]: ')||'http://localhost:3000');
 if(!['http:','https:'].includes(site.protocol)||site.username||site.password||site.pathname!=='/'||site.search||site.hash)throw new Error('Use an HTTP(S) origin without a path.');
 const generated=!process.env.KIDTUBE_ADMIN_PASSWORD;
 const password=process.env.KIDTUBE_ADMIN_PASSWORD||randomBytes(18).toString('base64url');
 const record=await passwordRecord(password);
 const secret=randomBytes(48).toString('hex');
 mkdirSync(dirname(database),{recursive:true,mode:0o700});
 const {sqlite}=openDatabase(database,{allowEmpty:true});await migrate(sqlite);
 sqlite.prepare('INSERT INTO accounts(email,first,last,salt,hash,status,role,created) VALUES (?,?,?,?,?,?,?,?)').run(email,'Parent','Owner',record.salt,record.hash,'approved','super',Date.now());
 createSettings(sqlite,{}).set('setup_complete',true,email);
 sqlite.close();chmodSync(database,0o600);
 const env=['# Private installation settings. Do not commit this file.',`SITE_URL=${site.origin}`,`SIGN_SECRET=${secret}`,'MAIL_MODE=disabled','BREVO_API_KEY=',`NOTIFY_EMAIL=${email}`,'SENDER_EMAIL=','PORT=3000','HOST=127.0.0.1','PUID=1000','PGID=1000','TRUST_PROXY=0',''].join('\n');
 writeFileSync('.env',env,{flag:'wx',mode:0o600});
 if(generated)console.log('\nSave this generated parent password in your password manager:\n'+password+'\n');
 console.log('Setup complete. Run npm start, open '+site.origin+', then sign in and visit /parents.');
 console.log('For Docker/HTTPS and optional email, follow README.md before starting the container.');
}finally{rl.close();}
