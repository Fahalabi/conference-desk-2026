(function (root) {
  'use strict';
  const DATASET = 'publishers-2026-farok';
  const fields = ['attending', 'priority', 'visa', 'flight', 'hotel'];
  function initialRecords(people) {
    return Object.fromEntries(people.map(p => [p.id, {attending:p.attending, priority:false, visa:false, flight:false, hotel:false, notes:[], draft:''}]));
  }
  function validateRecords(records, people) {
    if (!records || Array.isArray(records) || typeof records !== 'object') throw new Error('The backup has no participant records.');
    const ids = people.map(p => p.id);
    if (Object.keys(records).length !== ids.length || ids.some(id => !Object.hasOwn(records,id))) throw new Error('This backup belongs to a different participant list.');
    const result = {};
    for (const id of ids) {
      const r = records[id];
      if (!r || fields.some(k => typeof r[k] !== 'boolean') || !Array.isArray(r.notes) || r.notes.length > 2000 || typeof r.draft !== 'string' || r.draft.length > 20000) throw new Error('The backup contains an invalid participant record.');
      const seen = new Set();
      for (const n of r.notes) {
        if (!n || typeof n.id !== 'string' || !n.id || seen.has(n.id) || typeof n.text !== 'string' || n.text.length > 20000 || typeof n.done !== 'boolean' || typeof n.createdAt !== 'string' || typeof n.updatedAt !== 'string') throw new Error('The backup contains an invalid note.');
        seen.add(n.id);
      }
      result[id] = { ...Object.fromEntries(fields.map(k => [k,r[k]])), draft:r.draft, notes:r.notes.map(n => ({id:n.id,text:n.text,done:n.done,createdAt:n.createdAt,updatedAt:n.updatedAt})) };
    }
    return result;
  }
  function apply(records, op, people) {
    if (op.kind === 'restore') return validateRecords(op.records,people);
    if (!Object.hasOwn(records,op.person)) throw new Error('Unknown participant.');
    const r=records[op.person];
    if (op.kind === 'set') {
      if (!(fields.includes(op.field) && typeof op.value === 'boolean') && !(op.field === 'draft' && typeof op.value === 'string' && op.value.length <= 20000)) throw new Error('Invalid field update.');
      r[op.field]=op.value;
    } else if (op.kind === 'note') {
      const i=r.notes.findIndex(n=>n.id===op.note.id);
      if(i<0) r.notes.push({...op.note}); else r.notes[i]={...op.note};
    } else if (op.kind === 'deleteNote') r.notes=r.notes.filter(n=>n.id!==op.noteId);
    else throw new Error('Unknown update.');
    return records;
  }
  function normalize(s) {return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();}
  function matches(p,r,f) {
    const q=normalize(f.search||'').trim();
    if(q&&!normalize([p.firstName,p.lastName,p.email,p.organization,p.country,...p.phones,...r.notes.map(n=>n.text)].join(' ')).includes(q))return false;
    if(f.country&&p.country!==f.country)return false;
    if(f.attendance==='attending'&&!r.attending || f.attendance==='not-attending'&&r.attending)return false;
    if(f.priority==='priority'&&!r.priority || f.priority==='normal'&&r.priority)return false;
    const completed=Number(r.visa)+Number(r.flight)+Number(r.hotel);
    if(f.completion==='complete'&&completed!==3 || f.completion==='pending'&&completed===3)return false;
    for(const key of ['visa','flight','hotel'])if(f.completion===key+'-pending'&&r[key])return false;
    return true;
  }
  function totals(records) {
    const all=Object.values(records), attending=all.filter(r=>r.attending);
    return {total:all.length,attending:attending.length,notAttending:all.length-attending.length,priority:all.filter(r=>r.priority).length,
      visa:attending.filter(r=>r.visa).length,flight:attending.filter(r=>r.flight).length,hotel:attending.filter(r=>r.hotel).length};
  }
  function countrySummary(people,records){
    const groups=new Map();
    for(const person of people){
      const code=person.countryCode;
      if(!groups.has(code))groups.set(code,{code,country:person.country,people:[],attending:[],priority:[]});
      const group=groups.get(code),record=records[person.id];group.people.push(person);
      if(record.attending)group.attending.push(person);
      if(record.priority)group.priority.push(person);
    }
    return groups;
  }
  const api={DATASET,initialRecords,validateRecords,apply,matches,totals,countrySummary};
  if(typeof module!=='undefined')module.exports=api;else root.ConferenceCore=api;
})(typeof window!=='undefined'?window:globalThis);
