export type AsyncConnectionCache<T> = {
  connection: T | null;
  promise: Promise<T> | null;
};

export async function connectSingleFlight<T>(cache: AsyncConnectionCache<T>, connect: () => Promise<T>) {
  if (cache.connection) return cache.connection;
  if (!cache.promise) cache.promise = connect();
  try {
    cache.connection = await cache.promise;
    return cache.connection;
  } catch (error) {
    cache.promise = null;
    throw error;
  }
}
