#!/usr/bin/env node
// Launcher so the installed `cvc` command runs the TypeScript CLI with no build
// step, via tsx's programmatic loader. (Dev uses `npm run cvc -- …`.)
import { tsImport } from "tsx/esm/api";

await tsImport("../src/bin.ts", import.meta.url);
