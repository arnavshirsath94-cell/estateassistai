const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'estateassist.json');
const AGENCY_DB_FILE = path.join(DATA_DIR, 'agency.json');
const PORT = Number(process.env.PORT || 4174);
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8' };
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ leads: [], handoffs: [] }, null, 2));

function makeOutreachDraft(prospect, kind='initial') {
  const evidence = String(prospect.publicEvidence || '').replace(/\s+/g,' ').trim();
  const observation = evidence ? evidence.split(/[;.]/)[0].replace(/^Public contact page /i,'your public contact page ').replace(/^The official contact page /i,'your official contact page ').replace(/^The public website /i,'your public website ') : 'your public website and public enquiry information';
  const rawSolution = String(prospect.potentialSolution || 'a consent-aware assistant using your approved information').split('.')[0];
  const solution = rawSolution.charAt(0).toLowerCase()+rawSolution.slice(1);
  const followup = kind === 'follow-up';
  return {
    id: crypto.randomUUID(), prospectId: prospect.id, kind, status:'pending_approval',
    subject: followup ? `Following up: a first-response demo for ${prospect.businessName}` : `A property enquiry assistant idea for ${prospect.businessName}`,
    body: followup
      ? `Hello ${prospect.businessName} team,\n\nI wanted to follow up once on my note about your public ${String(prospect.category||'property enquiry')} workflow. If enquiry routing or approved-FAQ responses are a current priority, I can show a short local demo based on the public workflow I mentioned. This is only a suggestion; I do not know whether it addresses a current need.\n\nIf it is not relevant, no reply is needed and I will close the follow-up.\n\nRegards,\n[Your name]`
      : `Hello ${prospect.businessName} team,\n\nI noticed ${observation}. One possible use case to explore—not a claim that anything is broken—is ${solution}. It could answer only from information your team approves and route questions about current listings, prices, or anything uncertain to a person.\n\nWould a short, no-obligation demo around this workflow be useful? I can adapt the demo to your process; nothing is connected or deployed.\n\nRegards,\n[Your name]`,
    createdAt:new Date().toISOString(), approvedAt:null, markedSentAt:null
  };
}

function readAgencyDb() {
  return JSON.parse(fs.readFileSync(AGENCY_DB_FILE,'utf8'));
}
function atomicWrite(file,value) { const tmp=file+'.'+process.pid+'.tmp'; fs.writeFileSync(tmp,value); try { fs.renameSync(tmp,file); } catch(e) { if(!['EPERM','EEXIST','ENOTEMPTY'].includes(e.code)) throw e; fs.copyFileSync(tmp,file); fs.unlinkSync(tmp); } }
function writeAgencyDb(db) { atomicWrite(AGENCY_DB_FILE,JSON.stringify(db,null,2)); }
function logAgency(db, action, label, entityId='', details='') { db.activities.unshift({id:crypto.randomUUID(),action,label,entityId,details:String(details||'').slice(0,500),createdAt:new Date().toISOString()}); db.activities=db.activities.slice(0,500); }
function findProspect(db,id) { return db.prospects.find(p=>p.id===id); }
if (!fs.existsSync(AGENCY_DB_FILE)) {
  const seed=JSON.parse(fs.readFileSync(path.join(ROOT,'agency-seed.json'),'utf8'));
  const db={version:1,prospects:seed.prospects,drafts:[],clients:[],finances:[],activities:[]};
  for (const p of db.prospects) { db.drafts.push(makeOutreachDraft(p)); logAgency(db,'research','Public research recorded',p.id,p.sourceUrl); logAgency(db,'draft','Outreach draft created for approval',p.id); }
  writeAgencyDb(db);
}

