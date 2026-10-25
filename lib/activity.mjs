// A short, live account of what a running worker is doing, for the "Working…" line. Not persisted.
export const oneLine=(v,max)=>{const s=String(v??'').replace(/\s+/g,' ').trim();return s.length>max?s.slice(0,max)+'…':s;};
const textOf=r=>typeof r==='string'?r:(r?.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
const lastLine=r=>oneLine(textOf(r).trim().split('\n').filter(l=>l.trim()).at(-1),140);
function describeCall(args={}){
 const main=args.command??args.path??args.file??args.query??args.url??args.pattern??Object.values(args).find(v=>typeof v==='string');
 return oneLine(main,160);
}
export function newActivity(){const now=Date.now();return {startedAt:now,lastAt:now,phase:'waiting',thinking:'',steps:[]};}
export function track(a,e){
 a.lastAt=Date.now();
 if(e.type==='message_update'){
  const m=e.assistantMessageEvent;
  if(m.type==='thinking_delta'){a.phase='thinking';a.thinking=(a.thinking+m.delta).slice(-280);}
  else if(m.type==='text_delta')a.phase='writing';
  else if(m.type==='toolcall_start'||m.type==='toolcall_delta')a.phase='preparing';
 }
 else if(e.type==='message_start'&&e.message?.role==='assistant'){a.phase='waiting';a.thinking='';}
 else if(e.type==='tool_execution_start'){a.phase='tool';a.steps=[...a.steps,{id:e.toolCallId,tool:e.toolName,detail:describeCall(e.args),state:'running',at:Date.now()}].slice(-6);}
 else if(e.type==='tool_execution_update'){const st=a.steps.find(x=>x.id===e.toolCallId);if(st)st.output=lastLine(e.partialResult);}
 else if(e.type==='tool_execution_end'){const st=a.steps.find(x=>x.id===e.toolCallId);if(st){st.state=e.isError?'failed':'ok';st.output=lastLine(e.result);st.ms=Date.now()-st.at;}a.phase='waiting';}
 else if(e.type==='compaction_start')a.phase='compacting';
 else if(e.type==='auto_retry_start')a.phase='retrying';
}

