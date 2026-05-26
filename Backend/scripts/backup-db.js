const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');

const backupDir = path.join(__dirname, '..', 'backups');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputFile = path.join(backupDir, `${config.dbName}-${timestamp}.sql`);

function run() {
  fs.mkdirSync(backupDir, { recursive: true });

  const args = [
    `--host=${config.dbHost}`,
    `--port=${config.dbPort}`,
    `--user=${config.dbUser}`,
    `--result-file=${outputFile}`,
    '--single-transaction',
    '--routines',
    '--triggers',
    config.dbName
  ];

  const env = { ...process.env, MYSQL_PWD: config.dbPassword };
  const child = spawn('mysqldump', args, { env, stdio: 'inherit' });

  child.on('exit', (code) => {
    if (code === 0) {
      console.log(`Backup written to ${outputFile}`);
      return;
    }
    console.error(`mysqldump failed with exit code ${code}`);
    process.exitCode = code || 1;
  });
}

run();
