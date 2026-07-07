/*
 * TIM cycle-count -> Odoo inventory-adjustment reconciler  (three-type split)
 * Usage:  node reconcile/run_reconcile.js
 * Inputs (in docs/):
 *   2026.2 cycle count full count minus reels.csv     count (serials + bulk); header row required
 *   2026.2 full reel count.csv                         reel count (Description, Reels No, Quantity)
 *   Quants (stock.quant)SERIALS.csv                    Odoo on-hand, serialized devices only
 *   Quants (stock.quant)REELS.csv                      Odoo on-hand, reels only
 *   Quants (stock.quant)BULK.csv                       Odoo on-hand, bulk only
 *   Product Moves (Stock Move Line) (stock.move.line).csv   moves since count (state=done)
 *   Inventory Locations (stock.location).csv           Barcode = count location code
 *   product_id_overrides.csv (optional)                id,default_code for zero-on-hand items
 * Model: counted_now = count + validated moves; Odoo on-hand already reflects the moves, so the
 * number pushed = count. Serials reconcile by serial; bulk by (item,location); reels by (item,reel#).
 * Three inventory types are reconciled independently against their own scoped quants export.
 */
const fs=require('fs'), path=require('path');
// Script lives in reconcile/ ; data lives in the (git-ignored) docs/ working area.
const DIR=path.join(__dirname,'..','docs')+'/', OUT=path.join(__dirname,'..','docs','reconcile_output')+'/';
function parseCsv(t){const R=[];let r=[],f='',q=false;for(let i=0;i<t.length;i++){const c=t[i];if(q){if(c==='"'){if(t[i+1]==='"'){f+='"';i++;}else q=false;}else f+=c;}else{if(c==='"')q=true;else if(c===','){r.push(f);f='';}else if(c==='\r'){}else if(c==='\n'){r.push(f);R.push(r);r=[];f='';}else f+=c;}}if(f.length||r.length){r.push(f);R.push(r);}return R;}
function load(p){const rows=parseCsv(fs.readFileSync(DIR+p,'utf8'));const h=rows[0].map(x=>x.replace(/^﻿/,'').trim());return rows.slice(1).filter(r=>r.some(v=>v&&v.trim()!=='')).map(r=>Object.fromEntries(h.map((k,i)=>[k,(r[i]??'').trim()])));}
const COUNT_REQUIRED=['Item','Lot/Serial','QuantitySum','Ticket'];
function loadCount(p){const rows=parseCsv(fs.readFileSync(DIR+p,'utf8'));const header=rows[0].map(x=>x.replace(/^﻿/,'').trim());const miss=COUNT_REQUIRED.filter(c=>!header.includes(c));if(miss.length)throw new Error('\n  Count file "'+p+'" missing required header(s): '+miss.join(', ')+'\n  Found: '+JSON.stringify(header)+'\n  --> Fix the SOURCE file (row 1 must be the header) and re-run.\n');return rows.slice(1).filter(r=>r.some(v=>v&&v.trim()!=='')).map(r=>Object.fromEntries(header.map((k,i)=>[k,(r[i]??'').trim()])));}
const esc=v=>{v=String(v==null?'':v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
const write=(f,h,rows)=>{fs.writeFileSync(OUT+f,[h.join(','),...rows.map(r=>h.map(k=>esc(r[k])).join(','))].join('\r\n'));console.log('  '+f+' ('+rows.length+' rows)');};
const bracket=s=>{const m=/^\[([^\]]+)\]/.exec(s||'');return m?m[1]:'';};
const numc=s=>{const n=parseFloat(String(s).replace(/,/g,''));return isNaN(n)?0:n;};
const norm=s=>String(s).toUpperCase().replace(/\[[^\]]*\]/g,'').replace(/[^A-Z0-9]/g,'');

const count=loadCount('2026.2 cycle count full count minus reels.csv');
const reelCount=load('2026.2 full reel count.csv');
const Sq=load('Quants (stock.quant)SERIALS.csv');
const Rq=load('Quants (stock.quant)REELS.csv');
const Bq=load('Quants (stock.quant)BULK.csv');
const moves=load('Product Moves (Stock Move Line) (stock.move.line).csv');
const locs=load('Inventory Locations (stock.location).csv');

