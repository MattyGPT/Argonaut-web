/** Reproduction harness for the REJECTED, INACTIVE F3 experiment.
 * node <this-file> <absolute-source-directory> <absolute-output-json> [reimagined,realtime]
 * Run separately against pristine 900dcf3 and that revision with the adjacent
 * candidate patch applied. Output is developer evidence: keep it outside the
 * deployed tree. No source files or gameplay settings are mutated here.
 * The all-active positional counters include intentional station keeping;
 * plotCancellations/reissuedAtSamePosition are generic destination-clear/reissue
 * proxies, NOT counts of navigation recovery. See the accompanying review.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
const [root, output, modesArg = 'reimagined,realtime'] = process.argv.slice(2);
if (!root || !output) throw new Error('Pass absolute source directory and output JSON path.');
mkdirSync(dirname(output), { recursive: true });
const imp = rel => import(pathToFileURL(`${root}/${rel}`));
const {runWar} = await imp('scripts/sim-wars.mjs');
const {summarizeField} = await imp('scripts/diagnose-field.mjs');
const {createFieldDiagnostics} = await imp('game/field-diagnostics.js');
const reports = [];
for(const mode of modesArg.split(',')) {
 const wars=[];
 for(let index=0;index<250;index++) {
  const seed=`sim-${index}`, options={mode,seed,precision:false,regional:false,maxStardates:600};
  const hash1=createHash('sha256'),hash2=createHash('sha256');
  const baseline=runWar(index,{...options,onState:g=>hash1.update(JSON.stringify(g)+'\n')});
  const pairs=[], collector=createFieldDiagnostics({onCollision:p=>pairs.push(p)});
  let previous=null; const motion=new Map(); let zeroTicks=0,longTicks=0,maxTicks=0,plotCancellations=0,reissuedAtSamePosition=0; const canceled=new Map();
  const normal=runWar(index,{...options,fieldDiagnostics:collector,onState:g=>{
   hash2.update(JSON.stringify(g)+'\n');
   if(mode==='realtime' && previous) for(const s of g.ships) {
    const p=previous.ships.find(o=>o.id===s.id); if(!p||s.status!=='active') {motion.delete(s.id);continue;}
    const still=Math.hypot(s.x-p.x,s.y-p.y)<1e-6;
    const ticks=still?(motion.get(s.id)||0)+1:0; motion.set(s.id,ticks);
    if(still){zeroTicks++; if(ticks>=8)longTicks++; maxTicks=Math.max(maxTicks,ticks);}
    if(p.dest&&!s.dest&&still){plotCancellations++; canceled.set(s.id,{x:s.x,y:s.y});}
    if(!p.dest&&s.dest&&canceled.has(s.id)){const c=canceled.get(s.id);if(Math.hypot(s.x-c.x,s.y-c.y)<1)reissuedAtSamePosition++;canceled.delete(s.id);}
   }
   previous=g;
  }});
  const a=hash1.digest('hex'),b=hash2.digest('hex');
  if(a!==b||!isDeepStrictEqual(baseline,normal))throw Error(`observer changed ${mode}/${seed}`);
  wars.push({seed,parity:true,stateDigest:b,normal,pairs,arrivalHolds:{...collector.stalls},nonprogress:{zeroTicks,longTicks,maxTicks,plotCancellations,reissuedAtSamePosition}});
  if((index+1)%25===0)console.error(`${mode}: ${index+1}/250`);
 }
 reports.push({mode,settings:{seeds:250,precision:false,regional:false,maxStardates:600},summary:summarizeField(wars,mode),wars});
 writeFileSync(output,JSON.stringify({reports}));
}
