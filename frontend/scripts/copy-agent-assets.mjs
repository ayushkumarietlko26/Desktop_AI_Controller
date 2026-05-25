/**
 * Copies local_agent.py and agent_requirements.txt from repo root
 * into frontend/public/downloads/ for static download in the web UI.
 */
import { copyFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(__dirname, '..');
const repoRoot = join(frontendRoot, '..');
const outDir = join(frontendRoot, 'public', 'downloads');

const files = ['local_agent.py', 'agent_requirements.txt'];

mkdirSync(outDir, { recursive: true });

for (const name of files) {
  copyFileSync(join(repoRoot, name), join(outDir, name));
  console.log(`[copy-agent-assets] ${name} -> public/downloads/`);
}
