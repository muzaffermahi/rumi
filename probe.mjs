import {makeSession} from './runtime.mjs';
import fs from 'node:fs';
const evidence={version:'1.3.0',events:[],streamed:0};
const s=await makeSession('proof');
s.subscribe(e=>{if(e.type==='message_update'&&e.assistantMessageEvent.type==='text_delta')evidence.streamed++;if(['tool_execution_start','tool_execution_end','message_end'].includes(e.type))evidence.events.push(e);});
try{
let steered=false;
s.subscribe(e=>{if(e.type==='tool_execution_start'&&!steered){steered=true;s.steer('Correction: End your final answer with STEERING_CONFIRMED.');evidence.steeringQueued=true;}});
await s.prompt('Use web_search to search for Pi coding agent earendil works SDK. Read a result with read_page. Write a short cited summary to proof.txt using write, then use powershell to check that file exists. Report actual failures if any.');
evidence.answer=s.getLastAssistantText(); evidence.sessionFile=s.sessionFile;
const run=s.prompt('Use powershell to run Start-Sleep -Seconds 30 then say finished.');
await new Promise(resolve=>{const unsub=s.subscribe(e=>{if(e.type==='tool_execution_start'){unsub();resolve();}});setTimeout(resolve,15000);});
await s.abort();await run;evidence.cancelled=true;
} catch(e){evidence.error=e.message;}finally{s.dispose();fs.writeFileSync('pi-proof.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify({streamed:evidence.streamed,steering:evidence.steeringQueued,cancelled:evidence.cancelled,answer:evidence.answer,error:evidence.error}));}
