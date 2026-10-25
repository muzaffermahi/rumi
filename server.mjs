import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {appDir,makeSession,root,taskDir,listModels,resolveModel,fallbackModel,piDefaultModel} from './runtime.mjs';
import {SEARCH_MIN,buildResearchCheck,buildDelegation,buildContextUpdate,buildPassageUpdate,documentBackground,contextBudget,titleFrom,parseUserPrompt,defaultInstruction,DOCUMENT_FILE} from './lib/context.mjs';
import {toConversation,readSessionEntries,legacyConversation} from './lib/conversation.mjs';
import {nextToStart,throttle} from './lib/queue.mjs';
import {htmlToText} from './lib/text.mjs';
import {newActivity,track} from './lib/activity.mjs';
import {describeFolder,remember,pickFolder,canPick} from './lib/folders.mjs';
import {GLOBAL,openStore,workspaceId,projectDataDir} from './lib/store.mjs';

const port=Number(process.env.RUMI_PORT||4317);
const app=express();
app.use((req,res,next)=>{if(req.headers.host!==`127.0.0.1:${port}`&&req.headers.host!==`localhost:${port}`)return res.sendStatus(403);if(req.headers.origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin))return res.sendStatus(403);next();});
app.use(express.json({limit:'8mb'}));

// --- storage ---
// The global workspace is the original data/ folder (v1/v2 data stays where it was). Settings live there too.
const globalStore=openStore(root);
if(!globalStore.fresh&&!globalStore.get('meta')){const dir=path.join(root,'backups');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,`rumi-v1-${Date.now()}.sqlite`);globalStore.db.exec(`VACUUM INTO '${file.replace(/'/g,"''")}'`);console.log('Backed up v1 data to',file);}
globalStore.put('meta',{version:3});
const settings={recentFolders:[],defaultModel:fallbackModel,maxWorkers:Number(process.env.RUMI_MAX_WORKERS||2),...globalStore.get('settings')};
const saveSettings=()=>globalStore.put('settings',settings);

// A workspace is the global one or a project folder; each has its own document and tasks.
const workspaces=new Map(), wsOfTask=new Map();
const transient=['live','liveOpen','activeTool','steering','activity','timedOut'];
function loadWorkspace(id,folder){
 if(workspaces.has(id))return workspaces.get(id);
 const store=folder?openStore(projectDataDir(folder),{project:true}):globalStore;
 const info=folder?describeFolder(folder):null;
 const document=store.get('document')||{html:'',text:'',revision:0};
 document.text??=htmlToText(document.html);
 const ws={id,folder:folder||null,name:info?.name||'Global',isRepo:!!info?.isRepo,store,document,tasks:store.get('tasks')||[]};
 ws.persist=throttle(()=>store.put('tasks',ws.tasks.map(t=>Object.fromEntries(Object.entries(t).filter(([k])=>!transient.includes(k))))),2000);
 for(const t of ws.tasks){migrate(t,store);wsOfTask.set(t.id,ws);}
 store.put('tasks',ws.tasks);
 workspaces.set(id,ws);
 return ws;
}
function migrate(t,store){
 // v1 → v2: additive only. v1 fields (objective, source, context, log, updates, result, history) are kept.
 t.title??=titleFrom(t.context?.instruction||t.source||t.objective);
 t.pending??=[];
 t.started??=!!t.sessionFile;
 t.model??=modelFromSession(t.sessionFile)||fallbackModel;
 t.files??=[];
 if(!store.get(`context:${t.id}`)&&t.context?.background)store.put(`context:${t.id}`,{supplied:[{at:t.created,kind:'delegation',revision:t.context.documentRevision,shortened:true,text:t.context.background,note:'v1 sent the first 6,000 characters of the document.'}]});
 if(['running','queued'].includes(t.status)){t.status='interrupted';t.error='Rumi restarted. Send a message or resume to continue.';}
 for(const k of transient)delete t[k];
}
function modelFromSession(file){try{for(const line of fs.readFileSync(file,'utf8').split('\n')){const e=JSON.parse(line);if(e.type==='model_change')return `${e.provider}/${e.modelId}`;}}catch{}return null;}
loadWorkspace(GLOBAL,null);

