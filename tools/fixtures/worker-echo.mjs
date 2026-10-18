import { createInterface } from 'node:readline';

createInterface({ input: process.stdin }).on('line', line => {
  // Match the real worker: .NET Framework can emit an initial UTF-8 BOM
  // when its console input code page is UTF-8 (including GitHub Windows runners).
  const message = JSON.parse(line.trim());
  const reply = () => process.stdout.write(JSON.stringify({ id: message.id, ok: true, echo: message.cmd }) + '\n');
  if (message.cmd === 'exit') return process.exit(23);
  if (message.cmd === 'hang') return;
  if (message.cmd === 'late') { setTimeout(reply, 200); return; }
  if (message.cmd === 'malformed') {
    process.stdout.write('not json\n{"id":"invalid","ok":true}\n');
  }
  reply();
  if (message.cmd === 'duplicate') reply();
  if (message.cmd === 'reply-and-exit') process.stdout.write('', () => process.exit(0));
});