function readDb() { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
function writeDb(db) { atomicWrite(DB_FILE,JSON.stringify(db,null,2)); }
function send(res, status, body, type='application/json; charset=utf-8') { res.writeHead(status, { 'content-type': type, 'cache-control':'no-store', 'x-content-type-options':'nosniff', 'x-frame-options':'DENY', 'referrer-policy':'strict-origin-when-cross-origin', 'permissions-policy':'camera=(), microphone=(), geolocation=()' }); res.end(type.startsWith('application/json') ? JSON.stringify(body) : body); }
function readBody(req) { return new Promise((resolve, reject) => { let data=''; req.on('data', chunk => { data += chunk; if (data.length > 2000000) { reject(new Error('Request too large (2 MB limit)')); req.destroy(); } }); req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('Invalid JSON')); } }); req.on('error', reject); }); }
function validContact(value) { const v=String(value||'').trim(); return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) || /^\+?[\d\s().-]{7,20}$/.test(v) && v.replace(/\D/g,'').length >= 7 && v.replace(/\D/g,'').length <= 15; }
function containsCredential(value) { return /\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|Bearer\s+\S+|(?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*\S+)/i.test(String(value||'')); }
const kb = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge-base.json'), 'utf8'));
function matchFaq(q) { const text=q.toLowerCase(); return kb.faqs.find(f => f.keywords.some(k => text.includes(k))) || null; }
async function answer(message, context={}) {
  const risky = /\b(available|availability|vacant|listing|price|pricing|rent for|cost of|on sale|for sale)\b/i.test(message);
  if (risky) return { text:'This fictional demo contains no live listings, availability or approved property prices. I cannot confirm those details. I can place this question in the human follow-up queue.', mode:process.env.OPENAI_API_KEY?'ai-guarded':'demo', handoff:true };
  const faq=matchFaq(message);
  if (!faq) return { text:'I do not have an approved answer for that, and I will not guess. I can place this question in the human follow-up queue. This demo uses fictional data only.', mode:'demo', handoff:true };
  if (process.env.OPENAI_API_KEY) {
    try {
      const response=await fetch(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions', { method:'POST', signal:AbortSignal.timeout(10000), headers:{'authorization':`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'}, body:JSON.stringify({ model:process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature:0, messages:[{role:'system',content:`You are EstateAssist AI. The only approved information for this turn is the exact answer below. Return it verbatim. Do not add, infer or embellish any facts. This is fictional demo data.\nAPPROVED ANSWER: ${faq.answer}\nCONTEXT: ${JSON.stringify(context)}`},{role:'user',content:String(message).slice(0,2000)}] }) });
      if (!response.ok) throw new Error('AI provider error');
      const data=await response.json();
      const proposed=String(data.choices?.[0]?.message?.content || '').trim();
      if (proposed !== faq.answer) return { text:faq.answer, mode:'ai-verified-fallback', handoff:false };
      return { text:proposed, mode:'ai', handoff:false };
    } catch { /* deterministic mode is a safe fallback when credentials/provider are unavailable */ }
  }
  return { text:faq.answer, mode:'demo', handoff:false };
}

