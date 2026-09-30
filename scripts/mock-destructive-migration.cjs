#!/usr/bin/env node
// CIMA v0.2 governance fixture. It LOOKS like a destructive migration so the
// runtime classifies it HIGH (`--drop-all-tables`), but it touches nothing: it
// only prints. Used to prove HIGH → HUMAN_APPROVAL_REQUIRED → no execution, and
// that an explicit approval lets the identical call run once.
console.log(`MOCK destructive migration invoked with: ${process.argv.slice(2).join(' ')}`);
console.log('MOCK: no database exists; nothing was dropped. exit 0');
