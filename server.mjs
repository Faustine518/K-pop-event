import {collectPublic} from './collector.mjs';
import http from 'node:http';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.dirname(fileURLToPath(import.meta.url));
const file=path.join(root,'data/store.json');
let db;try{db=JSON.parse(await fs.readFile(file,'utf8'))}catch{db={events:[],runs:[]}}
let busy=false;
const save=async()=>{await fs.writeFile(file+'.tmp',JSON.stringify(db,null,2));await fs.rename(file+'.tmp',file)};
const day=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
const hash=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,24);
function validate(e){if(!e.title||!/^\d{4}-\d{2}-\d{2}$/.test(e.start)||!e.source||!/^https?:\/\//.test(e.source)||!Array.isArray(e.categories))throw Error('每项必须包含 title、start(YYYY-MM-DD)、source(http/https)、categories 数组');return {...e,id:e.id||hash(e.title+e.start+e.city),checkedAt:new Date().toISOString()}}
function merge(events){let added=0,changed=0;for(const e of events){const i=db.events.findIndex(x=>x.id===e.id);if(i<0){db.events.push(e);added++}else{db.events[i]={...db.events[i],...e};changed++}}return {added,changed}}
async function update(){if(busy)return;busy=true;const run={at:new Date().toISOString(),day:day(),added:0,changed:0,errors:[]};try{
 const publicResult=await collectPublic();const counts=merge(publicResult.events);run.added+=counts.added;run.changed+=counts.changed;run.errors.push(...publicResult.errors);
 const key=process.env.SEOUL_API_KEY;
 if(key){try{let start=1,total=1;do{const r=await fetch(`http://openapi.seoul.go.kr:8088/${encodeURIComponent(key)}/json/culturalEventInfo/${start}/${start+999}/`,{signal:AbortSignal.timeout(30000)});const j=await r.json();const data=j.culturalEventInfo;if(!data?.row)throw Error('首尔接口未返回数据，请检查密钥与服务权限');total=data.list_total_count;const events=data.row.map(x=>validate({id:'seoul-'+hash(x.TITLE+x.STRTDATE+x.PLACE),title:x.TITLE,city:'首尔',start:x.STRTDATE?.slice(0,10),end:x.END_DATE?.slice(0,10)||x.END_DATE||x.ENDDATE?.slice(0,10)||x.STRTDATE?.slice(0,10),venue:x.PLACE,categories:[/전시|미술/.test(x.CODENAME)?'展览文化':'现场演出'],price:x.IS_FREE==='무료'?0:null,fee:x.USE_FEE||x.IS_FREE||'待确认',source:x.ORG_LINK||x.HMPG_ADDR||'https://culture.seoul.go.kr',requirements:x.USE_TRGT||'请查看官方公告',description:[x.PROGRAM,x.ETC_DESC].filter(Boolean).join('\n'),status:'已收录',provider:'首尔文化门户（首尔市）'}));const result=merge(events);run.added+=result.added;run.changed+=result.changed;start+=1000}while(start<=total&&start<=20000)}catch{run.errors.push('首尔更新失败：网络、密钥或接口字段异常；已有数据已保留')}}

 run.ok=run.errors.length===0;db.runs.unshift(run);db.runs=db.runs.slice(0,100);await save();return run;
 }finally{busy=false}}
const server=http.createServer(async(req,res)=>{const json=(code,x)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(x))};try{
 if(req.method==='GET'&&req.url==='/api/data')return json(200,{...db,busy,configured:!!process.env.SEOUL_API_KEY});
 if(req.method==='POST'){
 if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return json(403,{error:'Origin rejected'});
 if(req.url==='/api/update'){if(busy)return json(409,{error:'更新正在进行'});return json(200,await update())}
 if(req.url==='/api/import'){let body='';for await(const chunk of req){body+=chunk;if(body.length>2e6)return json(413,{error:'文件过大'})}const input=JSON.parse(body);if(!Array.isArray(input)||input.length>5000)throw Error('请导入活动数组，最多5000条');const events=input.map(validate);const result=merge(events);await save();return json(200,result)}
 }
 if(req.method!=='GET')return json(404,{error:'Not found'});
 const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};const name=files[req.url];if(!name)return json(404,{error:'Not found'});res.setHeader('Content-Type',name.endsWith('js')?'text/javascript':name.endsWith('css')?'text/css':'text/html; charset=utf-8');res.end(await fs.readFile(path.join(root,'public',name)));
 }catch(e){json(400,{error:e.message})}});
server.listen(Number(process.env.PORT)||4173,'127.0.0.1',()=>console.log('Korea Radar: http://127.0.0.1:4173'));
const due=()=>{if(!busy&&db.runs[0]?.day!==day())update().catch(console.error)};due();setInterval(due,60000).unref();

