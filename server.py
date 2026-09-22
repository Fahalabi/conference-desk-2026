"""Private localhost dashboard. Saves atomically and keeps rolling file backups."""
import argparse
import copy
import json
import os
import sys
import threading
import time
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
import mimetypes
import re

ROOT = Path(__file__).resolve().parent
DATASET = 'publishers-2026-farok'
BOOL_FIELDS = ('attending', 'priority', 'visa', 'flight', 'hotel')

def now():
    return datetime.now(timezone.utc).isoformat()

def validate_added(value):
    if not isinstance(value,list) or len(value)>5000:raise ValueError('Invalid added participant list.')
    result=[];seen=set()
    for p in value:
        if not isinstance(p,dict) or not isinstance(p.get('id'),str) or not re.fullmatch(r'added-[a-z0-9-]{8,80}',p['id']) or p['id'] in seen:raise ValueError('Invalid new participant ID.')
        seen.add(p['id'])
        keys=('firstName','lastName','email','organization','country','countryCode')
        if not all(isinstance(p.get(k),str) and len(p[k])<=500 for k in keys) or not isinstance(p.get('phones'),list) or len(p['phones'])>10 or not all(isinstance(v,str) and len(v)<=100 for v in p['phones']) or p.get('owners') not in (['FH'],['SM']) or type(p.get('attending')) is not bool or type(p.get('visaRequired')) is not bool:raise ValueError('Invalid participant details.')
        if p['email'] and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',p['email']):raise ValueError('Enter a valid email address or leave it blank.')
        if (p['countryCode'] and not re.fullmatch(r'[a-z]{2}',p['countryCode'])) or bool(p['countryCode'])!=bool(p['country']):raise ValueError('Choose a country or leave it blank.')
        if not any(s.strip() for s in [*(p[k] for k in keys if k!='countryCode'),*p['phones']]):raise ValueError('Enter at least one detail to identify this card.')
        result.append(dict(id=p['id'],**{k:p[k].strip() for k in keys},phones=[s.strip() for s in p['phones'] if s.strip()],owners=p['owners'][:],attending=p['attending'],visaRequired=p['visaRequired'],added=True))
    return result

def merge_people(people,added):
    result=dict(people)
    for p in validate_added(added):
        if p['id'] in result and result[p['id']]!=p:raise ValueError('This participant ID already exists with different details.')
        result[p['id']]=p
    return result

def initial_record(p):
    return dict(attending=p['attending'],priority=False,visaRequired=p.get('visaRequired',True),visa=False,flight=False,hotel=False,notes=[],draft='')

def validate_records(records, people):
    if not isinstance(records, dict) or set(records) != set(people):
        raise ValueError('Backup participant list does not match this dashboard.')
    result = {}
    for pid, r in records.items():
        if not isinstance(r, dict) or any(type(r.get(k)) is not bool for k in BOOL_FIELDS):
            raise ValueError('Invalid status in backup.')
        if 'visaRequired' in r and type(r['visaRequired']) is not bool:
            raise ValueError('Invalid visa requirement.')
        if not isinstance(r.get('draft'), str) or len(r['draft']) > 20000:
            raise ValueError('Invalid note draft.')
        notes = r.get('notes')
        if not isinstance(notes, list) or len(notes) > 2000:
            raise ValueError('Invalid notes.')
        seen = set()
        for n in notes:
            if not isinstance(n, dict) or not isinstance(n.get('id'), str) or not n['id'] or n['id'] in seen:
                raise ValueError('Invalid or duplicate note ID.')
            if not isinstance(n.get('text'), str) or len(n['text']) > 20000 or type(n.get('done')) is not bool or not all(isinstance(n.get(k), str) for k in ('createdAt','updatedAt')):
                raise ValueError('Invalid note content.')
            seen.add(n['id'])
            if 'reviewed' in n and type(n['reviewed']) is not bool:raise ValueError('Invalid note review.')
        result[pid] = {**{k:r[k] for k in BOOL_FIELDS}, 'visaRequired':r.get('visaRequired',people[pid].get('visaRequired',True)), 'draft':r['draft'], 'notes':[{**{k:n[k] for k in ('id','text','done','createdAt','updatedAt')},'reviewed':n.get('reviewed',False)} for n in notes]}
    return result

def restore_records(incoming, people, current):
    if isinstance(incoming,dict) and set(incoming)==set(people):
        return validate_records(incoming,people)
    base={pid:p for pid,p in people.items() if not p.get('added')}
    legacy={pid:p for pid,p in base.items() if 'FH' in p.get('owners',['FH'])}
    if not isinstance(incoming,dict) or not incoming or not set(incoming)<=set(people) or not (set(base)<=set(incoming) or set(legacy)<=set(incoming)):raise ValueError('Backup participant list does not match this dashboard.')
    return {**current,**validate_records(incoming,{pid:people[pid] for pid in incoming})}

