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

function classify(name=''){
  if(/팬미팅|fan\s*meeting|fancon|fan\s*concert/i.test(name))return 'Fan Meeting';
  if(/쇼케이스|showcase/i.test(name))return 'Showcase';
  if(/사전녹화|pre.?record/i.test(name))return '预录';
  if(/공개방송|open\s*broadcast/i.test(name))return '公开录制';
  if(/시상식|awards?/i.test(name))return '颁奖典礼';
  if(/로드쇼|roadshow/i.test(name))return '路演';
  if(/팝업|브랜드|brand|popup|pop-up/i.test(name))return '品牌站台';
  if(/콘서트|concert|tour|live/i.test(name))return '演唱会';
  return '其他';
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
      activities.push({id:`event-${page.url.split('/').pop()}`,date:String(item.startDate).slice(0,10),endDate:String(item.endDate||item.startDate).slice(0,10),artists,title:item.name,type:classify(item.name),venue,city:'韩国',participation:'预约、购票或参与条件请查看原公告',status:'confirmed',sourceUrl:page.url,sourceName:'K-pop Today 条目（含来源）'});
    }
  }
}

const dedupe=(items,key)=>[...new Map(items.map(x=>[x[key],x])).values()].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
const dedupeEvents=items=>[...new Map(items.map(x=>[`${x.date}|${String(x.title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'')}`,x])).values()].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
store.comebacks=dedupe(releases,'id');
store.kpopEvents=dedupeEvents(activities);
store.updatedAt=new Date().toISOString();
store.coverage={year:YEAR,months:12,releaseCount:store.comebacks.length,activityCount:store.kpopEvents.length,source:'K-pop Today 结构化条目',scopeNote:'公开来源无法保证覆盖需要登录的 Weverse、Fan Cafe、X 预录与站台公告'};
store.runs=[{at:store.updatedAt,ok:errors.length===0,added:releases.length+activities.length,changed:0,errors:errors.slice(0,20)},...(store.runs||[])].slice(0,30);
await fs.writeFile(DATA,JSON.stringify(store,null,2));
console.log(JSON.stringify({ok:errors.length===0,year:YEAR,releases:releases.length,activities:activities.length,errors:errors.length}));