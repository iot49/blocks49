import { getDb } from '../src/db/index.js';
import { users, layouts } from '../src/db/schema.js';
import { randomUUID } from 'crypto';

async function main() {
  console.log('Verifying Database Connectivity...');
  
  const db = getDb();
  
  // 1. Insert User
  const userId = randomUUID();
  console.log(`Inserting user: ${userId}`);
  await db.insert(users).values({
      id: userId,
      email: 'test@example.com',
      role: 'admin'
  }).onConflictDoNothing(); // prevent error if run multiple times
  
  // 2. Insert Layout
  const layoutId = randomUUID();
  console.log(`Inserting layout for user: ${layoutId}`);
  await db.insert(layouts).values({
      id: layoutId,
      userId: userId,
      name: 'Test Layout',
      description: 'Created by verify script',
      scale: 'HO',
      referenceDistanceMm: 100,
      calibrationX1: 0, calibrationY1: 0,
      calibrationX2: 100, calibrationY2: 0
  });
  
  // 3. Query
  const allUsers = await db.select().from(users).all();
  console.log('Users found:', allUsers.length);
  
  const allLayouts = await db.select().from(layouts).all();
  console.log('Layouts found:', allLayouts.length);
  
  console.log('Verification Complete!');
}

main().catch(console.error);
