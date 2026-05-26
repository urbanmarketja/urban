const config = require('../config');
const fs = require('fs');

let pool;

function getMysql() {
  try {
    return require('mysql2/promise');
  } catch (error) {
    throw new Error('MySQL support requires installing mysql2: npm install mysql2');
  }
}

function getPool() {
  if (!pool) {
    const mysql = getMysql();
    const ssl = buildSslConfig();
    pool = mysql.createPool({
      host: config.dbHost,
      port: config.dbPort,
      database: config.dbName,
      user: config.dbUser,
      password: config.dbPassword,
      ...(ssl ? { ssl } : {}),
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: true,
      multipleStatements: true
    });
  }

  return pool;
}

function buildSslConfig() {
  if (!config.dbSsl) return null;

  const ssl = {
    rejectUnauthorized: config.dbSslRejectUnauthorized
  };

  if (config.dbSslCa) {
    ssl.ca = config.dbSslCa.replace(/\\n/g, '\n');
  } else if (config.dbSslCaPath) {
    ssl.ca = fs.readFileSync(config.dbSslCaPath, 'utf8');
  }

  return ssl;
}

async function query(sql, params = {}) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

async function run(sql) {
  const connection = await getPool().getConnection();
  try {
    return await connection.query(sql);
  } finally {
    connection.release();
  }
}

async function transaction(callback) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const tx = {
      async query(sql, params = {}) {
        const [rows] = await connection.execute(sql, params);
        return rows;
      },
      async run(sql) {
        return connection.query(sql);
      }
    };
    const result = await callback(tx);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

function databaseMode() {
  return config.useDatabase ? 'mysql' : 'memory';
}

module.exports = {
  closePool,
  databaseMode,
  query,
  run,
  transaction
};
