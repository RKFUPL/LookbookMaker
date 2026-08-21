import mongoose from "mongoose";
import { getConfig } from "@/lib/config";

declare global {
  var __rkMongoose: { connection: typeof mongoose | null; promise: Promise<typeof mongoose> | null } | undefined;
}

const cache = global.__rkMongoose || { connection: null, promise: null };
global.__rkMongoose = cache;

export async function connectDb() {
  if (cache.connection) return cache.connection;
  if (!cache.promise) {
    cache.promise = mongoose.connect(getConfig().MONGODB_URI, {
      bufferCommands: false,
      maxPoolSize: 10,
      minPoolSize: 1,
      serverSelectionTimeoutMS: 8000,
    });
  }
  try {
    cache.connection = await cache.promise;
    return cache.connection;
  } catch (error) {
    cache.promise = null;
    throw error;
  }
}