const server=http.createServer(async (req,res)=>{
  const url=new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method==='GET' && url.pathname==='/api/agency') {
      const db=readAgencyDb();
      const real=db.prospects.filter(p=>p.recordType!=='demo');
      const collected=db.finances.filter(x=>x.kind==='collected').reduce((n,x)=>n+x.amount,0);
      const projected=db.finances.filter(x=>x.kind==='projected').reduce((n,x)=>n+x.amount,0);
      const expenses=db.finances.filter(x=>x.kind==='expense').reduce((n,x)=>n+x.amount,0);
      const total=(kind,category)=>db.finances.filter(x=>x.kind===kind&&x.category===category).reduce((n,x)=>n+x.amount,0);
      const thisMonth=new Date().toISOString().slice(0,7);
      const followUps=real.filter(p=>p.status==='contacted' && p.followUpDueAt).map(p=>({...p,overdue:new Date(p.followUpDueAt)<new Date()})).sort((a,b)=>a.followUpDueAt.localeCompare(b.followUpDueAt));
      return send(res,200,{...db,followUps,metrics:{totalRealProspects:real.length,prospectsResearched:real.filter(p=>p.researchDate).length,draftsAwaitingApproval:db.drafts.filter(d=>d.status==='pending_approval').length,messagesApproved:db.drafts.filter(d=>Boolean(d.approvedAt)).length,responsesReceived:real.filter(p=>p.responseReceivedAt).length,demosScheduled:real.filter(p=>p.demoAt).length,activeClients:db.clients.filter(c=>c.status==='active').length,collectedRevenue:collected,projectedRevenue:projected,collectedSetupFees:total('collected','setup_fee'),collectedMonthlyRevenue:total('collected','monthly_revenue'),collectedThisMonth:db.finances.filter(x=>x.kind==='collected'&&x.recordDate?.slice(0,7)===thisMonth).reduce((n,x)=>n+x.amount,0),projectedSetupFees:total('projected','setup_fee'),projectedMonthlyRevenue:total('projected','monthly_revenue'),expenses,profit:collected-expenses}});
    }
    if (req.method==='POST' && url.pathname==='/api/agency/prospects') {
      const b=await readBody(req); const name=String(b.businessName||'').trim(); const source=String(b.sourceUrl||'').trim();
      if(name.length<2 || !/^https?:\/\//i.test(source) || !String(b.publicEvidence||'').trim() || !String(b.potentialSolution||'').trim() || !String(b.publicContact||b.contactUrl||b.email||'').trim()) return send(res,400,{error:'Business name, public source URL, public contact, observed evidence, and an opportunity hypothesis/solution are required.'});
      const db=readAgencyDb(); if(db.prospects.some(p=>p.website.toLowerCase()===String(b.website||source).toLowerCase() || p.businessName.toLowerCase()===name.toLowerCase())) return send(res,409,{error:'That prospect already exists.'});
      const p={id:crypto.randomUUID(),businessName:name,website:String(b.website||source).trim(),publicContact:String(b.publicContact||'').trim(),contactUrl:String(b.contactUrl||'').trim(),sourceUrl:source,category:String(b.category||'').trim(),publicEvidence:String(b.publicEvidence||'').trim(),identifiedProblem:String(b.identifiedProblem||'No operational problem publicly disclosed; validate any opportunity as a hypothesis.').trim(),potentialSolution:String(b.potentialSolution||'').trim(),fitScore:Math.max(0,Math.min(100,Number(b.fitScore)||0)),fitExplanation:String(b.fitExplanation||'Score is an unvalidated fit hypothesis based on public evidence.').trim(),status:'researched',nextAction:'Review research and decide whether to draft outreach.',researchDate:String(b.researchDate||new Date().toISOString().slice(0,10)),notes:String(b.notes||'').trim(),recordType:'real',email:String(b.email||'').trim()};
      db.prospects.unshift(p); logAgency(db,'research','Prospect researched',p.id,p.sourceUrl); if(p.potentialSolution){db.drafts.unshift(makeOutreachDraft(p));logAgency(db,'draft','Outreach draft created for approval',p.id);} writeAgencyDb(db); return send(res,201,p);
    }
    if (req.method==='POST' && url.pathname==='/api/agency/import') {
      const b=await readBody(req); if(!Array.isArray(b.rows)||b.rows.length>500) return send(res,400,{error:'Provide up to 500 CSV rows.'});
      const db=readAgencyDb(), imported=[], errors=[];
      for(let i=0;i<b.rows.length;i++){const r=b.rows[i]; const name=String(r.businessName||r.business_name||'').trim(), source=String(r.sourceUrl||r.source_url||'').trim(),evidence=String(r.publicEvidence||r.public_evidence||'').trim(),contact=String(r.publicContact||r.public_contact||r.contactUrl||r.contact_url||r.email||'').trim(); if(name.length<2||!/^https?:\/\//i.test(source)||!evidence||!contact){errors.push({row:i+1,error:'Business name, http(s) source_url, public_evidence, and a public email/contact page are required'});continue;} if(db.prospects.some(p=>p.businessName.toLowerCase()===name.toLowerCase()||p.website.toLowerCase()===String(r.website||source).toLowerCase())){errors.push({row:i+1,error:'Duplicate prospect skipped'});continue;} const p={id:crypto.randomUUID(),businessName:name,website:String(r.website||source).trim(),publicContact:String(r.publicContact||r.public_contact||'').trim(),contactUrl:String(r.contactUrl||r.contact_url||'').trim(),sourceUrl:source,category:String(r.category||'').trim(),publicEvidence:evidence,identifiedProblem:String(r.identifiedProblem||r.identified_problem||'No operational problem publicly disclosed; validate any opportunity as a hypothesis.').trim(),potentialSolution:String(r.potentialSolution||r.potential_solution||'').trim(),fitScore:Math.max(0,Math.min(100,Number(r.fitScore||r.fit_score)||0)),fitExplanation:String(r.fitExplanation||r.fit_explanation||'Unvalidated fit hypothesis based on the supplied public evidence.').trim(),status:'researched',nextAction:'Review imported research and source.',researchDate:String(r.researchDate||r.research_date||new Date().toISOString().slice(0,10)),notes:String(r.notes||'').trim(),recordType:'real',email:String(r.email||'').trim()}; db.prospects.unshift(p); imported.push(p); logAgency(db,'import','Prospect imported from CSV',p.id,source);if(p.potentialSolution){db.drafts.unshift(makeOutreachDraft(p));logAgency(db,'draft','Outreach draft created from imported research',p.id);}}
      writeAgencyDb(db); return send(res,200,{imported:imported.length,errors,prospects:imported});
    }
    if (req.method==='POST' && url.pathname==='/api/agency/drafts') {
      const b=await readBody(req),db=readAgencyDb(),p=findProspect(db,String(b.prospectId||'')); if(!p) return send(res,404,{error:'Prospect not found.'});
      const kind=b.kind==='follow-up'?'follow-up':'initial'; if(kind==='follow-up' && (Number(p.touchCount||0)>=2 || p.status!=='contacted')) return send(res,409,{error:'Follow-ups require a manually marked sent message and are limited to two.'});
      if(kind==='initial'&&db.drafts.some(d=>d.prospectId===p.id&&d.kind==='initial'))return send(res,409,{error:'An initial outreach draft already exists for this prospect.'});
      if(db.drafts.some(d=>d.prospectId===p.id&&d.kind===kind&&['pending_approval','approved'].includes(d.status))) return send(res,409,{error:'An open draft already exists for this prospect and message type.'});
      const draft=makeOutreachDraft(p,kind); db.drafts.unshift(draft); p.nextAction='Review outreach draft for approval.'; logAgency(db,'draft',kind==='follow-up'?'Follow-up draft created':'Outreach draft created',p.id); writeAgencyDb(db); return send(res,201,draft);
    }
    let m=url.pathname.match(/^\/api\/agency\/drafts\/([^/]+)$/);
    if(req.method==='PATCH'&&m){const db=readAgencyDb(),d=db.drafts.find(x=>x.id===m[1]); if(!d)return send(res,404,{error:'Draft not found.'}); if(d.status!=='pending_approval')return send(res,409,{error:'Only unapproved drafts can be edited.'}); const b=await readBody(req); if(typeof b.subject==='string')d.subject=b.subject.slice(0,200); if(typeof b.body==='string')d.body=b.body.slice(0,8000); d.updatedAt=new Date().toISOString(); logAgency(db,'edit','Outreach draft edited',d.prospectId); writeAgencyDb(db); return send(res,200,d);}
    m=url.pathname.match(/^\/api\/agency\/drafts\/([^/]+)\/(approve|mark-sent)$/);
    if(req.method==='POST'&&m){const db=readAgencyDb(),d=db.drafts.find(x=>x.id===m[1]),action=m[2];if(!d)return send(res,404,{error:'Draft not found.'});const p=findProspect(db,d.prospectId);if(action==='approve'){if(d.status!=='pending_approval')return send(res,409,{error:'Draft is not awaiting approval.'});if(p?.responseReceivedAt)return send(res,409,{error:'This prospect has already responded; the draft is no longer appropriate.'});d.status='approved';d.approvedAt=new Date().toISOString();if(p)p.status='approved';logAgency(db,'approve','Draft approved; no message was sent',d.prospectId);}else{if(d.status!=='approved')return send(res,409,{error:'Only an approved draft can be marked as manually sent.'});if(p?.responseReceivedAt)return send(res,409,{error:'This prospect has already responded; do not send this draft.'});d.status='sent';d.markedSentAt=new Date().toISOString();if(p){p.status='contacted';p.lastContactAt=d.markedSentAt;p.touchCount=(p.touchCount||0)+1;p.followUpDueAt=new Date(Date.now()+7*86400000).toISOString();p.nextAction='Follow up manually if no reply; review follow-up draft first.';}logAgency(db,'mark-sent','User recorded that a message was sent manually; platform did not send it',d.prospectId);}writeAgencyDb(db);return send(res,200,d);}
    m=url.pathname.match(/^\/api\/agency\/prospects\/([^/]+)$/);
    if(req.method==='PATCH'&&m){const db=readAgencyDb(),p=findProspect(db,m[1]);if(!p)return send(res,404,{error:'Prospect not found.'});const b=await readBody(req);for(const key of ['businessName','website','publicContact','contactUrl','sourceUrl','category','publicEvidence','identifiedProblem','potentialSolution','fitExplanation','nextAction','notes','email'])if(typeof b[key]==='string')p[key]=b[key].slice(0,3000);if(b.fitScore!==undefined)p.fitScore=Math.max(0,Math.min(100,Number(b.fitScore)||0));if(typeof b.status==='string'&&['new','researched','draft_pending','approved','contacted','responded','demo_scheduled','client','not_fit'].includes(b.status))p.status=b.status;logAgency(db,'edit','Prospect record updated',p.id);writeAgencyDb(db);return send(res,200,p);}
    m=url.pathname.match(/^\/api\/agency\/prospects\/([^/]+)\/(response|demo|convert|follow-up)$/);
    if(req.method==='POST'&&m){const db=readAgencyDb(),p=findProspect(db,m[1]),action=m[2];if(!p)return send(res,404,{error:'Prospect not found.'});const b=await readBody(req);
      if(action==='response'){p.status='responded';p.responseReceivedAt=new Date().toISOString();p.responseNotes=String(b.notes||'').slice(0,2000);p.followUpDueAt=null;for(const draft of db.drafts.filter(d=>d.prospectId===p.id&&['pending_approval','approved'].includes(d.status)))draft.status='closed_response';p.nextAction='Review response and decide whether to schedule a demo.';logAgency(db,'response','Response recorded manually; open drafts closed',p.id,p.responseNotes);}
      if(action==='demo'){const date=String(b.demoAt||'');if(!date||Number.isNaN(Date.parse(date)))return send(res,400,{error:'Provide a valid demo date and time.'});p.status='demo_scheduled';p.demoAt=new Date(date).toISOString();p.nextAction='Hold the demo and record the actual outcome.';logAgency(db,'demo','Demo scheduled manually',p.id,p.demoAt);}
      if(action==='follow-up'){if(p.status!=='contacted'||!p.followUpDueAt)return send(res,409,{error:'Follow-up becomes available after a manual send is recorded.'});if(new Date(p.followUpDueAt)>new Date())return send(res,409,{error:'Follow-up is not due yet.'});if(Number(p.touchCount||0)>=2)return send(res,409,{error:'Follow-up limit reached (two messages maximum).'});if(db.drafts.some(d=>d.prospectId===p.id&&d.kind==='follow-up'&&['pending_approval','approved'].includes(d.status)))return send(res,409,{error:'An open follow-up draft already exists.'});const d=makeOutreachDraft(p,'follow-up');db.drafts.unshift(d);p.nextAction='Review follow-up draft; no message will be sent automatically.';logAgency(db,'follow-up','Follow-up draft created for approval',p.id);writeAgencyDb(db);return send(res,201,d);}
      if(action==='convert'){if(db.clients.some(c=>c.prospectId===p.id))return send(res,409,{error:'A client record already exists.'});const client={id:crypto.randomUUID(),prospectId:p.id,businessName:p.businessName,status:'onboarding',createdAt:new Date().toISOString(),profile:{website:p.website,category:p.category,serviceAreas:'',faqs:'',approvedPolicies:'',escalationContacts:'',notes:''},onboarding:{businessDetails:false,faqs:false,approvedPolicies:false,serviceAreas:false,escalationContacts:false,clientApproval:false},delivery:{configuration:'not-started',knowledgeBase:'not-started',testing:'not-started',approval:'not-started',deployment:'not-started',maintenance:'not-started'}};db.clients.unshift(client);p.status='client';p.followUpDueAt=null;p.nextAction='Complete client onboarding.';logAgency(db,'client','Client onboarding record created after manual confirmation',p.id);writeAgencyDb(db);return send(res,201,client);}
      writeAgencyDb(db);return send(res,200,p);
    }
    if(req.method==='POST'&&url.pathname==='/api/agency/clients'){const b=await readBody(req);const name=String(b.businessName||'').trim();if(name.length<2)return send(res,400,{error:'Client business name is required.'});const db=readAgencyDb();const client={id:crypto.randomUUID(),businessName:name,status:'onboarding',createdAt:new Date().toISOString(),profile:{website:String(b.website||'').trim(),category:String(b.category||'').trim(),serviceAreas:'',faqs:'',approvedPolicies:'',escalationContacts:'',notes:''},onboarding:{businessDetails:false,faqs:false,approvedPolicies:false,serviceAreas:false,escalationContacts:false,clientApproval:false},delivery:{configuration:'not-started',knowledgeBase:'not-started',testing:'not-started',approval:'not-started',deployment:'not-started',maintenance:'not-started'}};db.clients.unshift(client);logAgency(db,'client','Client onboarding record created manually',client.id);writeAgencyDb(db);return send(res,201,client);}
    m=url.pathname.match(/^\/api\/agency\/clients\/([^/]+)$/);
    if(req.method==='PATCH'&&m){const db=readAgencyDb(),c=db.clients.find(x=>x.id===m[1]);if(!c)return send(res,404,{error:'Client not found.'});const b=await readBody(req);if(b.profile&&typeof b.profile==='object')for(const k of ['website','category','serviceAreas','faqs','approvedPolicies','escalationContacts','notes'])if(typeof b.profile[k]==='string'){if(containsCredential(b.profile[k]))return send(res,400,{error:'Do not store API keys, passwords, access tokens, or other credentials in the client record.'});c.profile[k]=b.profile[k].slice(0,10000);}if(b.onboarding&&typeof b.onboarding==='object')for(const k of Object.keys(c.onboarding))if(typeof b.onboarding[k]==='boolean')c.onboarding[k]=b.onboarding[k];if(b.delivery&&typeof b.delivery==='object')for(const k of Object.keys(c.delivery))if(['not-started','in-progress','complete','blocked'].includes(b.delivery[k]))c.delivery[k]=b.delivery[k];if(['onboarding','active','paused','completed'].includes(b.status)){if(b.status==='active'&&(!Object.values(c.onboarding).every(Boolean)||c.delivery.approval!=='complete'||c.delivery.deployment!=='complete'))return send(res,409,{error:'Mark a client active only after all onboarding items, assistant approval, and deployment are complete.'});c.status=b.status;}c.updatedAt=new Date().toISOString();logAgency(db,'client-update','Client onboarding or delivery updated',c.id);writeAgencyDb(db);return send(res,200,c);}
    if(req.method==='POST'&&url.pathname==='/api/agency/finance'){const b=await readBody(req),kind=String(b.kind||''),amount=Number(b.amount),category=String(b.category||'');const categories=kind==='expense'?['expense']:['setup_fee','monthly_revenue','other_revenue'];if(!['collected','projected','expense'].includes(kind)||!categories.includes(category)||!Number.isFinite(amount)||amount<=0)return send(res,400,{error:'Choose a valid record type, revenue category, and amount above zero.'});const db=readAgencyDb();const row={id:crypto.randomUUID(),kind,category,amount:Math.round(amount*100)/100,currency:'INR',clientId:String(b.clientId||''),description:String(b.description||'').slice(0,300),recordDate:String(b.recordDate||new Date().toISOString().slice(0,10)),reference:String(b.reference||'').slice(0,100),createdAt:new Date().toISOString()};db.finances.unshift(row);logAgency(db,'finance',`${category} ${kind} amount recorded`,row.id,`${row.currency} ${row.amount}`);writeAgencyDb(db);return send(res,201,row);}
    if (req.method==='GET' && url.pathname==='/api/status') return send(res,200,{mode:process.env.OPENAI_API_KEY?'ai-adapter-configured-provider-unverified':'demo', fictionalData:true,providerVerified:false});
    if (url.pathname.startsWith('/api/payment-agent')) {
      if (req.method !== 'GET' || url.pathname !== '/api/payment-agent') return send(res,503,{error:'Payment processing is disabled. No payment provider, signed webhook verifier, invoice matcher, or compliant settlement integration is configured.'});
      const empty={payments:[],conversions:[],audit:[]};
      return send(res,200,{mode:'unavailable-demo',configuration:{invoiceProvider:false,webhookVerification:false,kycAml:false,cryptoSettlementProvider:false,adminAuthentication:false},metrics:{inrPaymentsReceived:0,pendingPaymentConfirmations:0,verifiedPayments:0,pendingConversionApprovals:0,approvedConversions:0,completedConversions:0,failedConversions:0,totalUsdtSettled:0},...empty,notice:'No payment or conversion records exist. No checkout or real conversion is enabled.'});
    }
    if (req.method==='POST' && url.pathname==='/api/chat') { const b=await readBody(req); if (!String(b.message||'').trim()) return send(res,400,{error:'Message is required'}); return send(res,200,await answer(b.message,b.context)); }
    if (req.method==='POST' && url.pathname==='/api/leads') {
      const b=await readBody(req);
      if (b.consent !== true) return send(res,400,{error:'Explicit consent is required before saving contact details.'});
      if (!validContact(b.contact)) return send(res,400,{error:'Enter a valid email address or phone number.'});
      if (!['buyer','renter','seller','question','business-demo'].includes(b.intent)) return send(res,400,{error:'Choose a valid enquiry type.'});
      const lead={id:crypto.randomUUID(), intent:b.intent, name:String(b.name||'').trim().slice(0,100), contact:String(b.contact).trim().slice(0,200), location:String(b.location||'').trim().slice(0,120), budget:String(b.budget||'').trim().slice(0,120), propertyType:String(b.propertyType||'').trim().slice(0,80), timeline:String(b.timeline||'').trim().slice(0,80), need:String(b.need||'').trim().slice(0,200), consent:true, createdAt:new Date().toISOString()};
      const db=readDb(); db.leads.unshift(lead); writeDb(db); return send(res,201,{id:lead.id,saved:true});
    }
    if (req.method==='POST' && url.pathname==='/api/handoffs') {
      const b=await readBody(req); const db=readDb(); const item={id:crypto.randomUUID(),question:String(b.question||'').trim().slice(0,1000),intent:String(b.intent||'question').slice(0,40),summary:String(b.summary||'').slice(0,1000),createdAt:new Date().toISOString(),status:'open'};
      if(!item.question && !item.summary) return send(res,400,{error:'A question or enquiry summary is required.'}); db.handoffs.unshift(item); writeDb(db); return send(res,201,{id:item.id,queued:true});
    }
    if (req.method==='GET' && url.pathname==='/api/admin') { const db=readDb(); return send(res,200,{leads:db.leads,handoffs:db.handoffs,mode:process.env.OPENAI_API_KEY?'AI adapter configured (provider not verified)':'DEMO MODE (no API key)', fictionalData:true}); }
    if (req.method==='POST' && url.pathname.startsWith('/api/handoffs/') && url.pathname.endsWith('/resolve')) { const id=url.pathname.split('/')[3]; const db=readDb(); const item=db.handoffs.find(x=>x.id===id); if(!item) return send(res,404,{error:'Handoff not found'}); item.status='resolved'; item.resolvedAt=new Date().toISOString(); writeDb(db); return send(res,200,{saved:true}); }
    if (req.method==='GET' && (url.pathname==='/' || url.pathname==='/admin' || url.pathname==='/agency')) { const file=url.pathname==='/admin'?'admin.html':url.pathname==='/agency'?'agency.html':'index.html'; return send(res,200,fs.readFileSync(path.join(ROOT,file),'utf8'),'text/html; charset=utf-8'); }
    if (req.method==='GET' && !url.pathname.startsWith('/api/')) {
      let decodedPath; try { decodedPath=decodeURIComponent(url.pathname); } catch { return send(res,400,{error:'Invalid path.'}); }
      const publicFiles=new Set(['/index.html','/admin.html','/agency.html','/app.js','/agency.js','/styles.css','/agency.css']);
      if(!publicFiles.has(decodedPath))return send(res,404,{error:'Not found'});
      return send(res,200,fs.readFileSync(path.join(ROOT,decodedPath.slice(1)), 'utf8'),MIME[path.extname(decodedPath)]);
    }
    return send(res,404,{error:'Not found'});
  } catch(e) { console.error('Request failed:',e); if(res.headersSent)return res.destroy(); const clientError=e?.message==='Invalid JSON'||e?.message==='Request too large (2 MB limit)'; return send(res,clientError?400:500,{error:clientError?e.message:'The request could not be completed. Check the local server log.'}); }
});
server.listen(PORT,'127.0.0.1',()=>console.log(`EstateAssist local demo: http://127.0.0.1:${PORT} (mode: ${process.env.OPENAI_API_KEY?'AI':'DEMO'})`));
