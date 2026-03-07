const { Client } = require('pg');
require('dotenv').config();

async function checkTables() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    const res = await client.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log("Tables in public schema:");
    res.rows.forEach(row => console.log(`- ${row.table_name}`));
  } catch (err) {
    console.error('Error executing query', err.stack);
  } finally {
    await client.end();
  }
}

checkTables();
