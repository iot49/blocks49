import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// Users Table
export const users = sqliteTable('users', {
  id: text('id').primaryKey(), // UUID
  email: text('email').notNull().unique(),
  role: text('role').default('user'), // 'admin' | 'user'
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Layouts Table
export const layouts = sqliteTable('layouts', {
  id: text('id').primaryKey(), // UUID
  userId: text('user_id').references(() => users.id),
  name: text('name').notNull(),
  description: text('description'),
  
  // Calibration: 2-Point Line System
  calibrationX1: real('cal_x1'),
  calibrationY1: real('cal_y1'),
  calibrationX2: real('cal_x2'),
  calibrationY2: real('cal_y2'),
  
  referenceDistanceMm: real('ref_dist_mm'),
  
  // Scale (Enum: 'N', 'HO', 'Z', ...).
  scale: text('scale').default('HO'),
  
  width: real('width'),
  height: real('height'),
  calibration: text('calibration', { mode: 'json' }), // Stores Record<string, Point>
  
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Images Table
export const images = sqliteTable('images', {
    id: text('id').primaryKey(), // UUID
    layoutId: text('layout_id').references(() => layouts.id),
    filename: text('filename'),
    width: integer('width'),
    height: integer('height'),
    labels: text('labels', { mode: 'json' }), // Stores Record<string, Point & { type: string }>
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