const barcode={};locs.forEach(r=>{if(r['Barcode'])barcode[r['Barcode']]=r['Parent Location']?r['Parent Location']+'/'+r['Location Name']:r['Location Name'];});
const mapLoc=t=>barcode[t]||null;
const NONSHELF=/(ChargeOut|Staged|Output|Packed|Input)$/i;   // transit/process, never zero
const IMP=['Product','Product/ID','Location','Lot/Serial Number','Counted Quantity'];
const REELS='W367/S/Reels', REELX='W367/S/Reelx';
const SERIAL_RE=/^[A-Za-z0-9][A-Za-z0-9._\-]{4,}$/;
const isSerial=r=>r['Lot/Serial']&&SERIAL_RE.test(r['Lot/Serial']);
const isOut=ref=>/^WHCHG/.test(ref);
const prodId={},prodName={};[...Sq,...Rq,...Bq].forEach(r=>{const it=bracket(r['Product']);if(r['Product/ID'])prodId[it]=r['Product/ID'];if(!prodName[it])prodName[it]=r['Product'];});
if(fs.existsSync(DIR+'product_id_overrides.csv'))load('product_id_overrides.csv').forEach(r=>{if(r['default_code']&&r['id'])prodId[r['default_code'].trim()]=r['id'].trim();});

console.log('Loaded: count',count.length,'| reelCount',reelCount.length,'| SERIALS',Sq.length,'| REELS',Rq.length,'| BULK',Bq.length,'| moves',moves.length);
console.log('Writing deliverables:');

// change log
write('1_change_since_count.csv',['Date','Item','Product','Direction','Quantity','Reference','Source','WorkOrder','Contact','Serial'],
  moves.map(m=>({Date:m['Date'],Item:bracket(m['Product']),Product:m['Product'].replace(/^\[[^\]]+\]\s*/,''),Direction:isOut(m['Reference'])?'OUT':'IN',Quantity:m['Quantity'],Reference:m['Reference'],Source:m['Source'],WorkOrder:m['HCTC Work Order'],Contact:m['Contact'],Serial:m['Reel Number']})));

// ===== SERIALIZED (scoped to SERIALS quants) =====
const countedSer=new Set(count.filter(isSerial).map(r=>r['Lot/Serial']));
const outSer=new Set(moves.filter(m=>m['Reel Number']&&isOut(m['Reference'])).map(m=>m['Reel Number']));
const inSer=new Set(moves.filter(m=>m['Reel Number']&&!isOut(m['Reference'])).map(m=>m['Reel Number']));
const sBySerial={};Sq.forEach(r=>{if(r['Lot/Serial Number'])sBySerial[r['Lot/Serial Number']]=r;});
const qOnS=new Set(Sq.filter(r=>r['Lot/Serial Number']&&numc(r['Quantity'])>0).map(r=>r['Lot/Serial Number']));
// COMPLETE zero: every uncounted on-hand device in warehouse scope (SERIALS file already excludes Rental/other-WH), minus transit + received-in
const zeroShelf=Sq.filter(r=>r['Lot/Serial Number']&&numc(r['Quantity'])>0&&!NONSHELF.test(r['Location'])&&!countedSer.has(r['Lot/Serial Number'])&&!inSer.has(r['Lot/Serial Number']));
const zeroTransit=Sq.filter(r=>r['Lot/Serial Number']&&numc(r['Quantity'])>0&&NONSHELF.test(r['Location'])&&!countedSer.has(r['Lot/Serial Number'])&&!inSer.has(r['Lot/Serial Number']));
const addSer=count.filter(r=>isSerial(r)&&!qOnS.has(r['Lot/Serial'])&&!outSer.has(r['Lot/Serial']));
// delta import
const serDelta=[...zeroShelf.map(r=>({Product:r['Product'],'Product/ID':r['Product/ID'],Location:r['Location'],'Lot/Serial Number':r['Lot/Serial Number'],'Counted Quantity':'0'})),
  ...addSer.map(r=>({Product:prodName[r['Item']]||('['+r['Item']+'] '+r['Description']),'Product/ID':prodId[r['Item']]||'',Location:mapLoc(r['Ticket'])||'','Lot/Serial Number':r['Lot/Serial'],'Counted Quantity':'1'}))];
