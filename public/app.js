"use strict";
/* ---------- Donnees (chargees depuis le serveur) ---------- */
const ABS_LABELS = {CP:"Congés payés", Maladie:"Maladie", Sanssolde:"Sans solde", Autre:"Autre", Absent:"Absent"};
let state = {employees:[], shifts:{}, absences:[], presets:[], pointages:{}, location:null, openShifts:[]};
let me = null; // {role, nom, employeeId, restaurantName}

async function api(method, url, body){
  const res = await fetch(url, {
    method,
    headers: body ? {"Content-Type":"application/json"} : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if(res.status === 401){ location.href = "login.html"; throw new Error("non authentifie"); }
  if(!res.ok){ const d = await res.json().catch(()=>({})); throw new Error(d.error || ("Erreur "+res.status)); }
  return res.status === 204 ? null : res.json();
}

async function loadState(){
  const data = await api("GET", "/api/state");
  state.employees = data.employees || [];
  state.shifts = data.shifts || {};
  state.absences = data.absences || [];
  state.presets = data.presets || [];
  state.pointages = data.pointages || {};
  state.location = data.location || null;
  state.openShifts = data.openShifts || [];
}
// Chaque action passe par une route dediee cote serveur (plus de sauvegarde globale :
// le gerant ne peut plus ecraser les pointages / demandes faits entre-temps par les employes).
async function mutate(method, url, body){
  await api(method, url, body);
  await loadState();
}
const POSTE_COLORS = {Cuisine:"#e8590c", Salle:"#1971c2", Plonge:"#0ca678", Bar:"#9c36b5", Direction:"#343a40", Autre:"#adb5bd"};
const posteColor = p => POSTE_COLORS[p] || POSTE_COLORS.Autre;
const isManager = () => me && me.role === "manager";

/* ---------- Dates ---------- */
const pad = n => String(n).padStart(2,"0");
const iso = d => d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
function fromISO(s){ const [y,m,j] = s.split("-").map(Number); return new Date(y, m-1, j); }
function addDays(d,n){ const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function mondayOf(d){ const x = new Date(d); x.setDate(x.getDate() - (x.getDay()+6)%7); x.setHours(0,0,0,0); return x; }
const JOURS = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
const frDate = d => pad(d.getDate())+"/"+pad(d.getMonth()+1);
let currentMonday = mondayOf(new Date());

/* ---------- Calcul des heures ---------- */
function shiftMinutes(s){
  if(!s || !s.debut || !s.fin) return 0;
  const m = t => { const [h,mn] = t.split(":").map(Number); return h*60+mn; };
  let deb = m(s.debut), fin = m(s.fin);
  if(fin <= deb) fin += 1440; // service qui finit apres minuit
  return fin - deb;
}
const dayMinutes = arr => (arr||[]).reduce((t,s)=>t+shiftMinutes(s),0);
function fmtH(min){
  if(!min) return "0h";
  const h = Math.floor(min/60), m = min%60;
  return h + "h" + (m ? pad(m) : "");
}
const key = (empId, dateStr) => empId + "_" + dateStr;
function absenceOn(empId, dateStr){
  const a = state.absences.find(a => a.empId===empId && a.du<=dateStr && dateStr<=a.au && (a.status||"approuve")==="approuve");
  return a ? a.type : null;
}
function weekMinutes(empId, monday){
  let t = 0;
  for(let i=0;i<7;i++) t += dayMinutes(state.shifts[key(empId, iso(addDays(monday,i)))]);
  return t;
}
const sortedEmployees = () => [...state.employees].sort((a,b)=>
  a.poste===b.poste ? a.nom.localeCompare(b.nom) : a.poste.localeCompare(b.poste));

/* ---------- Onglets ---------- */
const MANAGER_ONLY_TABS = ["equipe", "paie"];
function setupTabs(){
  document.querySelectorAll("nav button[data-tab]").forEach(b => {
    if(!isManager() && MANAGER_ONLY_TABS.includes(b.dataset.tab)){ b.style.display = "none"; return; }
    b.onclick = () => {
      document.querySelectorAll("nav button").forEach(x=>x.classList.remove("active"));
      document.querySelectorAll("main section").forEach(x=>x.classList.remove("active"));
      b.classList.add("active");
      document.getElementById("tab-"+b.dataset.tab).classList.add("active");
      renderAll();
    };
  });
}

/* ---------- PLANNING ---------- */
function changeWeek(n){ currentMonday = addDays(currentMonday, n*7); renderPlanning(); }
function goToday(){ currentMonday = mondayOf(new Date()); renderPlanning(); }
function renderPlanning(){
  const dim = addDays(currentMonday,6);
  document.getElementById("weekLabel").textContent =
    "Semaine du " + frDate(currentMonday) + " au " + frDate(dim) + " " + dim.getFullYear();
  const emps = sortedEmployees();
  let html = "<tr><th>Employé</th>";
  for(let i=0;i<7;i++){ const d = addDays(currentMonday,i);
    html += "<th>"+JOURS[i]+"<br>"+frDate(d)+"</th>"; }
  html += "<th>Total<br>semaine</th></tr>";
  if(!emps.length){
    html += "<tr><td colspan='9' style='padding:30px;color:var(--muted)'>"
      + (isManager() ? "Ajoute d'abord ton équipe dans l'onglet 👥 Équipe." : "Aucun employé pour le moment.")
      + "</td></tr>";
  }
  for(const e of emps){
    html += "<tr><td class='emp-name' style='border-left:4px solid "+posteColor(e.poste)+"'><span class='dot' style='background:"+posteColor(e.poste)+"'></span>"+esc(e.nom)
      + "<span class='poste'>"+esc(e.poste)+(e.heuresContrat != null ? " · "+e.heuresContrat+"h/sem" : "")+"</span></td>";
    for(let i=0;i<7;i++){
      const ds = iso(addDays(currentMonday,i));
      const abs = absenceOn(e.id, ds);
      if(abs){
        html += "<td class='shift-cell readonly'><span class='badge "+abs+"'>"+ABS_LABELS[abs]+"</span></td>";
        continue;
      }
      const shifts = state.shifts[key(e.id, ds)] || [];
      let inner = shifts.length
        ? shifts.map(s=>"<div class='shift-line'>"+s.debut+"–"+s.fin+"</div>").join("")
          + "<span class='cell-total'>"+fmtH(dayMinutes(shifts))+"</span>"
        : "<span class='repos'>–</span>";
      const cls = isManager() ? "shift-cell" : "shift-cell readonly";
      const click = isManager() ? " onclick=\"openModal('"+e.id+"','"+ds+"')\"" : "";
      html += "<td class='"+cls+"'"+click+">"+inner+"</td>";
    }
    const tot = weekMinutes(e.id, currentMonday);
    const sup = e.heuresContrat != null ? Math.max(0, tot - e.heuresContrat*60) : 0;
    html += "<td class='total-col'>"+fmtH(tot)+(sup ? "<span class='sup'>+"+fmtH(sup)+" sup</span>" : "")+"</td></tr>";
  }
  document.getElementById("planningTable").innerHTML = html;
  // Legende des couleurs par poste
  const postesPresents = [...new Set(emps.map(e=>e.poste))];
  document.getElementById("legende").innerHTML = postesPresents.map(p =>
    "<span><span class='dot' style='background:"+posteColor(p)+"'></span>"+esc(p)+"</span>").join("");
  // Cout estime de la semaine (jamais imprime, gerant uniquement)
  const costLine = document.getElementById("costLine");
  if(!isManager()){ costLine.innerHTML = ""; return; }
  let cout = 0, manqueTaux = false;
  for(const e of emps){
    if(e.tauxHoraire > 0) cout += (weekMinutes(e.id, currentMonday)/60) * e.tauxHoraire;
    else if(weekMinutes(e.id, currentMonday) > 0) manqueTaux = true;
  }
  costLine.innerHTML = cout > 0
    ? "💶 Coût estimé de la semaine : <b style='color:var(--accent)'>" + cout.toLocaleString("fr-FR",{maximumFractionDigits:0}) + " €</b> brut"
      + (manqueTaux ? " <small>(certains employés n'ont pas de taux horaire renseigné)</small>" : "")
      + " <small>– hors charges patronales et majorations. Cette ligne n'apparaît jamais à l'impression.</small>"
    : "";
}
async function duplicatePrevWeek(){
  if(!confirm("Copier tous les horaires de la semaine précédente sur cette semaine ?\n(Les horaires déjà saisis cette semaine seront remplacés.)")) return;
  try{
    await mutate("POST", "/api/shifts/duplicate-week", {monday: iso(currentMonday)});
    renderPlanning();
  }catch(err){ alert(err.message); }
}

/* ---------- Creneaux de derniere minute ---------- */
async function createOpenShift(){
  const date = document.getElementById("osDate").value;
  const poste = document.getElementById("osPoste").value;
  const debut = document.getElementById("osDebut").value;
  const fin = document.getElementById("osFin").value;
  const note = document.getElementById("osNote").value.trim();
  if(!date || !debut || !fin){ alert("Renseigne la date et les horaires."); return; }
  try{
    await api("POST", "/api/open-shifts", {date, poste, debut, fin, note});
    document.getElementById("osNote").value = "";
    await loadState(); renderOpenShifts();
  }catch(err){ alert(err.message); }
}
async function deleteOpenShift(id){
  if(!confirm("Supprimer ce créneau ?")) return;
  await api("DELETE", "/api/open-shifts/"+id);
  await loadState(); renderOpenShifts();
}
async function claimOpenShift(id){
  if(!confirm("Confirmer : tu prends ce créneau ?")) return;
  try{
    await api("POST", "/api/open-shifts/"+id+"/claim");
    await loadState(); renderOpenShifts(); renderPlanning();
  }catch(err){ alert(err.message); }
}
function renderOpenShifts(){
  const card = document.getElementById("openShiftsCard");
  if(!card) return;
  const list = [...state.openShifts].sort((a,b)=>a.date===b.date ? a.debut.localeCompare(b.debut) : a.date.localeCompare(b.date));
  let html = "";
  if(!list.length){
    html = "<p class='hint'>Aucun créneau à pourvoir pour le moment.</p>";
  } else {
    html = list.map(o => {
      const e = fromISO(o.date);
      return "<div class='open-shift'>"
        + "<div><b>"+JOURS[(e.getDay()+6)%7]+" "+frDate(e)+"</b> – "+o.debut+"–"+o.fin
        + " <span class='dot' style='background:"+posteColor(o.poste)+"'></span>"+esc(o.poste)
        + (o.note ? "<div class='hint' style='margin:0'>"+esc(o.note)+"</div>" : "")
        + "</div>"
        + (isManager()
            ? "<button class='danger-link' onclick=\"deleteOpenShift('"+o.id+"')\">Supprimer</button>"
            : "<button class='primary' onclick=\"claimOpenShift('"+o.id+"')\">✅ Je le prends</button>")
        + "</div>";
    }).join("");
  }
  card.innerHTML = html;
  const form = document.getElementById("openShiftForm");
  if(form) form.style.display = isManager() ? "" : "none";
}

/* ---------- Fenetre horaires ---------- */
let editing = null;
function openModal(empId, dateStr){
  if(!isManager()) return;
  editing = {empId, dateStr};
  const e = state.employees.find(x=>x.id===empId);
  const d = fromISO(dateStr);
  document.getElementById("modalTitle").textContent = e ? e.nom : "";
  document.getElementById("modalSub").textContent = JOURS[(d.getDay()+6)%7] + " " + frDate(d);
  const shifts = state.shifts[key(empId,dateStr)] || [];
  ["s1d","s1f","s2d","s2f"].forEach(id => document.getElementById(id).value = "");
  if(shifts[0]){ s1d.value = shifts[0].debut; s1f.value = shifts[0].fin; }
  if(shifts[1]){ s2d.value = shifts[1].debut; s2f.value = shifts[1].fin; }
  updatePasteBtn();
  renderPresets();
  document.getElementById("overlay").classList.add("open");
}
function readShiftFields(){
  const out = [];
  if(s1d.value && s1f.value) out.push({debut:s1d.value, fin:s1f.value});
  if(s2d.value && s2f.value) out.push({debut:s2d.value, fin:s2f.value});
  return out;
}

/* ---------- Horaires types ---------- */
function renderPresets(){
  const z = document.getElementById("presetZone");
  let html = "";
  if(state.presets.length){
    html += "<b style='display:block;font-size:12px;color:var(--muted);margin-bottom:6px'>⚡ Horaires types – 1 clic pour appliquer</b>";
    html += state.presets.map(p =>
      "<span class='preset'>"
      + "<button class='preset-btn' onclick=\"applyPreset('"+p.id+"')\">"+esc(p.nom)
      + "<small>"+p.shifts.map(s=>s.debut+"–"+s.fin).join(" / ")+"</small></button>"
      + "<button class='preset-del' title='Supprimer cet horaire type' onclick=\"delPreset('"+p.id+"')\">×</button>"
      + "</span>").join("");
  }
  html += "<div><button class='small-btn' onclick='savePreset()'>⭐ Enregistrer ces horaires comme horaire type</button></div>";
  z.innerHTML = html;
}
async function savePreset(){
  const out = readShiftFields();
  if(!out.length){ alert("Remplis d'abord les horaires ci-dessous, puis clique sur ⭐ pour les enregistrer 🙂"); return; }
  const nom = prompt("Donne un nom à cet horaire type (ex : Service complet, Midi seul, Soir seul) :");
  if(!nom || !nom.trim()) return;
  try{
    await mutate("POST", "/api/presets", {nom:nom.trim(), shifts:out});
    renderPresets();
  }catch(err){ alert(err.message); }
}
async function applyPreset(id){
  const p = state.presets.find(x=>x.id===id);
  if(!p || !editing) return;
  try{
    await mutate("PUT", "/api/shifts", {empId:editing.empId, date:editing.dateStr, shifts:p.shifts});
    closeModal(); renderPlanning();
  }catch(err){ alert(err.message); }
}
async function delPreset(id){
  if(!confirm("Supprimer cet horaire type ?\n(Les plannings déjà remplis ne changent pas.)")) return;
  try{
    await mutate("DELETE", "/api/presets/"+id);
    renderPresets();
  }catch(err){ alert(err.message); }
}

/* ---------- Copier / coller des horaires ---------- */
const CLIP_KEY = "monPlanningRestoClip";
function getClip(){
  try{ const c = JSON.parse(localStorage.getItem(CLIP_KEY)); return Array.isArray(c) && c.length ? c : null; }catch(e){ return null; }
}
function updatePasteBtn(){
  const btn = document.getElementById("pasteBtn");
  const clip = getClip();
  if(clip){
    btn.style.display = "";
    btn.innerHTML = "📥 Coller " + clip.map(s=>s.debut+"–"+s.fin).join(" / ");
  } else btn.style.display = "none";
}
function copyShift(){
  const out = readShiftFields();
  if(!out.length){ alert("Remplis d'abord les horaires à copier 🙂"); return; }
  localStorage.setItem(CLIP_KEY, JSON.stringify(out));
  updatePasteBtn();
}
async function pasteShift(){
  const clip = getClip();
  if(!clip || !editing) return;
  try{
    await mutate("PUT", "/api/shifts", {empId:editing.empId, date:editing.dateStr, shifts:clip});
    closeModal(); renderPlanning();
  }catch(err){ alert(err.message); }
}
async function saveShift(){
  if(!editing) return;
  try{
    await mutate("PUT", "/api/shifts", {empId:editing.empId, date:editing.dateStr, shifts:readShiftFields()});
    closeModal(); renderPlanning();
  }catch(err){ alert(err.message); }
}
async function clearShift(){
  if(!editing) return;
  try{
    await mutate("PUT", "/api/shifts", {empId:editing.empId, date:editing.dateStr, shifts:[]});
    closeModal(); renderPlanning();
  }catch(err){ alert(err.message); }
}
function closeModal(){ editing = null; document.getElementById("overlay").classList.remove("open"); }

/* ---------- POINTAGE ---------- */
function tickClock(){
  const n = new Date();
  document.getElementById("clockNow").textContent = pad(n.getHours())+":"+pad(n.getMinutes())+":"+pad(n.getSeconds());
  document.getElementById("clockDate").textContent = JOURS[(n.getDay()+6)%7]+" "+frDate(n)+" "+n.getFullYear();
}
setInterval(tickClock, 1000);
function findOpenPointage(empId){
  const now = new Date();
  for(const d of [iso(now), iso(addDays(now,-1))]){ // hier aussi : service qui finit apres minuit
    const list = state.pointages[key(empId, d)] || [];
    const i = list.findIndex(p => p.in && !p.out);
    if(i >= 0) return {dateStr:d, idx:i, entry:list[i]};
  }
  return null;
}
async function punch(empId){
  const e = state.employees.find(x=>x.id===empId); if(!e) return;
  const open = findOpenPointage(empId);
  const now = new Date(), hhmm = pad(now.getHours())+":"+pad(now.getMinutes());
  if(open){
    if(!confirm(e.nom+" – pointer le DÉPART à "+hhmm+" ?")) return;
  } else {
    if(!confirm(e.nom+" – pointer l'ARRIVÉE à "+hhmm+" ?")) return;
  }
  const loc = await getLocation();
  await api("POST", "/api/state/punch", {empId, loc});
  await loadState();
  renderPointage(); renderPaie();
}
async function editPointage(empId, dateStr, i, champ, val){
  try{
    await mutate("PUT", "/api/pointages", {empId, date:dateStr, index:i, [champ]: val || null});
    renderPointage(); renderPaie();
  }catch(err){ alert(err.message); }
}
async function delPointage(empId, dateStr, i){
  if(!confirm("Supprimer ce pointage ?")) return;
  try{
    await mutate("DELETE", "/api/pointages", {empId, date:dateStr, index:i});
    renderPointage(); renderPaie();
  }catch(err){ alert(err.message); }
}
function renderPointage(){
  tickClock();
  const today = iso(new Date());
  const emps = isManager() ? sortedEmployees() : state.employees.filter(e=>e.id===me.employeeId);
  // Boutons de pointage
  let g = "";
  for(const e of emps){
    const open = findOpenPointage(e.id);
    g += "<button class='punch-btn"+(open ? " in" : "")+"' onclick=\"punch('"+e.id+"')\">"
      + "<span class='dot' style='background:"+posteColor(e.poste)+"'></span>"+esc(e.nom)
      + (open ? "<small>🟢 Présent depuis "+open.entry.in+"<br>Clique pour pointer le départ</small>"
              : "<small>Clique pour pointer l'arrivée</small>")
      + "</button>";
  }
  document.getElementById("pointageGrid").innerHTML = emps.length
    ? "<div class='punch-grid'>"+g+"</div>"
    : "<p class='hint'>Ajoute d'abord ton équipe dans l'onglet 👥 Équipe.</p>";
  // Tableau du jour
  let html = "<tr><th>Employé</th><th>Arrivée</th><th>Départ</th><th>Durée</th>"+(isManager()?"<th></th>":"")+"</tr>";
  let aucun = true;
  for(const e of emps){
    (state.pointages[key(e.id, today)] || []).forEach((p, i) => {
      aucun = false;
      const arr = isManager()
        ? "<input type='time' value='"+(p.in||"")+"' onchange=\"editPointage('"+e.id+"','"+today+"',"+i+",'in',this.value)\">"
        : esc(p.in||"");
      const dep = isManager()
        ? "<input type='time' value='"+(p.out||"")+"' onchange=\"editPointage('"+e.id+"','"+today+"',"+i+",'out',this.value)\">"
        : esc(p.out||"");
      let locBadges = "";
      if(isManager() && state.location){
        const badges = [];
        if(p.inLoc){
          const d = Math.round(distanceMeters(state.location, p.inLoc));
          if(d > 300) badges.push("⚠️ arrivée à "+d+"m du resto");
        }
        if(p.outLoc){
          const d = Math.round(distanceMeters(state.location, p.outLoc));
          if(d > 300) badges.push("⚠️ départ à "+d+"m du resto");
        }
        if(badges.length) locBadges = "<br>"+badges.map(b=>"<span class='badge-warn'>"+b+"</span>").join(" ");
      }
      html += "<tr><td class='emp-name'><span class='dot' style='background:"+posteColor(e.poste)+"'></span>"+esc(e.nom)+"</td>"
        + "<td>"+arr+"</td>"
        + "<td>"+dep+"</td>"
        + "<td>"+(p.in && p.out ? "<b>"+fmtH(shiftMinutes({debut:p.in, fin:p.out}))+"</b>" : "<span class='repos'>en cours…</span>")+locBadges+"</td>"
        + (isManager() ? "<td><button class='danger-link' onclick=\"delPointage('"+e.id+"','"+today+"',"+i+")\">Supprimer</button></td>" : "")
        + "</tr>";
    });
  }
  if(aucun) html += "<tr><td colspan='"+(isManager()?5:4)+"' style='padding:24px;color:var(--muted)'>Personne n'a encore pointé aujourd'hui.</td></tr>";
  document.getElementById("pointageTable").innerHTML = html;
}

/* ---------- EQUIPE ---------- */
let accountsByEmployee = {};
async function loadAccounts(){
  if(!isManager()) return;
  const users = await api("GET", "/api/users");
  accountsByEmployee = {};
  for(const u of users) accountsByEmployee[u.employeeId] = u;
}
async function addEmployee(){
  const nom = document.getElementById("empNom").value.trim();
  if(!nom){ alert("Mets au moins un prénom 🙂"); return; }
  try{
    await mutate("POST", "/api/employees", {
      nom,
      poste: document.getElementById("empPoste").value,
      heuresContrat: parseFloat(document.getElementById("empHeures").value) || 0,
      tauxHoraire: parseFloat(document.getElementById("empTaux").value) || 0,
    });
    document.getElementById("empNom").value = "";
    document.getElementById("empTaux").value = "";
    renderAll();
  }catch(err){ alert(err.message); }
}
async function updateEmp(id, champ, val){
  try{
    await mutate("PUT", "/api/employees/"+id, {[champ]: val});
    renderPlanning(); renderPaie();
  }catch(err){ alert(err.message); }
}
async function removeEmployee(id){
  const e = state.employees.find(x=>x.id===id);
  if(!confirm("Retirer "+e.nom+" de l'équipe ?\n(Ses anciens plannings restent enregistrés, et son accès de connexion est révoqué.)")) return;
  try{
    await mutate("DELETE", "/api/employees/"+id);
    await loadAccounts();
    renderAll();
  }catch(err){ alert(err.message); }
}
async function createAccess(empId){
  const e = state.employees.find(x=>x.id===empId); if(!e) return;
  const login = prompt("Identifiant de connexion pour "+e.nom+" (ex : prénom, sans espaces) :");
  if(!login || !login.trim()) return;
  const password = prompt("Code / mot de passe pour "+e.nom+" (6 caractères minimum) :");
  if(!password || !password.trim()) return;
  try{
    await api("POST", "/api/users", {employeeId: empId, login: login.trim(), password: password.trim()});
    await loadAccounts(); renderEquipe();
  }catch(err){ alert(err.message); }
}
async function revokeAccess(empId){
  const acc = accountsByEmployee[empId]; if(!acc) return;
  if(!confirm("Révoquer l'accès de "+acc.nom+" ?")) return;
  await api("DELETE", "/api/users/"+acc.id);
  await loadAccounts(); renderEquipe();
}
function renderEquipe(){
  let html = "<tr><th>Nom</th><th>Poste</th><th>Heures contrat / semaine</th><th>Taux horaire brut (€)</th><th>Accès</th><th></th></tr>";
  if(!state.employees.length)
    html += "<tr><td colspan='6' style='padding:30px;color:var(--muted)'>Personne pour l'instant – ajoute ta brigade ci-dessus 👆</td></tr>";
  for(const e of sortedEmployees()){
    const acc = accountsByEmployee[e.id];
    html += "<tr><td class='emp-name'><span class='dot' style='background:"+posteColor(e.poste)+"'></span>"+esc(e.nom)+"</td>"
      + "<td>"+esc(e.poste)+"</td>"
      + "<td><input type='number' min='0' max='60' step='0.5' value='"+e.heuresContrat+"' style='width:70px' onchange=\"updateEmp('"+e.id+"','heuresContrat',this.value)\"></td>"
      + "<td><input type='number' min='0' step='0.1' value='"+(e.tauxHoraire||"")+"' placeholder='–' style='width:80px' onchange=\"updateEmp('"+e.id+"','tauxHoraire',this.value)\"></td>"
      + "<td>"+(acc ? "<span class='badge acces'>"+esc(acc.login)+"</span>" : "<span class='repos'>aucun</span>")+"</td>"
      + "<td>"+(acc
          ? "<button class='danger-link' onclick=\"revokeAccess('"+e.id+"')\">Révoquer l'accès</button>"
          : "<button class='small-btn' onclick=\"createAccess('"+e.id+"')\">+ Créer un accès</button>")
        + " <button class='danger-link' onclick=\"removeEmployee('"+e.id+"')\">Retirer</button></td></tr>";
  }
  document.getElementById("equipeTable").innerHTML = html;

  const locBox = document.getElementById("restaurantLocation");
  if(locBox){
    locBox.innerHTML = state.location
      ? "<p>📍 Position enregistrée : <b>"+state.location.lat.toFixed(5)+", "+state.location.lng.toFixed(5)+"</b></p>"
        + "<button class='small-btn' onclick='useCurrentLocationForRestaurant()'>Mettre à jour avec ma position actuelle</button>"
      : "<p>Aucune position enregistrée. Les pointages des employés ne pourront pas être comparés à l'adresse du restaurant.</p>"
        + "<button class='small-btn' onclick='useCurrentLocationForRestaurant()'>📍 Utiliser ma position actuelle</button>";
  }
}

/* ---------- CONGES ---------- */
const ABS_STATUS_LABELS = {approuve:"Approuvé", en_attente:"En attente", refuse:"Refusé"};
const ABS_STATUS_CLASS = {approuve:"acces", en_attente:"attente", refuse:"refuse"};
async function addAbsence(){
  const empId = document.getElementById("absEmp").value;
  const du = document.getElementById("absDu").value, au = document.getElementById("absAu").value;
  if(!empId || !du || !au){ alert("Choisis l'employé et les deux dates."); return; }
  if(au < du){ alert("La date de fin est avant la date de début."); return; }
  try{
    await mutate("POST", "/api/absences", {empId, du, au, type:document.getElementById("absType").value});
    renderAll();
  }catch(err){ alert(err.message); }
}
async function removeAbsence(id){
  try{
    await mutate("DELETE", "/api/absences/"+id);
    renderAll();
  }catch(err){ alert(err.message); }
}
async function requestAbsence(){
  const du = document.getElementById("reqDu").value, au = document.getElementById("reqAu").value;
  if(!du || !au){ alert("Choisis les deux dates."); return; }
  if(au < du){ alert("La date de fin est avant la date de début."); return; }
  const type = document.getElementById("reqType").value;
  const motif = document.getElementById("reqMotif").value.trim();
  try{
    await api("POST", "/api/absences/request", {du, au, type, motif});
    document.getElementById("reqMotif").value = "";
    await loadState(); renderAll();
  }catch(err){ alert(err.message); }
}
async function setAbsenceStatus(id, status){
  try{
    await api("PUT", "/api/absences/"+id+"/status", {status});
    await loadState(); renderAll();
  }catch(err){ alert(err.message); }
}
function renderConges(){
  const formCard = document.getElementById("absFormCard");
  if(formCard) formCard.style.display = isManager() ? "" : "none";
  const reqCard = document.getElementById("absRequestCard");
  if(reqCard) reqCard.style.display = isManager() ? "none" : "";
  const sel = document.getElementById("absEmp");
  if(sel) sel.innerHTML = sortedEmployees().map(e=>"<option value='"+e.id+"'>"+esc(e.nom)+"</option>").join("");
  let html = "<tr><th>Employé</th><th>Du</th><th>Au</th><th>Type</th><th>Motif</th><th>Statut</th><th></th></tr>";
  let list = [...state.absences];
  if(!isManager()) list = list.filter(a=>a.empId===me.employeeId);
  list.sort((a,b)=>b.du.localeCompare(a.du));
  if(!list.length)
    html += "<tr><td colspan='7' style='padding:30px;color:var(--muted)'>Aucune absence enregistrée.</td></tr>";
  for(const a of list){
    const e = state.employees.find(x=>x.id===a.empId);
    const status = a.status || "approuve";
    let actions = "";
    if(isManager() && status === "en_attente"){
      actions += "<button class='small-btn' onclick=\"setAbsenceStatus('"+a.id+"','approuve')\">✅ Accepter</button> "
        + "<button class='small-btn' onclick=\"setAbsenceStatus('"+a.id+"','refuse')\">❌ Refuser</button> ";
    }
    if(isManager()) actions += "<button class='danger-link' onclick=\"removeAbsence('"+a.id+"')\">Supprimer</button>";
    html += "<tr><td class='emp-name'>"+(e?esc(e.nom):"(parti)")+"</td>"
      + "<td>"+frFull(a.du)+"</td><td>"+frFull(a.au)+"</td>"
      + "<td><span class='badge "+a.type+"'>"+ABS_LABELS[a.type]+"</span></td>"
      + "<td>"+esc(a.motif||"")+"</td>"
      + "<td><span class='badge "+ABS_STATUS_CLASS[status]+"'>"+ABS_STATUS_LABELS[status]+"</span></td>"
      + "<td>"+actions+"</td>"
      + "</tr>";
  }
  document.getElementById("absTable").innerHTML = html;
}
const frFull = s => { const d = fromISO(s); return pad(d.getDate())+"/"+pad(d.getMonth()+1)+"/"+d.getFullYear(); };

/* ---------- RECAP PAIE ---------- */
function paieData(){
  const mois = document.getElementById("paieMois").value; // "YYYY-MM"
  if(!mois) return null;
  const [y,m] = mois.split("-").map(Number);
  const first = new Date(y, m-1, 1), last = new Date(y, m, 0);
  const rows = [];
  for(const e of sortedEmployees()){
    // heures planifiees : tous les jours du mois
    let totMin = 0;
    for(let d = new Date(first); d <= last; d = addDays(d,1))
      totMin += dayMinutes(state.shifts[key(e.id, iso(d))]);
    // heures reellement pointees dans le mois
    let pointMin = 0;
    for(let d = new Date(first); d <= last; d = addDays(d,1))
      for(const p of (state.pointages[key(e.id, iso(d))] || []))
        if(p.in && p.out) pointMin += shiftMinutes({debut:p.in, fin:p.out});
    // heures sup : par semaine complete, rattachee au mois du jeudi
    let supMin = 0;
    for(let lun = mondayOf(first); lun <= last; lun = addDays(lun,7)){
      const jeudi = addDays(lun,3);
      if(jeudi.getMonth() !== m-1 || jeudi.getFullYear() !== y) continue;
      supMin += Math.max(0, weekMinutes(e.id, lun) - e.heuresContrat*60);
    }
    // jours d'absence dans le mois, par type (seules les absences approuvees comptent)
    const abs = {CP:0, Maladie:0, Sanssolde:0, Autre:0};
    for(const a of state.absences.filter(a=>a.empId===e.id && (a.status||"approuve")==="approuve")){
      for(let d = fromISO(a.du); d <= fromISO(a.au); d = addDays(d,1))
        if(d >= first && d <= last) abs[a.type]++;
    }
    rows.push({e, totMin, pointMin, supMin, abs});
  }
  return {mois, rows};
}
function renderPaie(){
  if(!isManager()) return;
  const data = paieData();
  const tbl = document.getElementById("paieTable");
  if(!data){ tbl.innerHTML = "<tr><td style='padding:30px;color:var(--muted)'>Choisis un mois ci-dessus.</td></tr>"; return; }
  let html = "<tr><th>Employé</th><th>Poste</th><th>Contrat<br>(h/sem)</th><th>Heures<br>planning</th><th>Heures<br>pointées</th>"
    + "<th>Heures sup</th><th>Congés payés<br>(jours)</th><th>Maladie<br>(jours)</th><th>Sans solde<br>(jours)</th><th>Autre<br>(jours)</th><th>Coût estimé<br>(€ brut)</th></tr>";
  if(!data.rows.length)
    html += "<tr><td colspan='11' style='padding:30px;color:var(--muted)'>Ajoute d'abord ton équipe.</td></tr>";
  let coutTotal = 0;
  for(const r of data.rows){
    const baseMin = r.pointMin > 0 ? r.pointMin : r.totMin; // les heures pointees font foi quand il y en a
    const cout = r.e.tauxHoraire > 0 ? (baseMin/60) * r.e.tauxHoraire : 0;
    coutTotal += cout;
    const ecart = r.pointMin > 0 ? r.pointMin - r.totMin : 0;
    html += "<tr><td class='emp-name'><span class='dot' style='background:"+posteColor(r.e.poste)+"'></span>"+esc(r.e.nom)+"</td><td>"+esc(r.e.poste)+"</td><td>"+r.e.heuresContrat+"</td>"
      + "<td>"+fmtH(r.totMin)+"</td>"
      + "<td>"+(r.pointMin ? "<b>"+fmtH(r.pointMin)+"</b>"
          + (Math.abs(ecart) >= 30 ? "<span class='sup' style='color:"+(ecart>0?"var(--accent)":"var(--blue)")+"'>"+(ecart>0?"+":"–")+fmtH(Math.abs(ecart))+" vs planning</span>" : "")
        : "–")+"</td>"
      + "<td>"+(r.supMin ? "<b style='color:var(--accent)'>"+fmtH(r.supMin)+"</b>" : "0h")+"</td>"
      + "<td>"+(r.abs.CP||"")+"</td><td>"+(r.abs.Maladie||"")+"</td><td>"+(r.abs.Sanssolde||"")+"</td><td>"+(r.abs.Autre||"")+"</td>"
      + "<td>"+(cout ? "<b>"+cout.toLocaleString("fr-FR",{maximumFractionDigits:0})+" €</b>" : "–")+"</td></tr>";
  }
  if(coutTotal > 0)
    html += "<tr><td colspan='10' style='text-align:right;font-weight:700'>Total masse salariale estimée :</td>"
      + "<td style='font-weight:700;color:var(--accent)'>"+coutTotal.toLocaleString("fr-FR",{maximumFractionDigits:0})+" €</td></tr>";
  tbl.innerHTML = html;
}
function exportPaieCSV(){
  const data = paieData();
  if(!data){ alert("Choisis d'abord un mois."); return; }
  const dec = min => (min/60).toFixed(2).replace(".", ","); // heures decimales, virgule FR
  let csv = "Employé;Poste;Contrat h/sem;Heures planning;Heures pointées;Heures sup;CP (jours);Maladie (jours);Sans solde (jours);Autre (jours);Taux horaire brut;Coût estimé € brut\n";
  for(const r of data.rows){
    const baseMin = r.pointMin > 0 ? r.pointMin : r.totMin;
    const cout = r.e.tauxHoraire > 0 ? ((baseMin/60) * r.e.tauxHoraire).toFixed(2).replace(".", ",") : "";
    csv += [r.e.nom, r.e.poste, r.e.heuresContrat, dec(r.totMin), r.pointMin ? dec(r.pointMin) : "", dec(r.supMin),
            r.abs.CP, r.abs.Maladie, r.abs.Sanssolde, r.abs.Autre,
            r.e.tauxHoraire ? String(r.e.tauxHoraire).replace(".", ",") : "", cout].join(";") + "\n";
  }
  download("recap-paie-"+data.mois+".csv", "﻿"+csv, "text/csv;charset=utf-8");
}

/* ---------- Connexion ---------- */
async function logout(){
  await api("POST", "/api/auth/logout");
  location.href = "login.html";
}

/* ---------- Geolocalisation ---------- */
function getLocation(){
  return new Promise(resolve => {
    if(!navigator.geolocation){ resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({lat: pos.coords.latitude, lng: pos.coords.longitude}),
      () => resolve(null),
      {timeout: 5000}
    );
  });
}
function distanceMeters(a, b){
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const sa = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(sa));
}

/* ---------- Position du restaurant ---------- */
async function useCurrentLocationForRestaurant(){
  const loc = await getLocation();
  if(!loc){ alert("Impossible d'obtenir ta position. Vérifie que la géolocalisation est autorisée dans le navigateur."); return; }
  await api("PUT", "/api/restaurant/location", loc);
  state.location = loc;
  renderEquipe();
}

/* ---------- Notifications push ---------- */
function urlBase64ToUint8Array(base64String){
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const out = new Uint8Array(rawData.length);
  for(let i=0;i<rawData.length;i++) out[i] = rawData.charCodeAt(i);
  return out;
}
function updateNotifBtn(active){
  const btn = document.getElementById("notifBtn");
  if(!btn) return;
  btn.textContent = active ? "🔔 Notifications activées" : "🔔 Activer les notifications";
  btn.classList.toggle("active", active);
}
async function toggleNotifications(){
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if(existing){
    await api("DELETE", "/api/push/subscribe", {endpoint: existing.endpoint});
    await existing.unsubscribe();
    updateNotifBtn(false);
    return;
  }
  const perm = await Notification.requestPermission();
  if(perm !== "granted") return;
  const {publicKey} = await api("GET", "/api/push/public-key");
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await api("POST", "/api/push/subscribe", {subscription: sub.toJSON()});
  updateNotifBtn(true);
}
async function setupNotifications(){
  const btn = document.getElementById("notifBtn");
  if(!btn) return;
  if(!("serviceWorker" in navigator) || !("PushManager" in window)){
    btn.style.display = "none";
    return;
  }
  btn.onclick = () => toggleNotifications().catch(()=>{});
  try{
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    updateNotifBtn(!!sub);
  }catch(e){}
}

/* ---------- Utilitaires ---------- */
function download(name, content, type){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], {type}));
  a.download = name; a.click();
  URL.revokeObjectURL(a.href);
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* ---------- Demarrage ---------- */
function renderAll(){
  renderPlanning(); renderPointage(); renderConges(); renderPaie(); renderOpenShifts();
  if(isManager()) renderEquipe();
}
async function init(){
  try{
    me = await api("GET", "/api/me");
  }catch(e){ return; }
  document.getElementById("userBox").textContent = me.restaurantName + " — " + me.nom + (isManager() ? " (gérant)" : "");
  setupTabs();
  if(!isManager()){
    document.getElementById("dupBtn").style.display = "none";
    document.getElementById("planningHint").innerHTML = "💡 Voici le planning de l'équipe (lecture seule). Les congés posés s'affichent automatiquement.";
  }
  await loadState();
  if(isManager()) await loadAccounts();
  document.getElementById("paieMois").value = new Date().getFullYear()+"-"+pad(new Date().getMonth()+1);
  renderAll();
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  }
  setupNotifications();
}
init();
