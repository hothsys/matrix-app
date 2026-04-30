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

// Derive rough region from coordinates (fallback when no country code available)
function _regionFromCoords(lat, lon) {
  lat = parseFloat(lat); lon = parseFloat(lon);
  if (lat >= 10 && lat <= 28 && lon >= -90 && lon <= -58) return 'Caribbean';
  if (lat >= -60 && lat <= 15 && lon >= -90 && lon <= -30) return 'South America';
  if (lat >= 5 && lat <= 84 && lon >= -170 && lon <= -30) return 'North America';
  // Middle East checked before Europe — covers Arabian Peninsula, Levant, Iran, Iraq
  if (lat >= 12 && lat <= 42 && lon >= 34 && lon <= 63) return 'Middle East';
  if (lat >= 35 && lat <= 75 && lon >= -25 && lon <= 65) return 'Europe';
  if (lat >= -40 && lat <= 38 && lon >= -25 && lon <= 55) return 'Africa';
  if (lat >= -10 && lat <= 80 && lon >= 25 && lon <= 180) return 'Asia';
  if (lat >= -50 && lat <= 0 && lon >= 100 && lon <= 180) return 'Oceania';
  if (lat >= -50 && lat <= -10 && lon >= -180 && lon <= -30) return 'South America';
  if (lat >= -55 && lat <= 0 && lon >= 100) return 'Oceania';
  return '';
}

// Country code → continent (definitive, no bounding-box ambiguity)
const _countryContinent = {
  // North America
  US:'North America',CA:'North America',MX:'North America',GL:'North America',
  // Caribbean
  AG:'Caribbean',AI:'Caribbean',AW:'Caribbean',BB:'Caribbean',BL:'Caribbean',BM:'Caribbean',
  BQ:'Caribbean',BS:'Caribbean',CU:'Caribbean',CW:'Caribbean',DM:'Caribbean',DO:'Caribbean',
  GD:'Caribbean',GP:'Caribbean',HT:'Caribbean',JM:'Caribbean',KN:'Caribbean',KY:'Caribbean',
  LC:'Caribbean',MF:'Caribbean',MQ:'Caribbean',MS:'Caribbean',PR:'Caribbean',SX:'Caribbean',
  TC:'Caribbean',TT:'Caribbean',VC:'Caribbean',VG:'Caribbean',VI:'Caribbean',
  // South America
  AR:'South America',BO:'South America',BR:'South America',CL:'South America',CO:'South America',
  EC:'South America',FK:'South America',GF:'South America',GY:'South America',PE:'South America',
  PY:'South America',SR:'South America',UY:'South America',VE:'South America',
  // Central America (grouped with North America)
  BZ:'North America',CR:'North America',GT:'North America',HN:'North America',
  NI:'North America',PA:'North America',SV:'North America',
  // Europe
  AD:'Europe',AL:'Europe',AT:'Europe',AX:'Europe',BA:'Europe',BE:'Europe',BG:'Europe',
  BY:'Europe',CH:'Europe',CY:'Europe',CZ:'Europe',DE:'Europe',DK:'Europe',EE:'Europe',
  ES:'Europe',FI:'Europe',FO:'Europe',FR:'Europe',GB:'Europe',GG:'Europe',GI:'Europe',
  GR:'Europe',HR:'Europe',HU:'Europe',IE:'Europe',IM:'Europe',IS:'Europe',IT:'Europe',
  JE:'Europe',LI:'Europe',LT:'Europe',LU:'Europe',LV:'Europe',MC:'Europe',MD:'Europe',
  ME:'Europe',MK:'Europe',MT:'Europe',NL:'Europe',NO:'Europe',PL:'Europe',PT:'Europe',
  RO:'Europe',RS:'Europe',SE:'Europe',SI:'Europe',SK:'Europe',SM:'Europe',UA:'Europe',
  VA:'Europe',XK:'Europe',
  // Middle East
  AE:'Middle East',BH:'Middle East',IL:'Middle East',IQ:'Middle East',IR:'Middle East',
  JO:'Middle East',KW:'Middle East',LB:'Middle East',OM:'Middle East',PS:'Middle East',
  QA:'Middle East',SA:'Middle East',SY:'Middle East',TR:'Middle East',YE:'Middle East',
  // Africa
  AO:'Africa',BF:'Africa',BI:'Africa',BJ:'Africa',BW:'Africa',CD:'Africa',CF:'Africa',
  CG:'Africa',CI:'Africa',CM:'Africa',CV:'Africa',DJ:'Africa',DZ:'Africa',EG:'Africa',
  EH:'Africa',ER:'Africa',ET:'Africa',GA:'Africa',GH:'Africa',GM:'Africa',GN:'Africa',
  GQ:'Africa',GW:'Africa',KE:'Africa',KM:'Africa',LR:'Africa',LS:'Africa',LY:'Africa',
  MA:'Africa',MG:'Africa',ML:'Africa',MR:'Africa',MU:'Africa',MW:'Africa',MZ:'Africa',
  NA:'Africa',NE:'Africa',NG:'Africa',RE:'Africa',RW:'Africa',SC:'Africa',SD:'Africa',
  SL:'Africa',SN:'Africa',SO:'Africa',SS:'Africa',ST:'Africa',SZ:'Africa',TD:'Africa',
  TG:'Africa',TN:'Africa',TZ:'Africa',UG:'Africa',ZA:'Africa',ZM:'Africa',ZW:'Africa',
  // Asia
  AF:'Asia',AM:'Asia',AZ:'Asia',BD:'Asia',BN:'Asia',BT:'Asia',CN:'Asia',GE:'Asia',
  HK:'Asia',ID:'Asia',IN:'Asia',JP:'Asia',KG:'Asia',KH:'Asia',KP:'Asia',KR:'Asia',
  KZ:'Asia',LA:'Asia',LK:'Asia',MM:'Asia',MN:'Asia',MO:'Asia',MV:'Asia',MY:'Asia',
  NP:'Asia',PH:'Asia',PK:'Asia',RU:'Asia',SG:'Asia',TH:'Asia',TJ:'Asia',TL:'Asia',
  TM:'Asia',TW:'Asia',UZ:'Asia',VN:'Asia',
  // Oceania
  AS:'Oceania',AU:'Oceania',CK:'Oceania',FJ:'Oceania',FM:'Oceania',GU:'Oceania',
  KI:'Oceania',MH:'Oceania',MP:'Oceania',NC:'Oceania',NR:'Oceania',NU:'Oceania',
  NZ:'Oceania',PF:'Oceania',PG:'Oceania',PN:'Oceania',PW:'Oceania',SB:'Oceania',
  TO:'Oceania',TV:'Oceania',VU:'Oceania',WF:'Oceania',WS:'Oceania'
};

const EMPTY_PIN_COLOR = '#E8706F';
const _continentColors = {
  'North America':'#E04545', 'Caribbean':'#E0822A', 'South America':'#4AAF4E',
  'Europe':'#4A7BD9', 'Middle East':'#22D4C8', 'Africa':'#B8A225',
  'Asia':'#9B6FD9', 'Oceania':'#D94A8A'
};
function _continentColor(lat, lng, countryCode) {
  if (countryCode && _countryContinent[countryCode]) {
    return _continentColors[_countryContinent[countryCode]] || EMPTY_PIN_COLOR;
  }
  return _continentColors[_regionFromCoords(lat, lng)] || EMPTY_PIN_COLOR;
}

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