const wsInfo=ws=>({id:ws.id,name:ws.name,path:ws.folder,isRepo:ws.isRepo});
const workspaceList=()=>[{id:GLOBAL,name:'Global',path:null,isRepo:false},...(settings.recentFolders||[]).map(f=>({id:workspaceId(f.path),name:f.name,path:f.path,isRepo:f.isRepo}))];
function workspaceById(id){
 if(workspaces.has(id))return workspaces.get(id);
 const f=(settings.recentFolders||[]).find(f=>workspaceId(f.path)===id);
 return f&&describeFolder(f.path).exists?loadWorkspace(id,f.path):null;
}
const allTasks=()=>[...workspaces.values()].flatMap(w=>w.tasks);
const outDir=t=>t.outputDir||taskDir(t.id);
const contextOf=t=>wsOfTask.get(t.id).store.get(`context:${t.id}`)||{supplied:[]};
const saveContext=(t,ctx)=>wsOfTask.get(t.id).store.put(`context:${t.id}`,ctx);

// --- live updates to the browser, batched; each page follows one workspace ---
const clients=new Set();
function summary(t){
 const queued=[];
 if(!t.started)queued.push({kind:'delegation',text:t.objective,passage:t.source});
 for(const p of t.pending)queued.push(parseUserPrompt(p));
 for(const p of t.steering||[])queued.push(parseUserPrompt(p));
 return {id:t.id,title:t.title,status:t.status,model:t.model,created:t.created,files:t.files,error:t.error,projectDir:t.projectDir,documentWide:!t.source,passage:t.source||'',
  suggestion:t.suggestion?.state==='pending'&&t.result?{text:t.result,at:t.suggestion.at}:null,
  version:t.version||0,live:t.liveOpen?t.live:'',activeTool:t.activeTool||null,activity:t.status==='running'?t.activity||null:null,queued,pendingContext:!!t.pendingContext,started:t.started};
}
const snapshot=ws=>({workspace:wsInfo(ws),workspaces:workspaceList(),tasks:ws.tasks.map(summary),settings,running:allTasks().filter(t=>t.status==='running').length});
const broadcast=throttle(()=>{const cache=new Map();for(const c of clients){if(!cache.has(c.ws))cache.set(c.ws,`data: ${JSON.stringify(snapshot(c.ws))}\n\n`);c.res.write(cache.get(c.ws));}},150);
function touch(t){if(t){t.updated=new Date().toISOString();wsOfTask.get(t.id)?.persist();}broadcast();}
const flush=t=>wsOfTask.get(t.id)?.persist.flush();

// --- workers ---
const sessions=new Map();
const budgets=new Map(); // per-task search budget, reset for every user message

function bind(t,s){
 s.subscribe(e=>{
  track(t.activity||=newActivity(),e);
  if(e.type==='message_start'&&e.message?.role==='assistant'){t.live='';t.liveOpen=true;}
  else if(e.type==='message_update'&&e.assistantMessageEvent.type==='text_delta')t.live=(t.live||'')+e.assistantMessageEvent.delta;
  else if(e.type==='message_end'){t.liveOpen=false;t.version=(t.version||0)+1;}
  else if(e.type==='queue_update')t.steering=[...e.steering,...e.followUp];
  else if(e.type==='tool_execution_start')t.activeTool=e.toolName;
  else if(e.type==='tool_execution_end')t.activeTool=null;
  else if(e.type==='compaction_end')t.version=(t.version||0)+1;
  touch(t);
 });
}

