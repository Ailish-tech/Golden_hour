import 'dotenv/config';
import { ensureDemoStaffLogins } from './demoLogins';

ensureDemoStaffLogins()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌  Could not provision demo logins:', err);
    process.exit(1);
  });
