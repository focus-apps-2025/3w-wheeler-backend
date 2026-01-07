import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const FormSchema = new mongoose.Schema({
  title: String,
  tenantId: mongoose.Schema.Types.ObjectId,
  isGlobal: Boolean,
  sharedWithTenants: [mongoose.Schema.Types.ObjectId],
}, { strict: false });

const Form = mongoose.model('Form', FormSchema);

const TenantSchema = new mongoose.Schema({
  name: String,
  companyName: String,
  slug: String,
}, { strict: false });

const Tenant = mongoose.model('Tenant', TenantSchema);

async function check() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to DB');

    const tenants = await Tenant.find({});
    console.log('\n--- Tenants ---');
    tenants.forEach(t => {
      console.log(`ID: ${t._id}, Name: ${t.name}, Company: ${t.companyName}, Slug: ${t.slug}`);
    });

    const forms = await Form.find({});
    console.log('\n--- Forms ---');
    forms.forEach(f => {
      console.log(`Title: ${f.title}`);
      console.log(`  tenantId: ${f.tenantId}`);
      console.log(`  isGlobal: ${f.isGlobal}`);
      console.log(`  sharedWithTenants: ${f.sharedWithTenants}`);
      console.log(`  isVisible: ${f.isVisible}`);
      console.log(`  isActive: ${f.isActive}`);
    });

    await mongoose.disconnect();
  } catch (err) {
    console.error(err);
  }
}

check();
