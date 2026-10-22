import { createFakeSyncServer } from "../src/storage/index";
import { CONTRACT_CODE, describeSyncContract } from "./sync-contract";

describeSyncContract("the fake server", () => {
  const fake = createFakeSyncServer({ pairingCode: CONTRACT_CODE });
  return {
    fetch: fake.fetch,
    openStream: fake.openStream,
    close: () => undefined,
  };
});
