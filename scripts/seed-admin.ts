import bcrypt from "bcryptjs";
import { connectDb } from "../src/lib/db";
import { User } from "../src/models/User";

async function main() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || "RK Staff";
  if (!email || !password || password.length < 12) {
    throw new Error("Set BOOTSTRAP_ADMIN_EMAIL and a BOOTSTRAP_ADMIN_PASSWORD of at least 12 characters.");
  }
  await connectDb();
  const passwordHash = await bcrypt.hash(password, 12);
  await User.findOneAndUpdate(
    { email },
    { name, email, passwordHash, role: "admin", active: true },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  console.log(`Admin account ready: ${email}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
