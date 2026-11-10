import { createFakeBridge, createFakeSyncServer } from "../src/storage/index";
import { CONTRACT_CODE, describeSyncContract } from "./sync-contract";

describeSyncContract("the fake server", () => {
  const bridge = createFakeBridge();
  const fake = createFakeSyncServer({
    pairingCode: CONTRACT_CODE,
    bridgeFetch: bridge.fetch,
  });
  return {
    fetch: fake.fetch,
    openStream: fake.openStream,
    bridge,
    close: () => undefined,
  };
});
