import fs from 'node:fs/promises';
import { artistKind } from '../public/artist-kind.js';

const DATA = new URL('../data/store.json', import.meta.url);
const YEAR = Number(process.env.KPOP_YEAR || new Intl.DateTimeFormat('en',{timeZone:'Asia/Seoul',year:'numeric'}).format(new Date()));
const ORIGIN = 'https://k-poptoday.com';
const sleep = ms => new Promise(r=>setTimeout(r,ms));

async function get(url, tries=3){
  for(let i=0;i<tries;i++){
    try{
      const r=await fetch(url,{headers:{'user-agent':'ONDA-Kpop-Radar/1.0'},signal:AbortSignal.timeout(20000)});
      if(!r.ok) throw Error(`HTTP ${r.status}`);
      return await r.text();
    }catch(e){if(i===tries-1)throw e;await sleep(800*(i+1))}
  }
}

function jsonLd(html){
  const out=[];
  for(const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    try{const value=JSON.parse(m[1]);out.push(...(Array.isArray(value)?value:[value]))}catch{}
  }
  return out;
}

function artistsOf(value){
  const raw=value?.performer ?? value?.byArtist ?? [];
  return (Array.isArray(raw)?raw:[raw]).map(x=>typeof x==='string'?x:x?.name).filter(Boolean);
}

function classifyTypes(name=''){
 const types=[];
 if(/사전\s*녹화|사녹|sanok|pre[- ]?record|预录/i.test(name))types.push('预录');
 if(/생방송|생방|본방송|生放|live broadcast/i.test(name))types.push('生放');
 if(/쇼케이스|showcase|(^|\\s)SC($|\\s)/i.test(name))types.push('SC');
 return types.length?[...new Set(types)]:['其他'];
}
function normalizeStoredType(event){
 const explicit=['SC','预录','生放','其他'];
 if(explicit.includes(event.type))return event;
 const detected=classifyTypes([event.type,event.title].join(' '));
 return {...event,type:detected[0]};
}

async function pool(items,limit,worker){
  const results=new Array(items.length);let next=0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const i=next++;try{results[i]=await worker(items[i],i)}catch(e){results[i]={error:String(e),url:items[i]}}}}));
  return results;
}

const store=JSON.parse(await fs.readFile(DATA,'utf8'));
const monthUrls=Array.from({length:12},(_,i)=>`${ORIGIN}/month/${YEAR}-${String(i+1).padStart(2,'0')}`);
const monthPages=await pool(monthUrls,4,async url=>({url,html:await get(url)}));
const itemUrls=[...new Set(monthPages.flatMap(x=>x.html?[...x.html.matchAll(/https:\/\/k-poptoday\.com\/item\/[a-z0-9-]+/g)].map(m=>m[0].replace(`${ORIGIN}/item/`,`${ORIGIN}/zh-hans/item/`)):[]))];
const itemPages=await pool(itemUrls,8,async url=>({url,html:await get(url)}));
const releases=[];const activities=[];const errors=[];

for(const page of itemPages){
  if(page.error){errors.push(`${page.url}: ${page.error}`);continue}
  for(const item of jsonLd(page.html)){
    const types=Array.isArray(item['@type'])?item['@type']:[item['@type']];
    if(types.includes('MusicAlbum')&&item.datePublished){
      const artists=artistsOf(item);if(!artists.length)continue;
      releases.push({id:`release-${page.url.split('/').pop()}`,date:String(item.datePublished).slice(0,10),artist:artists.join(' × '),release:item.name,type:'发行',artistKind:artistKind(artists.join(' × ')),status:'confirmed',sourceUrl:page.url});
    }
    if(types.includes('MusicEvent')&&item.startDate){
      const artists=artistsOf(item);if(!artists.length)continue;
      const venue=typeof item.location==='string'?item.location:item.location?.name||'场地见原公告';
      for(const activityType of classifyTypes(item.name)){
        activities.push({id:`event-${page.url.split('/').pop()}-${activityType}`,date:String(item.startDate).slice(0,10),endDate:String(item.endDate||item.startDate).slice(0,10),artists,title:item.name,type:activityType,venue,city:'韩国',participation:'预约、购票或参与条件请查看原公告',status:'confirmed',sourceUrl:page.url,sourceName:'K-pop Today 条目（含来源）'});
      }
    }
  }
}

const dedupe=(items,key)=>[...new Map(items.map(x=>[x[key],x])).values()].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
const dedupeEvents=items=>[...new Map(items.map(x=>[`${x.date}|${x.type}|${String(x.title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'')}`,x])).values()].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
store.comebacks=dedupe([...(store.comebacks||[]),...releases],'id');
store.kpopEvents=dedupeEvents([...(store.kpopEvents||[]).map(normalizeStoredType),...activities]);
store.updatedAt=new Date().toISOString();
store.coverage={year:YEAR,months:12,releaseCount:store.comebacks.length,activityCount:store.kpopEvents.length,source:'K-pop Today 结构化条目',scopeNote:'公开来源无法保证覆盖需要登录的 Weverse、Fan Cafe、X 预录与站台公告'};
store.runs=[{at:store.updatedAt,ok:errors.length===0,added:releases.length+activities.length,changed:0,errors:errors.slice(0,20)},...(store.runs||[])].slice(0,30);
// Recheck registered official notices without discarding records on network failures.
const noticeChecks=await pool([...new Set((store.kpopEvents||[]).filter(x=>x.id.startsWith('official-')).map(x=>x.sourceUrl))],3,async url=>({url,accessible:!!(await get(url))}));
for(const check of noticeChecks){for(const event of store.kpopEvents||[]){if(event.sourceUrl===check.url){event.sourceLastCheckedAt=new Date().toISOString();event.sourceReachable=!!check.accessible;}}}
await fs.writeFile(DATA,JSON.stringify(store,null,2));
console.log(JSON.stringify({ok:errors.length===0,year:YEAR,releases:releases.length,activities:activities.length,errors:errors.length}));