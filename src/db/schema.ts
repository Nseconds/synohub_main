import { mysqlTable, varchar, serial, text, timestamp, int } from 'drizzle-orm/mysql-core';

export const users = mysqlTable('tbl_users', {
  id: int('user_id').primaryKey(),
  name: varchar('user_name', { length: 255 }).notNull(),
  username: varchar('user_username', { length: 25 }).notNull(),
  password: varchar('user_password', { length: 255 }),
  email: varchar('user_email', { length: 255 }),
  phone: varchar('user_phone', { length: 20 }),
  status: varchar('user_status', { length: 20 }).notNull(),
  type: varchar('user_type', { length: 100 }).notNull(),
});

export const customers = mysqlTable('tbl_customer', {
  id: serial('customer_id').primaryKey(),
  name: varchar('customer_name', { length: 100 }),
  contactName: varchar('customer_contact_name', { length: 100 }),
  phone: varchar('customer_contact_phone', { length: 50 }),
  email: varchar('customer_email', { length: 500 }),
  region: varchar('customer_status_group', { length: 50 }),
  implementationType: varchar('customer_implementation_type', { length: 20 }),
  vehicleCount: int('actual_veh_count').default(0),
  createdBy: varchar('customer_sales_person_id', { length: 150 }).default(''),
});

export const serviceRequests = mysqlTable('tbl_customer_services_beta', {
  id: serial('customer_service_id').primaryKey(),
  createdAt: varchar('customer_service_created_date', { length: 100 }),
  source: varchar('customer_service_created_by', { length: 100 }),
  region: varchar('region', { length: 100 }),
  status: varchar('customer_service_status', { length: 50 }).default('new'),
  implementationType: varchar('customer_service_customer_type', { length: 100 }),
  customerName: text('customer_service_customer_name'),
  contactName: varchar('customer_service_customer_contact_name', { length: 255 }),
  phone: varchar('customer_service_customer_phone', { length: 50 }),
  email: varchar('customer_service_customer_email', { length: 500 }),
  address: text('customer_service_customer_address'),
  mapLink: text('customer_service_address_map'),
  coordinates: varchar('customer_service_address_cordinates', { length: 100 }),
  
  newQty: int('customer_service_quantity').default(0),
  migrateQty: int('customer_service_quantity').default(0),
  tradingQty: int('customer_service_quantity').default(0),
  serviceQty: int('customer_service_quantity').default(0),
  otherQty: int('customer_service_quantity').default(0),
  accessories: text('schedule_note'),
  
  requestedPerson: varchar('requested_by', { length: 100 }),
  salesPerson: varchar('customer_service_L2_assigned_to', { length: 100 }),
  salesType: varchar('customer_service_status', { length: 100 }),
  
  projectValue: varchar('customer_service_amount', { length: 100 }),
  priceDetails: text('customer_service_payment'),
  comment: text('customer_service_description'),
  
  issueDescription: text('customer_service_description'),
  location: varchar('region', { length: 100 }),
  paymentStatus: varchar('customer_service_payment_status', { length: 50 }),
  amount: varchar('customer_service_amount', { length: 50 }),
  vehicleDetails: text('schedule_note'),
  notes: text('schedule_note'),
  jobStatus: varchar('customer_service_status', { length: 50 }).default('new'),
  createdBy: varchar('customer_service_created_by', { length: 150 }).default(''),
});

export const messages = mysqlTable('messages', {
  id: serial('id').primaryKey(),
  role: varchar('role', { length: 20 }).notNull(), // 'user' or 'assistant'
  content: text('content').notNull(),
  timestamp: timestamp('timestamp').defaultNow(),
  username: varchar('username', { length: 255 }),
});

