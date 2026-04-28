// ═══════════════════════════════════════
// UTILS
// ═══════════════════════════════════════
const locKey = p => `${p.lat.toFixed(4)}_${p.lng.toFixed(4)}`;
const locKeyFromCoords = (lat, lng) => `${lat.toFixed(4)}_${lng.toFixed(4)}`;

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════
function showProg(v){document.getElementById('progress-wrap').style.display=v?'block':'none';if(!v)document.getElementById('progress-bar-inner').style.width='0%';}
function updProg(pct,txt){document.getElementById('progress-bar-inner').style.width=pct+'%';document.getElementById('progress-text').textContent=txt;}
function showToast(msg,type='info'){const t=document.getElementById('toast');t.textContent=msg;t.className=`show ${type}`;clearTimeout(toastT);toastT=setTimeout(()=>t.className='',5000);}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fmtDate(date,time){
  if(!date)return'';
  const d=new Date(date+'T12:00:00');
  const ds=d.toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'});
  return time?`${ds} ${fmtTime12(time)}`:ds;
}
function fmtTime12(time){
  if(!time)return'';
  const[h,m]=time.split(':').map(Number);
  const suffix=h>=12?'pm':'am';
  const h12=h%12||12;
  return `${h12}:${String(m).padStart(2,'0')}${suffix}`;
}
function fmtDateShort(date){
  if(!date)return'';
  const d=new Date(date+'T12:00:00');
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
}
function fmtDateLong(date){
  if(!date)return'No date';
  const d=new Date(date+'T12:00:00');
  return d.toLocaleDateString('en-US',{weekday:'short',year:'numeric',month:'long',day:'numeric'});
}
function v(id){const el=document.getElementById(id);return el?el.value:'';}

function datePickerHTML(id, value, opts={}) {
  const [y,m,d] = (value||'').split('-');
  const curYear = new Date().getFullYear();
  const minY = opts.minYear || 1990;
  const maxY = opts.maxYear || curYear;
  let yOpts = '<option value="">Year</option>';
  for (let i=maxY; i>=minY; i--) yOpts += `<option value="${i}"${i===+y?' selected':''}>${i}</option>`;
  const months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let mOpts = '<option value="">Month</option>';
  for (let i=1; i<=12; i++) mOpts += `<option value="${String(i).padStart(2,'0')}"${String(i).padStart(2,'0')===m?' selected':''}>${months[i]}</option>`;
  let dOpts = '<option value="">Day</option>';
  for (let i=1; i<=31; i++) dOpts += `<option value="${String(i).padStart(2,'0')}"${String(i).padStart(2,'0')===d?' selected':''}>${i}</option>`;
  const onChange = opts.onChange ? ` onchange="${opts.onChange}"` : '';
  return `<div class="date-picker-row" id="${id}_wrap">
    <select class="fi date-sel" id="${id}_y"${onChange}>${yOpts}</select>
    <select class="fi date-sel" id="${id}_m"${onChange}>${mOpts}</select>
    <select class="fi date-sel" id="${id}_d"${onChange}>${dOpts}</select>
  </div>`;
}
function getDatePickerValue(id) {
  const y=v(id+'_y'), m=v(id+'_m'), d=v(id+'_d');
  if (!y||!m||!d) return '';
  return `${y}-${m}-${d}`;
}

function timePickerHTML(id, value) {
  const [h,m] = (value||'').split(':');
  let hOpts = '<option value="">HH</option>';
  for (let i=0; i<24; i++) { const s=String(i).padStart(2,'0'); hOpts += `<option value="${s}"${s===h?' selected':''}>${s}</option>`; }
  let mOpts = '<option value="">MM</option>';
  for (let i=0; i<60; i++) { const s=String(i).padStart(2,'0'); mOpts += `<option value="${s}"${s===m?' selected':''}>${s}</option>`; }
  return `<div class="date-picker-row" id="${id}_wrap">
    <select class="fi date-sel" id="${id}_h">${hOpts}</select>
    <span style="color:var(--muted);font-size:.85rem;align-self:center">:</span>
    <select class="fi date-sel" id="${id}_m">${mOpts}</select>
  </div>`;
}
function getTimePickerValue(id) {
  const h=v(id+'_h'), m=v(id+'_m');
  if (!h||!m) return '';
  return `${h}:${m}`;
}
