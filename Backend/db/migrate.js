const fs = require('fs');
const path = require('path');
const { closePool, run } = require('./mysql');

function splitSqlStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function canIgnoreMigrationError(error) {
  return [
    'ER_DUP_KEYNAME',
    'ER_DUP_FIELDNAME',
    'ER_TABLE_EXISTS_ERROR',
    'ER_FK_DUP_NAME',
    'ER_BAD_FIELD_ERROR',
    'ER_KEY_COLUMN_DOES_NOT_EXITS'
  ].includes(error.code);
}

async function migrate() {
  const schemaPath = path.join(__dirname, '..', 'schema.sql');
  const migrationDir = path.join(__dirname, 'migrations');
  const migrationPaths = fs.existsSync(migrationDir)
    ? fs.readdirSync(migrationDir)
      .filter((file) => file.endsWith('.sql'))
      .sort()
      .map((file) => path.join(migrationDir, file))
    : [];
  const sqlFiles = [schemaPath, ...migrationPaths];

  for (const sqlPath of sqlFiles) {
    const statements = splitSqlStatements(fs.readFileSync(sqlPath, 'utf8'));
    for (const statement of statements) {
      try {
        await run(`${statement};`);
      } catch (error) {
        if (!canIgnoreMigrationError(error)) {
          throw error;
        }
        console.warn(`Skipping existing database object: ${error.code}`);
      }
    }
  }

  console.log('Database schema applied.');
}

migrate()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    closePool().catch(() => undefined);
  });
