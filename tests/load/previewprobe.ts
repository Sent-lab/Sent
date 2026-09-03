import { writeFileSync } from "node:fs";
import { renderPreview } from "@sent/api/preview";

writeFileSync(process.argv[2] ?? "preview.svg", renderPreview({
  symbol: "NVDA",
  name: "Nvidia Believers Club",
  quoteSymbol: "NVDAx",
  token: "0x17de344ed445ed0650fdc68a1de14fc09f9ae5dd",
  status: "PRE_GRAD",
  graduationProgressBps: 6_820n,
  referenceMarketCapUsd: 34_100n * 10n ** 18n,
  holderCount: 412,
}));
console.log("written");