class Store:
    def __init__(self, directory):
        self.directory = directory.resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory/'progress.json'
        self.backups = self.directory/'backups'
        self.backups.mkdir(exist_ok=True)
        self.lock = threading.Lock()
        seed = json.loads((ROOT/'participants.js').read_text(encoding='utf-8').removeprefix('window.CONFERENCE_DATA = ').rstrip(';\n'))
        self.people = {p['id']:p for p in seed['participants']}
        self.seed_people=dict(self.people)
        self.state = {'schemaVersion':1,'datasetId':DATASET,'revision':0,'updatedAt':None,'applied':[], 'addedParticipants':[], 'records':{pid:initial_record(p) for pid,p in self.people.items()}}
        if self.path.exists():
            saved = json.loads(self.path.read_text(encoding='utf-8'))
            if saved.get('datasetId') != DATASET or saved.get('schemaVersion') != 1:
                raise ValueError('Saved progress format is not recognized. Existing files have been preserved.')
            previous=saved['records']
            saved['addedParticipants']=validate_added(saved.get('addedParticipants',[]))
            self.people=merge_people(self.people,saved['addedParticipants'])
            self.state['records'].update({p['id']:initial_record(p) for p in saved['addedParticipants']})
            saved['records'] = restore_records(previous,self.people,self.state['records'])
            if previous!=saved['records']:
                # Keep an exact copy before extending an existing FH progress file.
                (self.backups/f'pre-shared-roster-{time.time_ns()}.json').write_bytes(self.path.read_bytes())
                saved['revision']+=1;saved['updatedAt']=now()
                self.persist(saved)
            self.state = saved

    def persist(self,state):
        temp=self.directory/'progress.tmp'
        with temp.open('w',encoding='utf-8') as handle:
            json.dump(state,handle,ensure_ascii=False,indent=2)
            handle.flush();os.fsync(handle.fileno())
        os.replace(temp,self.path)

    def snapshot(self):
        with self.lock:
            return copy.deepcopy(self.state)

    def apply(self, operations):
        if not isinstance(operations,list) or not 1 <= len(operations) <= 500:
            raise ValueError('Expected 1–500 updates.')
        with self.lock:
            state=copy.deepcopy(self.state)
            people=dict(self.people)
            applied=set(state['applied'])
            changed=False
            for op in operations:
                if not isinstance(op,dict) or not isinstance(op.get('id'),str) or not op['id']:
                    raise ValueError('Missing update ID.')
                if op['id'] in applied:
                    continue
                kind=op.get('kind')
                if op.get('workspace')=='PR' and not (kind=='set' and op.get('field') in ('visa','flight','hotel') or kind=='noteStatus'):
                    raise ValueError('PR can update completion and note review only.')
                if kind=='addParticipant':
                    if op.get('workspace') not in ('FH','SM'):raise ValueError('Add participants from FH or SM.')
                    participant=validate_added([op.get('participant')])[0]
                    if participant['owners']!=[op['workspace']]:raise ValueError('The card must belong to the current workspace.')
                    if participant['id'] in people:raise ValueError('This participant has already been added.')
                    if participant['email'] and any(p.get('email','').strip().lower()==participant['email'].lower() for p in people.values()):raise ValueError('A participant with this email already exists. Search FH or SM for their card.')
                    if len(state['addedParticipants'])>=5000:raise ValueError('The added participant limit has been reached.')
                    people[participant['id']]=participant;state['addedParticipants'].append(participant)
                    record=initial_record(participant)
                    if type(op.get('priority',False)) is not bool:raise ValueError('Invalid priority.')
                    record['priority']=op.get('priority',False)
                    for field in ('visa','flight','hotel'):
                        if type(op.get(field,False)) is not bool:raise ValueError('Invalid completion status.')
                        record[field]=op.get(field,False)
                    note=op.get('note','')
                    if not isinstance(note,str) or len(note)>20000:raise ValueError('Invalid note.')
                    if note.strip():record['notes']=[dict(id=participant['id']+'-note',text=note.strip(),done=False,reviewed=False,createdAt=now(),updatedAt=now())]
                    state['records'][participant['id']]=record
                elif kind=='restore':
                    incoming=validate_added(op.get('addedParticipants',[]));people=merge_people(people,incoming)
                    state['addedParticipants']=[p for p in people.values() if p.get('added')]
                    current={**{pid:initial_record(p) for pid,p in people.items()},**state['records']}
                    state['records']=restore_records(op.get('records'),people,current)
                else:
                    pid=op.get('person')
                    if pid not in people:
                        raise ValueError('Unknown participant.')
                    r=state['records'][pid]
                    if kind=='set':
                        field,value=op.get('field'),op.get('value')
                        if field in (*BOOL_FIELDS,'visaRequired') and type(value) is bool or field=='draft' and isinstance(value,str) and len(value)<=20000:
                            r[field]=value
                        else:
                            raise ValueError('Invalid field update.')
                    elif kind=='note':
                        note=op.get('note')
                        if not isinstance(note,dict):
                            raise ValueError('Invalid note.')
                        index=next((i for i,n in enumerate(r['notes']) if n['id']==note.get('id')),None)
                        if index is None:
                            r['notes'].append(note)
                        else:
                            r['notes'][index]={**r['notes'][index],**note}
                    elif kind=='noteText':
                        note=next((n for n in r['notes'] if n['id']==op.get('noteId')),None)
                        if note is None or not isinstance(op.get('text'),str) or len(op['text'])>20000 or not isinstance(op.get('updatedAt'),str):raise ValueError('Invalid note text.')
                        note['text']=op['text'];note['updatedAt']=op['updatedAt']
                    elif kind=='noteStatus':
                        note=next((n for n in r['notes'] if n['id']==op.get('noteId')),None)
                        if note is None or op.get('field') not in ('done','reviewed') or type(op.get('value')) is not bool or not isinstance(op.get('updatedAt'),str):raise ValueError('Invalid note status.')
                        note[op['field']]=op['value'];note['updatedAt']=op['updatedAt']
                    elif kind=='deleteNote':
                        r['notes']=[n for n in r['notes'] if n['id']!=op.get('noteId')]
                    else:
                        raise ValueError('Unknown update.')
                state['applied'].append(op['id'])
                applied.add(op['id'])
                changed=True
            if not changed:
                return copy.deepcopy(self.state)
            state['records']=validate_records(state['records'],people)
            state['applied']=state['applied'][-10000:]
            state['revision']+=1
            state['updatedAt']=now()
            if self.path.exists():
                backup=self.backups/f"progress-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{time.time_ns()}.json"
                backup.write_bytes(self.path.read_bytes())
            self.persist(state)
            self.state=state
            self.people=people
            for stale in sorted(self.backups.glob('progress-*.json'))[:-100]:
                stale.unlink()
            return copy.deepcopy(state)

