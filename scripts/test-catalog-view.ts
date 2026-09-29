import assert from "node:assert/strict";
import { isCatalogViewPageValid } from "../src/lib/catalog-view-validation";

assert.equal(isCatalogViewPageValid(undefined, 0), true);
assert.equal(isCatalogViewPageValid(1, 0), true, "lazy page metadata must allow the first view event");
assert.equal(isCatalogViewPageValid(3, 5), true);
assert.equal(isCatalogViewPageValid(6, 5), false);
console.log("Catalog view validation tests passed");
