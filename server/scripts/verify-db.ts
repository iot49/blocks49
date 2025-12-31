import { eq } from 'drizzle-orm';
import { getDb } from '../src/db/index.js';
import { users, layouts } from '../src/db/schema.js';
import { randomUUID } from 'crypto';

async function main() {
  console.log('Verifying Database Connectivity...');
  
  const db = getDb();
  
  // 1. Ensure Test User exists
  let targetUserId = randomUUID();
  const existingUser = await db.select().from(users).where(eq(users.email, 'test@example.com')).get();
  
  if (existingUser) {
      targetUserId = existingUser.id;
      console.log(`Using existing user: ${targetUserId}`);
  } else {
      console.log(`Inserting new user: ${targetUserId}`);
      await db.insert(users).values({
          id: targetUserId,
          email: 'test@example.com',
          role: 'admin'
      });
  }
  
  // 2. Insert Layout
  const layoutId = randomUUID();
  console.log(`Inserting layout for user: ${layoutId}`);
  await db.insert(layouts).values({
      id: layoutId,
      userId: targetUserId,
      name: 'Test Layout',
      description: 'Created by verify script',
      scale: 'HO',
      referenceDistanceMm: 100,
      p1x: 0, p1y: 0,
      p2x: 100, p2y: 0
  });
  
  // 3. Query
  const allUsers = await db.select().from(users).all();
  console.log('Users found:', allUsers.length);
  
  const allLayouts = await db.select().from(layouts).all();
  console.log('Layouts found:', allLayouts.length);
  
  console.log('Verification Complete!');
}

main().catch(console.error);