write('8_IMPORT_serialized_adjustment.csv',IMP,serDelta);
// full audit import
const serFull=[],seen=new Set();
count.filter(isSerial).forEach(r=>{const s=r['Lot/Serial'];if(seen.has(s)||outSer.has(s))return;seen.add(s);const q=sBySerial[s];
  if(q&&numc(q['Quantity'])>0)serFull.push({Product:q['Product'],'Product/ID':q['Product/ID'],Location:q['Location'],'Lot/Serial Number':s,'Counted Quantity':'1'});
  else if(!qOnS.has(s))serFull.push({Product:prodName[r['Item']]||('['+r['Item']+'] '+r['Description']),'Product/ID':prodId[r['Item']]||'',Location:mapLoc(r['Ticket'])||'','Lot/Serial Number':s,'Counted Quantity':'1'});});
zeroShelf.forEach(r=>serFull.push({Product:r['Product'],'Product/ID':r['Product/ID'],Location:r['Location'],'Lot/Serial Number':r['Lot/Serial Number'],'Counted Quantity':'0'}));
write('13_IMPORT_serialized_FULL.csv',IMP,serFull);

// ===== BULK (scoped to BULK quants) =====
const bulk=count.filter(r=>!isSerial(r));
const cIL={},unmapped={};
bulk.forEach(r=>{const ml=mapLoc(r['Ticket']);if(!ml){unmapped[r['Ticket']]=(unmapped[r['Ticket']]||0)+1;return;}const k=r['Item']+'@@'+ml;(cIL[k]=cIL[k]||{q:0,d:r['Description'],it:r['Item'],loc:ml});cIL[k].q+=numc(r['QuantitySum']);});
const oIL={};Bq.forEach(r=>{const k=bracket(r['Product'])+'@@'+r['Location'];oIL[k]=(oIL[k]||0)+numc(r['Quantity']);});
const bRecon=[],bImp=[],missId=new Set();let zExcl=0;
Object.entries(cIL).sort().forEach(([k,v])=>{const o=oIL[k]||0,d=v.q-o,pid=prodId[v.it]||'';
  bRecon.push({Item:v.it,Description:v.d,OdooLocation:v.loc,CountedQty:v.q,OdooOnHand:o,Diff:d,HasProductID:pid?'':'NO'});
  if(d!==0&&v.q>0){bImp.push({Product:prodName[v.it]||('['+v.it+'] '+v.d),'Product/ID':pid,Location:v.loc,'Lot/Serial Number':'','Counted Quantity':String(v.q)});if(!pid)missId.add(v.it);}
  else if(d!==0&&v.q===0)zExcl++;});
write('6_reconciliation_bulk.csv',['Item','Description','OdooLocation','CountedQty','OdooOnHand','Diff','HasProductID'],bRecon);
write('9_IMPORT_bulk_adjustment.csv',IMP,bImp);

