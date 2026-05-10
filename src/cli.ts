#!/usr/bin/env node
import { main } from './cli/main.ts';

const code = await main(process.argv.slice(2));
process.exit(code);
