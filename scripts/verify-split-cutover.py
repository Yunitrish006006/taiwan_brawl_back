#!/usr/bin/env python3
"""Verify real target exports against a private prepared split snapshot."""
import argparse
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile

spec = importlib.util.spec_from_file_location('cutover', Path(__file__).with_name('prepare-split-cutover.py'))
cutover = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cutover)


def verify(plan, exports):
    summary = json.loads((plan / 'summary.json').read_text())
    source = sqlite3.connect(plan / 'source.sqlite')
    checked = []
    with tempfile.TemporaryDirectory(prefix='verify-', dir=plan) as directory:
        for domain, dump in exports.items():
            db = sqlite3.connect(Path(directory) / (domain + '.sqlite'))
            db.executescript(dump.read_text())
            db.execute('PRAGMA foreign_keys=ON')
            for table in summary['domains'][domain]:
                selected = cutover.columns(source, table['table'])
                actual = cutover.rows(db, table['table'], selected)
                if len(actual) != table['rows'] or cutover.digest(actual) != table['sha256']:
                    raise ValueError('Row checksum mismatch in ' + table['table'])
                if 'sequence' in table:
                    sequence = db.execute('SELECT seq FROM sqlite_sequence WHERE name=?', (table['table'],)).fetchone()
                    if sequence != (table['sequence'],):
                        raise ValueError('Sequence mismatch in ' + table['table'])
                checked.append({'table': table['table'], 'rows': table['rows']})
            if db.execute('PRAGMA foreign_key_check').fetchall():
                raise ValueError('Foreign key violations in ' + domain)
            db.close()
    source.close()
    print(json.dumps({'verified': True, 'tables': checked, 'foreignKeyViolations': 0, 'sequencesPreserved': True}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan-dir', type=Path, required=True)
    parser.add_argument('--social-sql', type=Path, required=True)
    parser.add_argument('--games-sql', type=Path, required=True)
    args = parser.parse_args()
    verify(args.plan_dir, {'social': args.social_sql, 'games': args.games_sql})
