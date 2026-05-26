const fs = require('fs');
const path = require('path');
const config = require('../config');
const { hashPassword } = require('../auth');
const { closePool, query, run } = require('./mysql');

async function seed() {
  const seedPath = path.join(__dirname, 'seed.sql');
  const sql = fs.readFileSync(seedPath, 'utf8');
  await run(sql);
  await query(`
    UPDATE users
    SET password_hash = :passwordHash
    WHERE password_hash = 'dev-placeholder-hash'
  `, { passwordHash: hashPassword(config.devDefaultPassword) });
  console.log('Database seed data applied.');
}

seed()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    closePool().catch(() => undefined);
  });
