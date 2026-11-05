// Reuse the local collector; importing starts a loopback server and startup catch-up.
import '../server.mjs';
const r=await fetch('http://127.0.0.1:4173/api/update',{method:'POST'});
if(r.status===409){for(let i=0;i<180;i++){await new Promise(r=>setTimeout(r,1000));const d=await(await fetch('http://127.0.0.1:4173/api/data')).json();if(!d.busy){console.log(JSON.stringify(d.runs[0]));process.exit(d.runs[0]?.ok?0:1)}}process.exit(1)}
const result=await r.json();console.log(JSON.stringify(result));process.exit(result.ok?0:1);
