import { backup, DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
const source=process.env.DATABASE_PATH||'data/kidtube.sqlite';
const target=join(dirname(source),'backups','kidtube-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite');
mkdirSync(dirname(target),{recursive:true,mode:0o700});
const db=new DatabaseSync(source,{readOnly:true});
try{await backup(db,target);console.log(target);console.log('Also back up videos/, brand/, secret and .env (if you have one). Stop writes while copying a full restore set.');}finally{db.close();}
