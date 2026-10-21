import { randomBytes } from 'node:crypto';
import { openDatabase } from '../server/db.mjs';
import { passwordRecord } from '../server/passwords.mjs';
const email=String(process.argv[2]||'').trim().toLowerCase();
if(!email)throw new Error('Usage: node --env-file=.env scripts/reset-parent.mjs parent@example.com');
const {sqlite}=openDatabase(process.env.DATABASE_PATH||'data/kidtube.sqlite');
try {
 const row=sqlite.prepare('SELECT role FROM accounts WHERE email=?').get(email);
 if(row?.role!=='super')throw new Error('No owner account with that email. No changes made.');
 const password=randomBytes(18).toString('base64url');const {salt,hash}=await passwordRecord(password);
 sqlite.prepare("UPDATE accounts SET salt=?,hash=?,status='approved' WHERE email=? AND role='super'").run(salt,hash,email);
 console.log('Save this new parent password securely:\n'+password);
}finally{sqlite.close();}
