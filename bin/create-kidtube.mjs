#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const arg=process.argv[2];
if(!arg||arg==='--help'){console.log('Usage: create-kidtube <new-directory>\nCopies a clean KidTube starter. Then run npm run setup in that directory.');process.exit(arg?0:1);}
const destination=resolve(arg);
if(existsSync(destination))throw new Error('Destination already exists. Choose a new directory; no files were changed.');
const source=resolve(dirname(fileURLToPath(import.meta.url)),'..');
mkdirSync(destination,{recursive:true});
// docs/plan and scripts/dev are for maintainers, not part of a family's install.
const maintainerOnly=[join(source,'docs','plan'),join(source,'scripts','dev')];
for(const path of ['package.json','bin','server','public','scripts','test','docs','README.md','Dockerfile','compose.yaml','compose.https.yaml','Caddyfile','.env.example','.dockerignore','LICENSE','SECURITY.md'])cpSync(join(source,path),join(destination,path),{recursive:true,filter:src=>!maintainerOnly.includes(src)});
writeFileSync(join(destination,'.gitignore'),'.env\n.env.*\n!.env.example\ndata/\nnode_modules/\n*.tgz\n*.log\n');
console.log('Created '+destination+'\nNext: cd into that folder, then run npm run setup.');
