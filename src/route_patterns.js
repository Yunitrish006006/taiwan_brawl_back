export function matchRoomRoute(pathname) {
  const match = pathname.match(
    /^\/api\/rooms\/([A-Z0-9]{6})\/(join|ready|rematch|state|ws|invite|host-finish)$/
  );
  if (!match) {
    return null;
  }

  return {
    code: match[1],
    action: match[2]
  };
}

export function matchFriendRequestRoute(pathname) {
  const match = pathname.match(
    /^\/api\/friends\/requests\/(\d+)\/(accept|reject|cancel)$/
  );
  if (!match) {
    return null;
  }
  return {
    requestId: Number(match[1]),
    action: match[2]
  };
}

export function matchFriendRoute(pathname) {
  const match = pathname.match(/^\/api\/friends\/(\d+)$/);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

export function matchBlockedUserRoute(pathname) {
  const match = pathname.match(/^\/api\/friends\/block\/(\d+)$/);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

export function matchRoomInviteRoute(pathname) {
  const match = pathname.match(/^\/api\/room-invites\/(\d+)\/(accept|reject)$/);
  if (!match) {
    return null;
  }
  return {
    inviteId: Number(match[1]),
    action: match[2]
  };
}

export function matchAdminUserRoleRoute(pathname) {
  const match = pathname.match(/^\/api\/admin\/users\/(\d+)\/role$/);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

export function matchManagedCardRoute(pathname) {
  const match = pathname.match(/^\/api\/admin\/cards\/([a-zA-Z0-9_]+)$/);
  if (!match) {
    return null;
  }
  return match[1];
}

export function matchManagedCardImageRoute(pathname) {
  const match = pathname.match(/^\/api\/admin\/cards\/([a-zA-Z0-9_]+)\/image$/);
  if (!match) {
    return null;
  }
  return match[1];
}

export function matchManagedCardCharacterImageRoute(pathname) {
  const match = pathname.match(/^\/api\/admin\/cards\/([a-zA-Z0-9_]+)\/character-image$/);
  if (!match) {
    return null;
  }
  return match[1];
}

export function matchManagedCardCharacterImageDirectionRoute(pathname) {
  const match = pathname.match(
    /^\/api\/admin\/cards\/([a-zA-Z0-9_]+)\/character-images\/(front|back|left|right)$/
  );
  if (!match) {
    return null;
  }
  return {
    cardId: match[1],
    direction: match[2]
  };
}

export function matchManagedCardCharacterAssetRoute(pathname) {
  const match = pathname.match(
    /^\/api\/admin\/cards\/([a-zA-Z0-9_]+)\/character-assets\/([a-zA-Z0-9_-]+)$/
  );
  if (!match) {
    return null;
  }
  return {
    cardId: match[1],
    assetId: match[2]
  };
}

export function matchManagedCardBgImageRoute(pathname) {
  const match = pathname.match(/^\/api\/admin\/cards\/([a-zA-Z0-9_]+)\/bg-image$/);
  if (!match) {
    return null;
  }
  return match[1];
}

export function matchCardImagePath(pathname) {
  const match = pathname.match(/^\/card-images\/([a-zA-Z0-9_]+)$/);
  if (!match) {
    return null;
  }
  return match[1];
}

export function matchCardCharacterImagePath(pathname) {
  const match = pathname.match(/^\/card-character-images\/([a-zA-Z0-9_]+)$/);
  if (!match) {
    return null;
  }
  return match[1];
}

export function matchCardCharacterImageDirectionPath(pathname) {
  const match = pathname.match(
    /^\/card-character-images\/([a-zA-Z0-9_]+)\/(front|back|left|right)$/
  );
  if (!match) {
    return null;
  }
  return {
    cardId: match[1],
    direction: match[2]
  };
}

export function matchCardCharacterAssetPath(pathname) {
  const match = pathname.match(
    /^\/card-character-assets\/([a-zA-Z0-9_]+)\/([a-zA-Z0-9_-]+)$/
  );
  if (!match) {
    return null;
  }
  return {
    cardId: match[1],
    assetId: match[2]
  };
}

export function matchCardBgImagePath(pathname) {
  const match = pathname.match(/^\/card-bg-images\/([a-zA-Z0-9_]+)$/);
  if (!match) {
    return null;
  }
  return match[1];
}

export function matchUserAvatarPath(pathname) {
  const match = pathname.match(/^\/user-avatars\/(\d+)$/);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}