async function run(t){
 t.status='running';t.error=null;t.activity=newActivity();touch(t);flush(t);
 try{
  let s=sessions.get(t.id);
  if(!budgets.has(t.id))budgets.set(t.id,{used:0,queries:new Set()});
  const budget=budgets.get(t.id);
  if(!s){s=await makeSession(t.id,t.sessionFile,t.model,budget,t.projectDir,{outDir:outDir(t),sessionsDir:wsOfTask.get(t.id).store.sessionsDir});sessions.set(t.id,s);t.sessionFile=s.sessionFile;bind(t,s);}
  let check='';
  while(t.status==='running'&&(!t.started||t.pending.length||check)){
   const parts=[],first=!t.started;
   if(first)parts.push(contextOf(t).initial);
   if(check){parts.push(check);check='';}           // Rumi's own nudge keeps the same search budget
   else{budget.used=0;budget.queries.clear();}     // every user message gets a fresh budget
   parts.push(...t.pending);t.pending=[];t.started=true;touch(t);
   // No time limit: a run lasts until it finishes or the user presses Stop.
   await s.prompt(parts.filter(Boolean).join('\n\n'));
   const ok=t.status==='running'&&s.messages.filter(x=>x.role==='assistant').at(-1)?.stopReason!=='error';
   if(first&&t.research&&ok&&budget.used<SEARCH_MIN)check=buildResearchCheck(budget.used);
  }
  if(t.status==='running'){
   const last=s.messages.filter(x=>x.role==='assistant').at(-1);
   t.result=s.getLastAssistantText()||t.result;
   t.status=last?.stopReason==='error'?'failed':'finished';
   t.error=last?.errorMessage||null;
   // A finished task linked to a passage offers its answer there, to accept or dismiss.
   if(t.status==='finished'&&t.source&&t.result)t.suggestion={state:'pending',at:Date.now()};
  }
 }catch(e){if(t.status!=='cancelled'){t.status='failed';t.error=e.message;}}
 finally{
  t.liveOpen=false;t.activeTool=null;t.activity=null;t.steering=[];t.version=(t.version||0)+1;
  t.files=listFiles(t);touch(t);flush(t);pump();
 }
}
function listFiles(t){try{const dir=outDir(t);return fs.readdirSync(dir).filter(n=>n!==DOCUMENT_FILE&&fs.statSync(path.join(dir,n)).isFile());}catch{return [];}}
function pump(){for(const t of nextToStart(allTasks(),settings.maxWorkers,{sameFolder:!!settings.sameFolder}))void run(t);}
function enqueue(t){if(t.status!=='queued'){t.status='queued';t.queuedAt=new Date().toISOString();}touch(t);pump();}
// Delivers a message: steered into a running task, otherwise continues its session.
async function deliver(t,message){
 const s=sessions.get(t.id);
 if(t.status==='running'&&s?.isStreaming)await s.steer(message);
 else{t.pending.push(message);if(t.status!=='running')enqueue(t);}
}

// Builds the document background for a task from its workspace's document and records what was supplied.
function supplyContext(t,{offset,kind}){
 const doc=wsOfTask.get(t.id).document;
 const bg=documentBackground(doc.text,{passage:t.source||'',offset,budget:contextBudget(resolveModel(t.model))});
 fs.mkdirSync(outDir(t),{recursive:true});
 if(bg.shortened)fs.writeFileSync(path.join(outDir(t),DOCUMENT_FILE),doc.text);
 const ctx=contextOf(t);
 ctx.supplied.push({at:new Date().toISOString(),kind,revision:doc.revision,shortened:bg.shortened,length:bg.length,text:bg.text});
 return {bg,ctx};
}

// --- API: workspaces ---
const wsParam=(q,r)=>{const ws=workspaceById(q.params.wid);if(!ws)r.status(404).json({error:'That workspace is no longer available.'});return ws;};
app.get('/api/workspaces',(q,r)=>r.json(workspaceList()));
// Opening a folder (from the switcher or the `rumi` command) creates <folder>/.rumi on first use.
app.post('/api/workspaces/open',(q,r)=>{
 const f=describeFolder(q.body?.path);if(!f.exists)return r.status(400).json({error:`Folder not found: ${f.path}`});
 let ws;try{ws=loadWorkspace(workspaceId(f.path),f.path);}catch(e){return r.status(500).json({error:`Could not open ${f.path}: ${e.message}`});}
 settings.recentFolders=remember(settings.recentFolders,f);saveSettings();broadcast();
 r.json({workspace:wsInfo(ws)});
});
app.get('/api/w/:wid/document',(q,r)=>{const ws=wsParam(q,r);if(ws)r.json(ws.document);});
app.put('/api/w/:wid/document',(q,r)=>{
 const ws=wsParam(q,r);if(!ws)return;
 const {html,text}=q.body;if(typeof html!=='string')return r.sendStatus(400);
 ws.document={html,text:typeof text==='string'?text:htmlToText(html),revision:ws.document.revision+1};ws.store.put('document',ws.document);
 r.json({revision:ws.document.revision});
});
app.get('/api/events',(q,r)=>{
 const ws=workspaceById(q.query.w||GLOBAL)||workspaces.get(GLOBAL);
 r.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});r.flushHeaders();
 const c={res:r,ws};clients.add(c);r.write(`data: ${JSON.stringify(snapshot(ws))}\n\n`);
 const timer=setInterval(()=>r.write(': heartbeat\n\n'),15000);q.on('close',()=>{clearInterval(timer);clients.delete(c);});
});
app.get('/api/models',async(q,r)=>r.json({models:await listModels(),piDefault:piDefaultModel}));

