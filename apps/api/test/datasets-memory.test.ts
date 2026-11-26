import { beforeEach, describe } from "bun:test";
import type { CaseDatasetStore } from "../src/datasets.ts";
import { createMemoryDatasets } from "../src/datasets-memory.ts";
import { datasetStoreContract } from "./datasets-contract.ts";

describe("memory case datasets", () => {
  let store: CaseDatasetStore;
  beforeEach(() => {
    store = createMemoryDatasets();
  });
  datasetStoreContract(
    () => ({ slug: "capitals", other: "other" }),
    () => store,
  );
});
