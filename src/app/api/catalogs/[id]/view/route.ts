import { isValidObjectId } from "mongoose";
import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { apiError, ApiError, readJson } from "@/lib/http";
import { Catalog } from "@/models/Catalog";
import { CatalogEvent } from "@/models/CatalogEvent";

const schema = z.object({
  type: z.enum(["view", "page_view", "share"]),
  page: z.number().int().positive().max(1000).optional(),
  sessionId: z.string().min(8).max(100).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const input = schema.parse(await readJson(request));
    await connectDb();
    const id = (await params).id;
    const catalog = isValidObjectId(id)
      ? await Catalog.findOne({ _id: id, status: "published" })
      : await Catalog.findOne({ slug: id.toLowerCase(), status: "published" });
    if (!catalog) throw new ApiError(404, "Catalog not found.");
    if (input.page && input.page > catalog.pageCount) throw new ApiError(400, "Page is outside this catalog.");
    await CatalogEvent.create({
      catalogId: catalog._id,
      ...input,
      referrer: request.headers.get("referer")?.slice(0, 500),
      userAgent: request.headers.get("user-agent")?.slice(0, 500),
    });
    if (input.type === "view") await Catalog.updateOne({ _id: catalog._id }, { $inc: { views: 1 } });
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (error) { return apiError(error); }
}
