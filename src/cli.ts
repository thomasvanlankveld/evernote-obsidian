#!/usr/bin/env node
import { main } from './cli/main.ts';

process.exit(main(process.argv.slice(2)));
