const fs = require('fs');
const { spawn } = require('child_process');
const config = require('../config');

const inputFile = process.argv[2];

if (!inputFile || !fs.existsSync(inputFile)) {
  console.error('Usage: npm run db:restore -- path/to/backup.sql');
  process.exit(1);
}

const args = [
  `--host=${config.dbHost}`,
  `--port=${config.dbPort}`,
  `--user=${config.dbUser}`,
  config.dbName
];

const env = { ...process.env, MYSQL_PWD: config.dbPassword };
const child = spawn('mysql', args, { env, stdio: ['pipe', 'inherit', 'inherit'] });

fs.createReadStream(inputFile).pipe(child.stdin);

child.on('exit', (code) => {
  if (code === 0) {
    console.log(`Database restored from ${inputFile}`);
    return;
  }
  console.error(`mysql restore failed with exit code ${code}`);
  process.exitCode = code || 1;
});
