import mongoose from "mongoose";
import { getConfig } from "@/lib/config";
import { configureMongoDns } from "@/lib/mongodb-dns";
import { connectSingleFlight, type AsyncConnectionCache } from "@/lib/connection-cache";

declare global { var __rkMongoose: AsyncConnectionCache<typeof mongoose> | undefined; }

const cache = global.__rkMongoose || { connection: null, promise: null };
global.__rkMongoose = cache;

export async function connectDb() {
  configureMongoDns();
  return connectSingleFlight(cache, () => mongoose.connect(getConfig().MONGODB_URI, {
      bufferCommands: false,
      maxPoolSize: 10,
      minPoolSize: 1,
      serverSelectionTimeoutMS: 8000,
    }));
}