// Folders: the system picker (Windows), a path check for typed paths, and forgetting a recent one.
let picking=false;
app.post('/api/folders/pick',async(q,r)=>{
 if(picking)return r.status(409).json({error:'A folder picker is already open on your screen.'});
 picking=true;
 try{const chosen=await pickFolder(q.body?.start);r.json(chosen?{folder:describeFolder(chosen)}:{cancelled:true});}
 catch(e){r.status(canPick?500:501).json({error:e.message});}
 finally{picking=false;}
});
app.post('/api/folders/check',(q,r)=>{const f=describeFolder(q.body?.path);if(!f.exists)return r.status(400).json({error:`Folder not found: ${f.path}`});r.json({folder:f});});
app.post('/api/folders/forget',(q,r)=>{settings.recentFolders=(settings.recentFolders||[]).filter(f=>f.path!==q.body?.path);saveSettings();broadcast();r.json(settings);});
// `rumi stop`. The custom header can't be sent cross-origin without a preflight, which the origin check refuses.
app.post('/api/shutdown',(q,r)=>{if(q.get('X-Rumi-CLI')!=='1')return r.sendStatus(403);r.json({ok:true});for(const ws of workspaces.values())ws.persist.flush();setTimeout(()=>process.exit(0),100);});
app.put('/api/settings',(q,r)=>{
 const {defaultModel,maxWorkers,sameFolder}=q.body;
 if(sameFolder!==undefined)settings.sameFolder=!!sameFolder;
 if(defaultModel!==undefined){try{resolveModel(defaultModel);}catch(e){return r.status(400).json({error:e.message});}settings.defaultModel=defaultModel;}
 if(maxWorkers!==undefined){const n=Number(maxWorkers);if(![1,2].includes(n))return r.status(400).json({error:'Concurrent tasks must be 1 or 2.'});settings.maxWorkers=n;}
 saveSettings();broadcast();pump();r.json(settings);
});

// --- API: tasks ---
app.post('/api/w/:wid/tasks',(q,r)=>{
 const ws=wsParam(q,r);if(!ws)return;
 const {selection,offset,instruction,model,research=true}=q.body;
 const passage=selection?.trim()?selection:'';
 const modelRef=model||settings.defaultModel;
 try{resolveModel(modelRef);}catch(e){return r.status(400).json({error:e.message});}
 const objective=instruction?.trim()||defaultInstruction(passage);
 const id=randomUUID();
 const t={id,title:titleFrom(instruction?.trim()||passage||'Whole document'),objective,source:passage,model:modelRef,projectDir:ws.folder||undefined,outputDir:ws.store.outputDir(id),research:!!research,status:'queued',pending:[],started:false,files:[],log:[],updates:[],created:new Date().toISOString(),version:0};
 wsOfTask.set(id,ws);
 const {bg,ctx}=supplyContext(t,{offset,kind:'delegation'});
 ctx.initial=buildDelegation({instruction:objective,passage,background:bg,projectDir:t.projectDir,outputDir:outDir(t),research:t.research});
 saveContext(t,ctx);
 t.queuedAt=t.created;ws.tasks.unshift(t);touch(t);flush(t);pump();
 r.json(summary(t));
});

