import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const KEY = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
const err = message => { throw new Error(message); };

// Local CAS test/reference implementation only. For production, the same CAS
// interface must use external durable storage (GitHub, R2/D1, etc.).
export function createDigitalOceanJsonFileJournalV1({directory}={}) {
  if (typeof directory !== 'string' || !directory.trim()) err('DO_JOURNAL_DIRECTORY_REQUIRED');
  const base=resolve(directory);
  function paths(id) {
    if (!KEY.test(id) || id.includes('..')) err('DO_JOURNAL_KEY_INVALID');
    return {record:join(base,`${id}.json`),lock:join(base,`${id}.lock`)};
  }
  async function read(id) {
    const {record}=paths(id);
    try {return JSON.parse(await readFile(record,'utf8'));}
    catch(e){if(e?.code==='ENOENT')return null;throw e;}
  }
  async function cas(id,expectedRevision,next) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) err('DO_CAS_VERSION_REQUIRED');
    await mkdir(base,{recursive:true,mode:0o700});
    const {record,lock}=paths(id);
    try {await mkdir(lock, {mode:0o700});}
    catch(e){if(e?.code==='EEXIST')err('DO_JOURNAL_WRITER_LOCKED');throw e;}
    try {
      const prev=await read(id);
      if ((prev?.revision??0)!==expectedRevision) err('DO_JOURNAL_CAS_CONFLICT');
      if (!next || next.runId!==id) err('DO_JOURNAL_IDENTITY_MISMATCH');
      const saved={...next,revision:expectedRevision+1};
      const temp=join(lock,'next.json');
      const handle=await open(temp,'wx',0o600);
      try{await handle.writeFile(JSON.stringify(saved,null,2)+'\n');await handle.sync();}finally{await handle.close();}
      await rename(temp,record);
      return saved;
    } finally {
      // Leave an unexplained lock on process crash: manual inspection before
      // forced unlock is safer than two concurrent live mutation workers.
      await rm(lock,{recursive:true,force:true});
    }
  }
  return Object.freeze({read,cas});
}
