import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldInitiateOffer } from '../voice.js';

test('voice mesh elects exactly one deterministic offer initiator', () => {
  assert.equal(shouldInitiateOffer('a-member', 'b-member'), true);
  assert.equal(shouldInitiateOffer('b-member', 'a-member'), false);
});

test('voice mesh never offers to itself or an unknown peer', () => {
  assert.equal(shouldInitiateOffer('same', 'same'), false);
  assert.equal(shouldInitiateOffer('same', null), false);
});
