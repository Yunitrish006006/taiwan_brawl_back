export const ROLE_ADMIN = 'admin';
export const ROLE_CARD_MANAGER = 'card_manager';
export const ROLE_PLAYER = 'player';

export const assignableRoles = [
  ROLE_ADMIN,
  ROLE_CARD_MANAGER,
  ROLE_PLAYER
];

export function normalizeRole(role) {
  const value = String(role ?? '').trim().toLowerCase();
  if (value === ROLE_ADMIN) {
    return ROLE_ADMIN;
  }
  if (
    value === ROLE_CARD_MANAGER ||
    value === 'card manager' ||
    value === 'card-manager'
  ) {
    return ROLE_CARD_MANAGER;
  }
  if (value === ROLE_PLAYER || value === 'user') {
    return ROLE_PLAYER;
  }
  return ROLE_PLAYER;
}

export function hasAnyRole(user, roles) {
  return roles.includes(normalizeRole(user?.role));
}

export function canManageCards(user) {
  return hasAnyRole(user, [ROLE_ADMIN, ROLE_CARD_MANAGER]);
}

export function isAdmin(user) {
  return hasAnyRole(user, [ROLE_ADMIN]);
}