const find=(q,r)=>{const t=allTasks().find(t=>t.id===q.params.id);if(!t)r.sendStatus(404);return t;};
app.get('/api/tasks/:id',(q,r)=>{
 const t=find(q,r);if(!t)return;
 let items;
 try{const entries=readSessionEntries(t.sessionFile,sessions.get(t.id));items=entries?toConversation(entries):t.started?legacyConversation(t):[];}
 catch(e){items=legacyConversation(t);items.unshift({role:'note',text:`Pi session could not be read: ${e.message}`});}
 r.json({id:t.id,version:t.version||0,objective:t.objective,source:t.source,items,contexts:contextOf(t).supplied});
});

app.post('/api/tasks/:id/messages',async(q,r)=>{
 const t=find(q,r);if(!t)return;
 const text=q.body.text?.trim();if(!text)return r.sendStatus(400);
 try{resolveModel(t.model);}catch(e){return r.status(400).json({error:`${e.message} This task stays on its original model.`});}
 const message=t.pendingContext?buildContextUpdate(t.pendingContext,text):text;t.pendingContext=null;
 await deliver(t,message);touch(t);r.json(summary(t));
});

// Sends the current document as fresh background. Mid-run it is steered in; otherwise it travels with the next message.
app.post('/api/tasks/:id/context',async(q,r)=>{
 const t=find(q,r);if(!t)return;
 let bg,ctx;try{({bg,ctx}=supplyContext(t,{kind:'update'}));}catch(e){return r.status(400).json({error:e.message});}
 saveContext(t,ctx);
 const s=sessions.get(t.id);
 if(t.status==='running'&&s?.isStreaming){await s.steer(buildContextUpdate(bg));t.pendingContext=null;}
 else t.pendingContext=bg;
 touch(t);r.json(summary(t));
});

// The linked passage was edited in the document and the user chose to send the new version.
app.post('/api/tasks/:id/passage',async(q,r)=>{
 const t=find(q,r);if(!t)return;
 const text=q.body.text?.trim();if(!text)return r.sendStatus(400);
 try{resolveModel(t.model);}catch(e){return r.status(400).json({error:`${e.message} This task stays on its original model.`});}
 t.source=text;t.suggestion=null;
 await deliver(t,buildPassageUpdate(text));touch(t);flush(t);r.json(summary(t));
});

// Accept or dismiss the answer offered at the passage.
app.post('/api/tasks/:id/suggestion',(q,r)=>{
 const t=find(q,r);if(!t)return;
 if(!['accepted','dismissed'].includes(q.body.state))return r.sendStatus(400);
 if(t.suggestion)t.suggestion.state=q.body.state;
 touch(t);flush(t);r.json(summary(t));
});

app.post('/api/tasks/:id/stop',async(q,r)=>{
 const t=find(q,r);if(!t)return;
 const was=t.status;t.status='cancelled';t.pending=[];t.pendingContext=null;touch(t);
 const s=sessions.get(t.id);
 if(s){s.clearQueue();if(was==='running')await s.abort();}
 t.error=was==='running'?'Stopped. Pi aborted the run; detached processes cannot be guaranteed stopped.':null;
 touch(t);flush(t);r.json(summary(t));
});

app.post('/api/tasks/:id/resume',(q,r)=>{const t=find(q,r);if(!t)return;if(t.status==='running')return r.json(summary(t));if(t.started&&!t.pending.length)t.pending.push('Continue where you left off.');enqueue(t);r.json(summary(t));});

const textTypes=new Set(['.md','.txt','.csv','.json','.html','.log','.yaml','.yml','.xml']);
app.get('/api/tasks/:id/files/:name',(q,r)=>{
 const t=allTasks().find(t=>t.id===q.params.id),name=q.params.name;
 if(!t||path.basename(name)!==name||!listFiles(t).includes(name))return r.sendStatus(404);
 const file=path.join(outDir(t),name);
 if(q.query.view!==undefined&&textTypes.has(path.extname(name).toLowerCase())){r.type('text/plain; charset=utf-8');r.set('Content-Security-Policy',"default-src 'none'");return r.sendFile(file);}
 r.download(file);
});

app.use(express.static(path.join(appDir,'dist')));
app.use((err,q,r,next)=>{console.error(err.message);r.status(500).json({error:err.message});});
await listModels();
pump();
const server=app.listen(port,'127.0.0.1',()=>console.log(`Rumi http://127.0.0.1:${port}`));
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{for(const ws of workspaces.values())ws.persist.flush();server.close();process.exit(0);});
