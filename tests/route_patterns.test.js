import test from 'node:test';
import assert from 'node:assert/strict';

import {
  matchAdminUserRoleRoute,
  matchBlockedUserRoute,
  matchCardImagePath,
  matchFriendRequestRoute,
  matchFriendRoute,
  matchManagedCardImageRoute,
  matchManagedCardRoute,
  matchRoomInviteRoute,
  matchRoomRoute,
  matchUserAvatarPath
} from '../src/route_patterns.js';

test('room and invite route matchers parse ids and actions', () => {
  assert.deepEqual(matchRoomRoute('/api/rooms/ABC123/join'), {
    code: 'ABC123',
    action: 'join'
  });
  assert.deepEqual(matchFriendRequestRoute('/api/friends/requests/12/accept'), {
    requestId: 12,
    action: 'accept'
  });
  assert.deepEqual(matchRoomInviteRoute('/api/room-invites/99/reject'), {
    inviteId: 99,
    action: 'reject'
  });
});

test('resource matchers parse entity identifiers', () => {
  assert.equal(matchFriendRoute('/api/friends/42'), 42);
  assert.equal(matchBlockedUserRoute('/api/friends/block/5'), 5);
  assert.equal(matchAdminUserRoleRoute('/api/admin/users/7/role'), 7);
  assert.equal(matchManagedCardRoute('/api/admin/cards/delinquent'), 'delinquent');
  assert.equal(
    matchManagedCardImageRoute('/api/admin/cards/delinquent/image'),
    'delinquent'
  );
  assert.equal(matchCardImagePath('/card-images/delinquent'), 'delinquent');
  assert.equal(matchUserAvatarPath('/user-avatars/21'), 21);
});

test('matchers reject unrelated paths', () => {
  assert.equal(matchRoomRoute('/api/rooms/not-valid/join'), null);
  assert.equal(matchFriendRequestRoute('/api/friends/requests/not-a-number/accept'), null);
  assert.equal(matchManagedCardRoute('/api/admin/cards/'), null);
  assert.equal(matchCardImagePath('/user-avatars/21'), null);
});
