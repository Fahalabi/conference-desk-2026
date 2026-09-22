import copy
import json
import shutil
import uuid
import unittest
from unittest.mock import patch
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import Store

class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.directory=Path(__file__).resolve().parent/'.tmp'/uuid.uuid4().hex
        self.directory.mkdir(parents=True)
        # The public tests use a contact-free fixture, never a real participant list.
        (self.directory/'participants.js').write_text('window.CONFERENCE_DATA = '+json.dumps({'participants':[{'id':'test-person','attending':True}]})+';',encoding='utf-8')
        self.source_patch=patch('server.ROOT',self.directory)
        self.source_patch.start()
        self.store=Store(self.directory)
        self.person=next(iter(self.store.people))
    def tearDown(self):
        self.source_patch.stop()
        target=self.directory.resolve()
        assert target.is_relative_to(Path(__file__).resolve().parent/'.tmp')
        shutil.rmtree(target)
    def op(self,id,field,value):
        return dict(id=id,kind='set',person=self.person,field=field,value=value)
    def test_restart_and_backup(self):
        self.store.apply([self.op('1','priority',True)])
        self.store.apply([self.op('2','draft','Text with Arabic: متابعة')])
        loaded=Store(self.directory)
        self.assertTrue(loaded.state['records'][self.person]['priority'])
        self.assertEqual(loaded.state['records'][self.person]['draft'],'Text with Arabic: متابعة')
        backups=list((self.directory/'backups').glob('*.json'))
        self.assertEqual(len(backups),1)
        self.assertEqual(json.loads(backups[0].read_text(encoding='utf-8'))['records'][self.person]['draft'],'')
    def test_retry_idempotence_and_independent_fields(self):
        self.store.apply([self.op('1','visa',True)])
        self.store.apply([self.op('2','flight',True)])
        revision=self.store.state['revision']
        self.store.apply([self.op('1','visa',True)])
        self.assertEqual(self.store.state['revision'],revision)
        self.assertTrue(self.store.state['records'][self.person]['visa'])
        self.assertTrue(self.store.state['records'][self.person]['flight'])
    def test_invalid_batch_is_atomic(self):
        original=copy.deepcopy(self.store.state)
        with self.assertRaises(ValueError):
            self.store.apply([self.op('1','visa',True),self.op('2','hotel','yes')])
        self.assertEqual(self.store.state,original)
        self.assertFalse(self.store.path.exists())
    def test_restore_validation_and_corrupt_file_preservation(self):
        original=copy.deepcopy(self.store.state)
        with self.assertRaises(ValueError):
            self.store.apply([dict(id='1',kind='restore',records={})])
        self.assertEqual(self.store.state,original)
        self.store.path.write_text('broken',encoding='utf-8')
        with self.assertRaises(ValueError):
            Store(self.directory)
        self.assertEqual(self.store.path.read_text(encoding='utf-8'),'broken')
    def test_note_edit_and_restore(self):
        note=dict(id='n',text='First',done=False,createdAt='2026-09-22',updatedAt='2026-09-22')
        self.store.apply([dict(id='1',kind='note',person=self.person,note=note)])
        self.store.apply([dict(id='2',kind='note',person=self.person,note={**note,'text':'Edited','done':True})])
        self.assertEqual(len(self.store.state['records'][self.person]['notes']),1)
        snapshot=copy.deepcopy(self.store.state['records'])
        self.store.apply([dict(id='3',kind='deleteNote',person=self.person,noteId='n')])
        self.store.apply([dict(id='4',kind='restore',records=snapshot)])
        self.assertEqual(self.store.state['records'][self.person]['notes'][0]['text'],'Edited')

if __name__=='__main__':unittest.main()
