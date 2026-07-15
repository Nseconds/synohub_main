import { mysqlTable, varchar, serial, text, timestamp, int, date } from 'drizzle-orm/mysql-core';

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

export const customers = mysqlTable('customers', {
  id: int('id').primaryKey(),
  name: varchar('name', { length: 200 }),
  contactName: varchar('contact_name', { length: 200 }),
  phone: varchar('phone', { length: 100 }),
  email: varchar('email', { length: 255 }),
  region: varchar('region', { length: 20 }),
  implementationType: varchar('implementation_type', { length: 100 }),
  vehicleCount: int('vehicle_count').default(0),
  createdBy: varchar('created_by', { length: 255 }).default(''),
});

export const serviceRequests = mysqlTable('tbl_customer_services_beta', {
  id: serial('customer_service_id').primaryKey(),
  customerId: int('customer_service_customer_id').default(0),
  createdAt: varchar('customer_service_created_date', { length: 100 }),
  createdBy: varchar('customer_service_created_by', { length: 150 }).default(''),
  region: varchar('region', { length: 100 }),
  status: varchar('customer_service_status', { length: 50 }).default('new'),
  implementationType: varchar('customer_service_customer_type', { length: 100 }),
  customerName: text('customer_service_customer_name'),
  contactName: varchar('customer_service_customer_contact_name', { length: 255 }),
  phone: varchar('customer_service_customer_phone', { length: 50 }),
  email: varchar('customer_service_customer_email', { length: 500 }),
  address: text('customer_service_customer_address'),
  customerExpiryDate: date('customer_service_customer_exp_date'),
  locatorPlan: varchar('locator_plan', { length: 20 }),
  mapLink: text('customer_service_address_map'),
  coordinates: varchar('customer_service_address_cordinates', { length: 100 }),
  
  newQty: int('customer_service_quantity').default(0),
  accessories: text('schedule_note'),
  
  requestedPerson: varchar('requested_by', { length: 100 }),
  salesPerson: varchar('customer_service_L2_assigned_to', { length: 100 }),
  
  amount: varchar('customer_service_amount', { length: 50 }),
  priceDetails: text('customer_service_payment'),
  issueDescription: text('customer_service_description'),
  paymentStatus: varchar('customer_service_payment_status', { length: 50 }),
  jobCreated: int('customer_service_job_created').default(0),
});

export const messages = mysqlTable('messages', {
  id: serial('id').primaryKey(),
  role: varchar('role', { length: 20 }).notNull(), // 'user' or 'assistant'
  content: text('content').notNull(),
  timestamp: timestamp('timestamp').defaultNow(),
  username: varchar('username', { length: 255 }),
});

export const customersLocator = mysqlTable('customers_locator', {
  customerId: int('customer_id').primaryKey(),
  customerTraccarId: int('customer_traccar_id'),
  customerName: varchar('customer_name', { length: 100 }),
  customerUsername: varchar('customer_username', { length: 100 }),
  locatorPlan: varchar('locator_plan', { length: 20 }),
});

