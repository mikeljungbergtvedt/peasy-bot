const XLSX = require('xlsx');
const wb = XLSX.readFile('/tmp/pulse-data.xlsx');
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
const now = new Date('2026-05-22');
const tenDaysAgo = new Date(now); tenDaysAgo.setDate(now.getDate()-10);
function parseDate(s){ if(!s||typeof s!=='string') return null; const m=s.match(/^(\d{2})\.(\d{2})\.(\d{4})/); return m?new Date(+m[3],+m[2]-1,+m[1]):null; }
let registrert=0, sdMottatt=0, gireBestilt=0, ler=0, mottatt=0, solgt=0;
for(let i=1;i<rows.length;i++){
  const r = rows[i];
  const dReg = parseDate(r[13]);
  if(!dReg || dReg < tenDaysAgo) continue;
  registrert++;
  if(parseDate(r[14])) sdMottatt++;
  if(parseDate(r[15])) gireBestilt++;
  if(parseDate(r[16])) ler++;
  if(parseDate(r[17])) mottatt++;
  if(parseDate(r[18])) solgt++;
}
console.log('Periode siste 10 dager (fra '+tenDaysAgo.toISOString().slice(0,10)+'):');
console.log('Registrert (estimater): '+registrert);
console.log('SD mottatt: '+sdMottatt);
console.log('Gire bestilt (kunde aksept): '+gireBestilt);
console.log('Levere selv: '+ler);
console.log('Mottatt: '+mottatt);
console.log('Solgt: '+solgt);
console.log('---');
if(registrert) console.log('Aksept-rate (Gire/Reg): '+(gireBestilt*100/registrert).toFixed(1)+'%');
if(sdMottatt) console.log('Aksept-rate (Gire/SD): '+(gireBestilt*100/sdMottatt).toFixed(1)+'%');
