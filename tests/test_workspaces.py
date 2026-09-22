import copy,json,uuid,shutil,unittest
from pathlib import Path
from unittest.mock import patch
import server

class WorkspaceTests(unittest.TestCase):
    def participant(self,owner='FH',email=''):
        return dict(id='added-'+uuid.uuid4().hex,firstName='New',lastName='',email=email,organization='',country='',countryCode='',phones=[],attending=True,visaRequired=False,owners=[owner])
    def setUp(self):
        self.test_root=Path(__file__).resolve().parent/'.tmp';self.test_root.mkdir(exist_ok=True)
        self.root=self.test_root/uuid.uuid4().hex;self.root.mkdir()
        self.people=[dict(id='fh-person',attending=True,owners=['FH']),dict(id='sm-person',attending=True,owners=['SM'],visaRequired=False)]
        self.patch=patch.object(server,'ROOT',self.root);self.patch.start()
        self.seed(self.people)
    def tearDown(self):
        self.patch.stop();assert self.root.resolve().is_relative_to(self.test_root.resolve());shutil.rmtree(self.root)
    def seed(self,people):(self.root/'participants.js').write_text('window.CONFERENCE_DATA = '+json.dumps(dict(participants=people))+';\n',encoding='utf-8')
    def test_migration_preserves_all_legacy_values(self):
        self.seed(self.people[:1]);old=server.Store(self.root/'data')
        note=dict(id='n',text='Keep exactly',done=True,createdAt='date',updatedAt='date')
        old.apply([dict(id='1',kind='set',person='fh-person',field='draft',value='Unsaved composition'),dict(id='2',kind='note',person='fh-person',note=note)])
        original=copy.deepcopy(old.state)
        legacy=copy.deepcopy(original);legacy['records']['fh-person'].pop('visaRequired');legacy['records']['fh-person']['notes'][0].pop('reviewed')
        old.path.write_text(json.dumps(legacy),encoding='utf-8')
        self.seed(self.people);new=server.Store(self.root/'data')
        self.assertEqual(new.state['records']['fh-person'],original['records']['fh-person'])
        self.assertFalse(new.state['records']['sm-person']['visaRequired'])
        self.assertEqual(new.state['revision'],original['revision']+1)
        self.assertEqual(len(list((self.root/'data/backups').glob('pre-shared-roster-*.json'))),1)
        self.assertEqual(server.Store(self.root/'data').state,new.state)
    def test_old_backup_restore_does_not_erase_shahd(self):
        store=server.Store(self.root/'data');legacy={'fh-person':copy.deepcopy(store.state['records']['fh-person'])}
        store.state['records']['sm-person']['flight']=True;store.persist(store.state)
        store.apply([dict(id='2',kind='restore',records=legacy)])
        self.assertTrue(store.state['records']['sm-person']['flight'])
    def test_archived_and_overview_views_are_read_only(self):
        store=server.Store(self.root/'data')
        for workspace in ('SM','PR','OV'):
            with self.assertRaises(ValueError):store.apply([dict(id='reject',workspace=workspace,kind='set',person='fh-person',field='flight',value=True)])
        with self.assertRaises(ValueError):store.apply([dict(id='archive',workspace='FH',kind='set',person='sm-person',field='flight',value=True)])

    def test_new_cards_persist_and_retries_do_not_duplicate(self):
        store=server.Store(self.root/'data');p=self.participant('FH');before=copy.deepcopy(store.state['records'])
        op=dict(id='add',kind='addParticipant',workspace='FH',participant=p,priority=True,flight=True,note='Review arrival')
        state=store.apply([op]);self.assertEqual(len(state['addedParticipants']),1)
        self.assertEqual(store.apply([op]),state)
        loaded=server.Store(self.root/'data');self.assertEqual(loaded.state,state)
        self.assertEqual(loaded.people[p['id']]['email'],'');self.assertEqual(loaded.people[p['id']]['country'],'')
        record=loaded.state['records'][p['id']];self.assertTrue(record['priority']);self.assertTrue(record['flight']);self.assertFalse(record['visaRequired']);self.assertEqual(record['notes'][0]['text'],'Review arrival')
        for pid,record in before.items():self.assertEqual(loaded.state['records'][pid],record)

    def test_new_card_validation_is_atomic_and_pr_cannot_add(self):
        store=server.Store(self.root/'data');original=copy.deepcopy(store.state);p=self.participant()
        for workspace,person in [('PR',p),('SM',p),('FH',{**p,'firstName':''}),('FH',{**p,'email':'broken'})]:
            with self.assertRaises(ValueError):store.apply([dict(id=uuid.uuid4().hex,kind='addParticipant',workspace=workspace,participant=person)])
        with self.assertRaises(ValueError):store.apply([dict(id='new',kind='addParticipant',workspace='FH',participant=p),dict(id='bad',kind='set',person=p['id'],field='hotel',value='yes')])
        self.assertEqual(store.state,original);self.assertNotIn(p['id'],store.people)
        p['email']='unique@example.test';store.apply([dict(id='valid',kind='addParticipant',workspace='FH',participant=p)])
        with self.assertRaises(ValueError):store.apply([dict(id='duplicate',kind='addParticipant',workspace='SM',participant=self.participant('SM','UNIQUE@example.test'))])
        self.assertEqual(len(store.state['addedParticipants']),1)

    def test_restore_transfers_new_cards_and_old_backup_preserves_them(self):
        source=server.Store(self.root/'source');legacy=copy.deepcopy(source.state['records']);p=self.participant('FH')
        source.apply([dict(id='add',kind='addParticipant',workspace='FH',participant=p,hotel=True,note='Retain')])
        snapshot=source.snapshot();target=server.Store(self.root/'target')
        target.apply([dict(id='restore',kind='restore',workspace='FH',records=snapshot['records'],addedParticipants=snapshot['addedParticipants'])])
        self.assertEqual(target.state['records'],snapshot['records']);self.assertIn(p['id'],target.people)
        target.apply([dict(id='old',kind='restore',workspace='FH',records=legacy)])
        self.assertTrue(target.state['records'][p['id']]['hotel']);self.assertEqual(target.state['records'][p['id']]['notes'][0]['text'],'Retain')
        self.assertIn(p['id'],server.Store(self.root/'target').people)

if __name__=='__main__':unittest.main()
