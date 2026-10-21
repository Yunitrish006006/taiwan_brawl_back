const EVENT_TYPES = new Set(['created', 'edited', 'recalled', 'read']);

function conversationIdFor(userIdA, userIdB) {
  const a = Number(userIdA);
  const b = Number(userIdB);
  return `${Math.min(a, b)}:${Math.max(a, b)}`;
}

function normalizeChatEvent(raw, { actorId, friendId }) {
  if (!raw || typeof raw !== 'object') {
    return { error: 'event must be an object' };
  }

  const eventId = String(raw.eventId ?? '').trim();
  const messageId = String(raw.messageId ?? '').trim();
  const conversationId = String(raw.conversationId ?? '').trim();
  const type = String(raw.type ?? '').trim();
  const revision = Number(raw.revision);
  const createdAt = String(raw.createdAt ?? '').trim();
  const body = raw.body == null ? null : String(raw.body);
  const deviceId = raw.deviceId == null ? null : String(raw.deviceId).trim() || null;

  if (!eventId || !messageId || !conversationId || !createdAt) {
    return { error: 'eventId, messageId, conversationId, and createdAt are required' };
  }
  if (!EVENT_TYPES.has(type)) return { error: 'unsupported event type' };
  if (!Number.isInteger(revision) || revision < 0) {
    return { error: 'revision must be a non-negative integer' };
  }
  if (conversationId !== conversationIdFor(actorId, friendId)) {
    return { error: 'conversationId does not match the participants' };
  }
  if ((type === 'created' || type === 'edited') && !body?.trim()) {
    return { error: 'created and edited events require a body' };
  }
  if (type === 'created' && revision !== 0) {
    return { error: 'created events must use revision zero' };
  }

  return {
    event: {
      eventId,
      messageId,
      conversationId,
      actorId: String(actorId),
      ...(deviceId == null ? {} : { deviceId }),
      type,
      revision,
      createdAt,
      body,
      signature: raw.signature == null ? null : String(raw.signature)
    }
  };
}

function pendingTypeForEvent(eventType) {
  if (eventType === 'recalled') return 'recall';
  if (eventType === 'edited') return 'edit';
  if (eventType === 'read') return 'read';
  return 'message';
}

function eventFromPendingRow(row) {
  if (!row?.event_id || !row?.message_id || !row?.event_type) return null;
  return {
    eventId: String(row.event_id),
    messageId: String(row.message_id),
    conversationId: conversationIdFor(row.sender_id, row.receiver_id),
    actorId: String(row.sender_id),
    ...(row.device_id == null ? {} : { deviceId: String(row.device_id) }),
    type: String(row.event_type),
    revision: Number(row.revision ?? 0),
    createdAt: String(row.created_at),
    body: row.body == null && row.text == null
      ? null
      : String(row.body ?? row.text),
    signature: row.signature == null ? null : String(row.signature)
  };
}

function pendingRowMatchesEvent(row, event, { actorId, friendId }) {
  return Boolean(
    row &&
      String(row.event_id) === event.eventId &&
      String(row.message_id) === event.messageId &&
      Number(row.sender_id) === Number(actorId) &&
      Number(row.receiver_id) === Number(friendId) &&
      Number(row.revision ?? 0) === event.revision &&
      String(row.event_type) === event.type &&
      String(row.text ?? '') === String(event.body ?? '') &&
      String(row.created_at) === event.createdAt &&
      (row.signature == null ? null : String(row.signature)) === event.signature
      && (row.device_id == null ? null : String(row.device_id)) === (event.deviceId ?? null)
  );
}

export {
  conversationIdFor,
  eventFromPendingRow,
  normalizeChatEvent,
  pendingRowMatchesEvent,
  pendingTypeForEvent
};
