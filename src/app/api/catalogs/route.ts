import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { catalogCreateSchema } from "@/lib/validation";
import { uniqueSlug } from "@/lib/slug";
import { serializeCatalog } from "@/lib/catalog-serializer";
import { Catalog } from "@/models/Catalog";

export async function GET(request: Request) {
  try {
    await requireStaff();
    await connectDb();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const query = searchParams.get("q")?.trim();
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") || 20)));
    const filter: Record<string, unknown> = {};
    if (status && ["draft", "uploading", "processing", "ready", "published", "archived", "error"].includes(status)) {
      filter.status = status;
    }
    if (query) filter.$text = { $search: query.slice(0, 100) };

    const [catalogs, total, counts] = await Promise.all([
      Catalog.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit),
      Catalog.countDocuments(filter),
      Catalog.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);
    return NextResponse.json({
      catalogs: await Promise.all(catalogs.map((catalog) => serializeCatalog(catalog))),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      counts: Object.fromEntries(counts.map((item) => [item._id, item.count])),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const staff = await requireStaff();
    const input = catalogCreateSchema.parse(await readJson(request));
    await connectDb();
    const slug = await uniqueSlug(`${input.title} ${input.season}`);
    const { collection, ...details } = input;
    const catalog = await Catalog.create({ ...details, collectionName: collection, slug, createdBy: staff.userId, updatedBy: staff.userId });
    return NextResponse.json({ catalog: await serializeCatalog(catalog) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
