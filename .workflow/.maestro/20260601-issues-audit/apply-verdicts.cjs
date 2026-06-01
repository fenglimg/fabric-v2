// Merge verdicts from verdicts.json into status.json findings[].verify, recompute G-TRIAGE/G-FIX actuals.
const fs=require("fs");
const dir=__dirname;
const sp=dir+"/status.json";
const vp=dir+"/verdicts.json";
const s=JSON.parse(fs.readFileSync(sp,"utf8"));
const verdicts=fs.existsSync(vp)?JSON.parse(fs.readFileSync(vp,"utf8")):{};
const byId={}; (s.findings||[]).forEach(f=>byId[f.id]=f);
let applied=0;
for(const [id,v] of Object.entries(verdicts)){
  const f=byId[id]; if(!f){console.error("WARN no finding",id);continue;}
  f.verify=f.verify||{};
  f.verify.tier=v.tier||f.verify.tier||"deterministic";
  f.verify.verdict=v.verdict;
  f.verify.evidence=v.evidence||null;
  f.verify.refute_reason=v.verdict==="refuted"?(v.refute_reason||null):null;
  if(v.classification) f.verify.classification=v.classification;
  if(v.fix_decision) f.verify.fix_decision=v.fix_decision; // FIX-NOW | CARRY-RC3 | NO-ACTION
  if(v.fix_task_id!==undefined) f.fix_task_id=v.fix_task_id;
  applied++;
}
// recompute gates
const F=s.findings||[];
const verdicted=F.filter(f=>(f.verify&&f.verify.verdict)).length;
const confirmed=F.filter(f=>f.verify&&f.verify.verdict==="confirmed");
const gT=(s.ship_criteria||[]).find(g=>g.name==="G-TRIAGE");
if(gT) gT.actual=`${verdicted}/${F.length} verdicted`;
const gF=(s.ship_criteria||[]).find(g=>g.name==="G-FIX");
// confirmed fixed = those with fix_decision FIX-NOW done. We track later.
fs.writeFileSync(sp, JSON.stringify(s,null,2));
console.log(`applied ${applied} verdicts. verdicted=${verdicted}/${F.length}, confirmed=${confirmed.length}`);
const byV={}; F.forEach(f=>{const v=(f.verify&&f.verify.verdict)||"null"; byV[v]=(byV[v]||0)+1});
console.log("verdict dist:",JSON.stringify(byV));
