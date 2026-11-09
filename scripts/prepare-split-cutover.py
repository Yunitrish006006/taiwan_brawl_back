#!/usr/bin/env python3
"""Prepare private, verified D1 split imports without contacting production."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3

SOCIAL = ['friend_requests', 'friendships', 'user_blocks', 'room_invites',
          'chat_messages', 'pending_messages', 'chat_devices', 'chat_pending_message_acks']
GAMES = ['mini_royale_cards', 'mini_royale_user_decks', 'mini_royale_user_deck_cards',
         'mini_royale_match_history', 'mini_royale_card_character_assets',
         'mini_royale_user_deck_characters', 'mini_royale_user_deck_character_events']
RENAMES = dict(zip(['cards', 'user_decks', 'user_deck_cards', 'match_history',
                    'card_character_assets', 'user_deck_characters', 'user_deck_character_events'], GAMES))
ROOT = Path(__file__).resolve().parents[1]


def quoted(name):
    if not name.replace('_', '').isalnum():
        raise ValueError('Unexpected SQL identifier')
    return '"' + name + '"'


def columns(db, table):
    return [row[1] for row in db.execute('PRAGMA table_info(' + quoted(table) + ')')]


def rows(db, table, selected=None):
    selected = selected or columns(db, table)
    return db.execute('SELECT ' + ','.join(map(quoted, selected)) + ' FROM ' + quoted(table)).fetchall()


def digest(values):
    def encode(value):
        if isinstance(value, bytes):
            return {'blob': value.hex()}
        return value
    encoded = [json.dumps([encode(v) for v in row], ensure_ascii=True, separators=(',', ':')) for row in values]
    return hashlib.sha256('\n'.join(sorted(encoded)).encode()).hexdigest()


def literal(value):
    if value is None:
        return 'NULL'
    if isinstance(value, str):
        return "CAST(X'" + value.encode('utf-8').hex() + "' AS TEXT)"
    if isinstance(value, bytes):
        return "X'" + value.hex() + "'"
    return repr(value)


def prepare(source_sql, output):
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    os.chmod(output, 0o700)
    source = sqlite3.connect(output / 'source.sqlite')
    source.executescript(source_sql.read_text())
    source.execute('PRAGMA foreign_keys=ON')
    source_tables = [r[0] for r in source.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name!='d1_migrations'")]
    originals = {t: (columns(source, t), digest(rows(source, t)), len(rows(source, t))) for t in source_tables}
    applied = {r[0] for r in source.execute('SELECT name FROM d1_migrations')}
    pending = [p for p in sorted((ROOT / 'migrations').glob('*.sql')) if p.name not in applied]
    for migration in pending:
        source.executescript('BEGIN;\n' + migration.read_text() +
                             "\nINSERT INTO d1_migrations(name,applied_at) VALUES('" + migration.name + "',datetime('now'));\nCOMMIT;")
    for old, (cols, before, _) in originals.items():
        current = RENAMES.get(old, old)
        if old == 'push_registrations' and any(p.name == '0028_fcm_push_registrations.sql' for p in pending):
            current = 'push_registrations_legacy_0028'
        if digest(rows(source, current, cols)) != before:
            raise ValueError('Main migration changed existing rows in ' + old)
    if source.execute('PRAGMA foreign_key_check').fetchall():
        raise ValueError('Source has foreign key violations')
    summary = {'pendingMainMigrations': [p.name for p in pending], 'domains': {},
               'users': len(rows(source, 'users')), 'sessions': len(rows(source, 'sessions'))}
    for domain, tables in [('social', SOCIAL), ('games', GAMES)]:
        target = sqlite3.connect(output / (domain + '.sqlite'))
        target.execute('PRAGMA foreign_keys=ON')
        for migration in sorted((ROOT / 'migrations' / domain).glob('*.sql')):
            target.executescript(migration.read_text())
        statements = ['PRAGMA defer_foreign_keys=TRUE;']
        checks = []
        for table in tables:
            cols = columns(source, table)
            target_info = list(target.execute('PRAGMA table_info(' + quoted(table) + ')'))
            target_cols = {c[1] for c in target_info}
            optional_extra = all(not c[3] and not c[5] or c[4] is not None for c in target_info if c[1] not in cols)
            if not set(cols).issubset(target_cols) or not optional_extra:
                raise ValueError('Column drift in ' + table)
            data = rows(source, table, cols)
            sql = 'INSERT INTO ' + quoted(table) + '(' + ','.join(map(quoted, cols)) + ') VALUES '
            for row in data:
                statement = sql + '(' + ','.join(map(literal, row)) + ');'
                statements.append(statement)
                target.execute(statement)
            checks.append({'table': table, 'rows': len(data), 'sha256': digest(data)})
        for table in tables:
            seq = source.execute('SELECT seq FROM sqlite_sequence WHERE name=?', (table,)).fetchone()
            if seq:
                update = 'UPDATE sqlite_sequence SET seq=' + str(seq[0]) + ' WHERE name=' + literal(table) + ';'
                insert = 'INSERT INTO sqlite_sequence(name,seq) SELECT ' + literal(table) + ',' + str(seq[0]) + ' WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name=' + literal(table) + ');'
                statements.extend([update, insert])
                target.execute(update)
                target.execute(insert)
                if target.execute('SELECT seq FROM sqlite_sequence WHERE name=?', (table,)).fetchone() != seq:
                    raise ValueError('Sequence mismatch in ' + table)
                next(c for c in checks if c['table'] == table)['sequence'] = seq[0]
        target.commit()
        for check in checks:
            if digest(rows(target, check['table'], columns(source, check['table']))) != check['sha256']:
                raise ValueError('Target row mismatch in ' + check['table'])
        if target.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Target has foreign key violations')
        (output / (domain + '-data.sql')).write_text('\n'.join(statements) + '\n')
        summary['domains'][domain] = checks
        target.close()
    freeze = []
    release = []
    moved_old = set(SOCIAL) | set(RENAMES) | set(GAMES)
    for table in source_tables:
        for operation in ['insert', 'update', 'delete']:
            name = 'cutover_pause_' + table + '_' + operation
            freeze.append('CREATE TRIGGER IF NOT EXISTS ' + quoted(name) + ' BEFORE ' + operation.upper() + ' ON ' + quoted(table) + " BEGIN SELECT RAISE(ABORT,'CUTOVER_WRITE_PAUSED'); END;")
            if table not in moved_old:
                release.append('DROP TRIGGER IF EXISTS ' + quoted(name) + ';')
    (output / 'freeze-source.sql').write_text('\n'.join(freeze) + '\n')
    (output / 'release-retained.sql').write_text('\n'.join(release) + '\n')
    (output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    source.close()
    for path in output.iterdir():
        path.chmod(0o600)
    print(json.dumps({'prepared': True, 'pendingMainMigrations': summary['pendingMainMigrations'],
                      'usersPreserved': summary['users'], 'sessionsPreserved': summary['sessions'],
                      'tableRows': {domain: {c['table']: c['rows'] for c in checks} for domain, checks in summary['domains'].items()},
                      'foreignKeyViolations': 0}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-sql', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    prepare(args.source_sql, args.output_dir)
