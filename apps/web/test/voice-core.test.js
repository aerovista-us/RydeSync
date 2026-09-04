import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedIcePathFromStats, shouldInitiateOffer } from '../voice.js';

test('voice mesh elects exactly one deterministic offer initiator', () => {
  assert.equal(shouldInitiateOffer('a-member', 'b-member'), true);
  assert.equal(shouldInitiateOffer('b-member', 'a-member'), false);
});

test('voice mesh never offers to itself or an unknown peer', () => {
  assert.equal(shouldInitiateOffer('same', 'same'), false);
  assert.equal(shouldInitiateOffer('same', null), false);
});

test('selected ICE path reports TURN relay without exposing candidate addresses', () => {
  const report = [
    { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' },
    { id: 'pair', type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'local', remoteCandidateId: 'remote' },
    { id: 'local', type: 'local-candidate', candidateType: 'relay', address: '10.0.0.4' },
    { id: 'remote', type: 'remote-candidate', candidateType: 'srflx', address: '203.0.113.7' }
  ];
  assert.equal(selectedIcePathFromStats(report), 'turn-relay');
});

test('selected ICE path reports direct for non-relay selected candidates', () => {
  const report = [
    { id: 'pair', type: 'candidate-pair', selected: true, localCandidateId: 'local', remoteCandidateId: 'remote' },
    { id: 'local', type: 'local-candidate', candidateType: 'host' },
    { id: 'remote', type: 'remote-candidate', candidateType: 'srflx' }
  ];
  assert.equal(selectedIcePathFromStats(report), 'direct');
  assert.equal(selectedIcePathFromStats([]), null);
});