// ===== REELS (scoped to REELS quants) =====
const reelItems=new Set(reelCount.map(r=>bracket(r['Description'])));
const cat=d=>{d=d.toUpperCase();if(/FIBER|FIBR|\bFO\b|RIBBON|MICROLITE|FTTP|LIGHTSCOPE|2FBR/.test(d))return'fiber';if(/BFC|\bDW\b|DROP WIRE|X22|X24/.test(d))return'copper';if(/PLOWDUCT|MICRO ?DUCT|DUCT/.test(d))return'duct';return'unknown';};
const sug=(c,q)=>q<((c==='copper')?500:5000)?REELX:REELS;
const qPL={},oReel={};Rq.forEach(r=>{const it=bracket(r['Product']),lot=r['Lot/Serial Number'];if(!lot)return;qPL[it+'@@'+lot]=r;if(numc(r['Quantity'])>0)(oReel[it]=oReel[it]||[]).push(r);});
const ckey=new Set(reelCount.map(r=>bracket(r['Description'])+'@@'+r['Reels No']));
const rImp=[],rExc=[],rPlace=[];
reelCount.forEach(r=>{const it=bracket(r['Description']),lot=r['Reels No'],cq=numc(r['Quantity']),q=qPL[it+'@@'+lot],ct=cat(r['Description']);
  if(q){if(cq!==numc(q['Quantity'])&&!NONSHELF.test(q['Location']))rImp.push({Product:q['Product'],'Product/ID':q['Product/ID'],Location:q['Location'],'Lot/Serial Number':lot,'Counted Quantity':String(cq)});
    if(cq>0&&(q['Location']===REELS||q['Location']===REELX)){const w=sug(ct,cq);if(w!==q['Location'])rPlace.push({Item:it,Description:r['Description'].replace(/^\[[^\]]+\]\s*/,''),Reel:lot,Category:ct,CountedFeet:cq,CurrentLoc:q['Location'],SuggestedLoc:w});}}
  else{const cand=(oReel[it]||[]).filter(o=>!ckey.has(it+'@@'+o['Lot/Serial Number'])).map(o=>o['Lot/Serial Number']);const nc=norm(lot);const fz=cand.find(ol=>{const no=norm(ol);return no===nc||no.startsWith(nc)||nc.startsWith(no)||no.includes(nc)||nc.includes(no);});
    rExc.push({Type:fz?'RENAME? (same reel, diff Odoo lot)':(cq>0?'ADD? (counted, not in Odoo)':'EMPTY? (counted 0 - ignore)'),Item:it,Description:r['Description'].replace(/^\[[^\]]+\]\s*/,''),Category:ct,CountReel:lot,CountFeet:cq,OdooLotGuess:fz||'',OdooFeet:fz?numc(qPL[it+'@@'+fz]['Quantity']):'',OdooLocation:fz?qPL[it+'@@'+fz]['Location']:'',SuggestedLoc_ifADD:(!fz&&cq>0)?sug(ct,cq):''});}});
const fzT=new Set(rExc.filter(e=>e.OdooLotGuess).map(e=>e.Item+'@@'+e.OdooLotGuess));
Object.entries(oReel).forEach(([it,rows])=>rows.forEach(r=>{const lot=r['Lot/Serial Number'],k=it+'@@'+lot;if(ckey.has(k)||fzT.has(k)||NONSHELF.test(r['Location']))return;rExc.push({Type:'ZERO? (Odoo has reel, not in count)',Item:it,Description:r['Product'].replace(/^\[[^\]]+\]\s*/,''),Category:cat(r['Product']),CountReel:'',CountFeet:'',OdooLotGuess:lot,OdooFeet:numc(r['Quantity']),OdooLocation:r['Location'],SuggestedLoc_ifADD:''});}));
write('10_IMPORT_reels_matched.csv',IMP,rImp);
write('11_REVIEW_reel_exceptions.csv',['Type','Item','Description','Category','CountReel','CountFeet','OdooLotGuess','OdooFeet','OdooLocation','SuggestedLoc_ifADD'],rExc);
write('12_reel_placement_audit.csv',['Item','Description','Reel','Category','CountedFeet','CurrentLoc','SuggestedLoc'],rPlace);

// ===== summary + built-in safety checks =====
const zByLoc={};zeroShelf.forEach(r=>zByLoc[r['Location']]=(zByLoc[r['Location']]||0)+1);
const reAdd=count.filter(r=>isSerial(r)&&!qOnS.has(r['Lot/Serial'])&&!outSer.has(r['Lot/Serial']));   // = addSer
const noLoc=serFull.filter(r=>!r['Location']||!r['Product/ID']).length;
const rt={};rExc.forEach(e=>rt[e.Type.split(' ')[0]]=(rt[e.Type.split(' ')[0]]||0)+1);
console.log('\nSUMMARY');
console.log('  SERIALIZED: '+zeroShelf.length+' zero-outs (shelf, COMPLETE) + '+addSer.length+' add(s); transit excluded '+zeroTransit.length);
console.log('    zero-outs by location: '+JSON.stringify(zByLoc));
console.log('    SAFETY: serial import lines missing Location/ProductID: '+noLoc+' | genuine adds (not-onhand & not-shipped): '+reAdd.length);
console.log('  BULK: '+bImp.length+' import rows; count=0 excluded '+zExcl+'; missing ProductID '+[...missId].length+' '+JSON.stringify([...missId])+'; unmapped '+JSON.stringify(unmapped));
console.log('  REELS: '+rImp.length+' matched qty-updates; exceptions '+JSON.stringify(rt)+'; '+rPlace.length+' placement moves');