def handler_factory(store, port):
    class Handler(BaseHTTPRequestHandler):
        def client_snapshot(self,state):
            # Previously open FH tabs can keep saving while they are refreshed.
            version=self.headers.get('X-Conference-Roster')
            if version!='3':
                state['records']={pid:r for pid,r in state['records'].items() if pid in store.seed_people and (version=='2' or 'FH' in store.seed_people[pid].get('owners',['FH']))}
                state.pop('addedParticipants',None)
            return state
        def log_message(self,*args):
            pass

        def send(self,status,body,content_type='application/json; charset=utf-8'):
            if isinstance(body,dict):
                body=json.dumps(body,ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type',content_type)
            self.send_header('Content-Length',str(len(body)))
            self.send_header('Cache-Control','no-store')
            self.send_header('X-Content-Type-Options','nosniff')
            self.end_headers()
            self.wfile.write(body)

        def allowed(self):
            return self.headers.get('Host') in (f'127.0.0.1:{port}',f'localhost:{port}')

        def do_GET(self):
            if not self.allowed():
                return self.send(403,{'error':'Local access only.'})
            path=unquote(urlparse(self.path).path)
            if path=='/api/state':
                return self.send(200,self.client_snapshot(store.snapshot()))
            file=ROOT/('index.html' if path=='/' else path.lstrip('/'))
            allowed={'index.html','styles.css','liquid.css','app.js','core.js','participants.js','map.js','map-data.js','export.js','favicon.svg'}
            if path.lstrip('/') not in allowed and path!='/' and not path.startswith('/assets/flags/'):
                return self.send(404,{'error':'Not found.'})
            if not file.resolve().is_relative_to(ROOT) or not file.is_file():
                return self.send(404,{'error':'Not found.'})
            return self.send(200,file.read_bytes(),mimetypes.guess_type(file)[0] or 'application/octet-stream')

        def do_POST(self):
            if not self.allowed() or self.headers.get('Origin') not in (None,f'http://127.0.0.1:{port}',f'http://localhost:{port}') or self.headers.get('X-Conference-Client')!='local-dashboard':
                return self.send(403,{'error':'Local dashboard requests only.'})
            if self.path!='/api/actions':
                return self.send(404,{'error':'Not found.'})
            try:
                size=int(self.headers.get('Content-Length','0'))
                if not 0 < size <= 12_000_000:
                    return self.send(413,{'error':'Backup is too large.'})
                payload=json.loads(self.rfile.read(size))
                if payload.get('datasetId') != DATASET:
                    raise ValueError('Wrong participant list.')
                result=store.apply(payload.get('operations'))
                return self.send(200,self.client_snapshot(result))
            except (ValueError,KeyError,TypeError) as exc:
                return self.send(400,{'error':str(exc)})
            except OSError:
                return self.send(500,{'error':'Could not write the progress file. Your browser copy is retained.'})
    return Handler

if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--data-dir',type=Path,default=ROOT/'data')
    parser.add_argument('--open',action='store_true')
    args=parser.parse_args()
    store=Store(args.data_dir)
    server=ThreadingHTTPServer(('127.0.0.1',args.port),handler_factory(store,args.port))
    print(f'Conference dashboard: http://127.0.0.1:{args.port}',flush=True)
    print(f'Progress file: {store.path}',flush=True)
    if args.open:
        webbrowser.open(f'http://127.0.0.1:{args.port}')
    server.serve_forever()
