import copy,json,shutil,unittest,uuid
from pathlib import Path
from unittest.mock import patch
import server

class EditTests(unittest.TestCase):
    def setUp(self):
        self.temp=Path(__file__).parent/'.tmp';self.temp.mkdir(exist_ok=True)
        self.root=self.temp/('edit-'+uuid.uuid4().hex);self.root.mkdir()
        self.patch=patch.object(server,'ROOT',self.root);self.patch.start()
        self.people=[dict(id='original-fh',firstName='Initial',lastName='Guest',email='old@example.test',organization='Books',country='France',countryCode='fr',phones=['+111','+222'],owners=['FH'],attending=True),dict(id='archived-sm',firstName='Archived',lastName='Guest',email='archived@example.test',organization='Press',country='Canada',countryCode='ca',phones=[],owners=['SM'],attending=False)]
        (self.root/'participants.js').write_text('window.CONFERENCE_DATA = '+json.dumps(dict(participants=self.people))+';\n',encoding='utf-8')
        self.store=server.Store(self.root/'data')
        self.store.state['records']['archived-sm']['notes']=[dict(id='n',text='Archived note',done=True,reviewed=True,createdAt='date',updatedAt='date')]
        self.store.apply([dict(id='progress',workspace='FH',kind='set',person='original-fh',field='flight',value=True)])
    def tearDown(self):
        self.patch.stop();assert self.root.resolve().is_relative_to(self.temp.resolve());shutil.rmtree(self.root)
    def op(self,pid='original-fh',**changes):
        previous={k:self.store.people[pid].get(k,[] if k=='phones' else '') for k in server.DETAIL_FIELDS}
        return dict(id=uuid.uuid4().hex,workspace='FH',kind='editParticipant',person=pid,previous=previous,details={**previous,**changes})
    def test_edit_and_restart_keep_progress_and_stable_id(self):
        before=copy.deepcopy(self.store.state['records']);op=self.op(firstName='Updated',email='new@example.test',country='Japan',countryCode='jp',phones=[])
        result=self.store.apply([op]);self.assertEqual(self.store.apply([op]),result)
        again=server.Store(self.root/'data')
        self.assertEqual(again.people['original-fh']['email'],'new@example.test');self.assertEqual(again.state['records'],before)
        self.assertEqual(again.people['archived-sm'],self.people[1]);self.assertEqual(result['participantEdits']['original-fh'],op['details'])
    def test_invalid_duplicate_archived_and_concurrent_edits_are_atomic(self):
        before=self.store.snapshot();ops=[self.op(email='ARCHIVED@example.test'),self.op(email='invalid'),self.op('archived-sm',firstName='No'),self.op(countryCode='')]
        for op in ops:
            with self.assertRaises(ValueError):self.store.apply([op])
            self.assertEqual(self.store.snapshot(),before)
        old=self.op(firstName='Stale');self.store.apply([self.op(firstName='Fresh')])
        with self.assertRaisesRegex(ValueError,'another tab'):self.store.apply([old])
        self.assertEqual(self.store.people['original-fh']['firstName'],'Fresh')
    def test_full_and_legacy_restore_preserve_archived_data_and_edits(self):
        op=self.op(firstName='Restorable');backup=self.store.apply([op]);archived=copy.deepcopy(backup['records']['archived-sm'])
        self.store.apply([self.op(firstName='Later')]);backup['records']['archived-sm']['notes']=[]
        self.store.apply([dict(id='restore',workspace='FH',kind='restore',records=backup['records'],participantEdits=backup['participantEdits'])])
        self.assertEqual(self.store.people['original-fh']['firstName'],'Restorable');self.assertEqual(self.store.state['records']['archived-sm'],archived)
        self.store.apply([dict(id='old',kind='restore',records={'original-fh':backup['records']['original-fh']})])
        self.assertEqual(self.store.people['original-fh']['firstName'],'Restorable')
    def test_edited_added_participant_roundtrips_backup(self):
        p={**self.people[0], 'id':'added-'+uuid.uuid4().hex,'email':'added@example.test','visaRequired':False}
        self.store.apply([dict(id='add',kind='addParticipant',workspace='FH',participant=p)])
        backup=self.store.apply([self.op(p['id'],firstName='Edited addition')])
        self.store.apply([self.op(p['id'],firstName='Later addition')])
        self.store.apply([dict(id='restore-add',workspace='FH',kind='restore',**{k:backup[k] for k in ('records','addedParticipants','participantEdits')})])
        self.assertEqual(server.Store(self.root/'data').people[p['id']]['firstName'],'Edited addition')

if __name__=='__main__':unittest.main()
