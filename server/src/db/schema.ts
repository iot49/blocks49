import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// Users Table
export const users = sqliteTable('users', {
  id: text('id').primaryKey(), // UUID
  email: text('email').notNull().unique(),
  role: text('role').default('user'), // 'admin' | 'user'
  profile: text('profile'),
  mqttBroker: text('mqtt_broker').default('ws://localhost:8083/mqtt'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Layouts Table
export const layouts = sqliteTable('layouts', {
  id: text('id').primaryKey(), // UUID
  userId: text('user_id').references(() => users.id),
  name: text('name').notNull(),
  description: text('description'),
  classifier: text('classifier'), // format "model/precision"
  mqttUrl: text('mqtt_url'),
  
  // Calibration: 2-Point Line System
  p1x: real('p1_x'),
  p1y: real('p1_y'),
  p2x: real('p2_x'),
  p2y: real('p2_y'),
  
  // Distance between calibration points (mm)
  referenceDistanceMm: real('ref_dist_mm'),
  
  // Scale (Enum: 'N', 'HO', 'Z', ...).
  scale: text('scale').default('HO'),
  
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const images = sqliteTable('images', {
    id: text('id').primaryKey(), // UUID
    layoutId: text('layout_id').references(() => layouts.id),
    markers: text('markers', { mode: 'json' }), // Stores Record<string, ApiMarker>
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
